import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

export interface DaemonState {
    output: string;
    hasErrors: boolean;
    hasWarnings: boolean;
    isComplete: boolean;
    lastUpdate: number;
}

export function getSocketPath(workspacePath: string): string {
    return path.join(workspacePath, 'node_modules', '.svelte-check-daemon.sock');
}

export function getPidPath(workspacePath: string): string {
    return path.join(workspacePath, 'node_modules', '.svelte-check-daemon.pid');
}

export class SvelteCheckDaemon {
    private lastCompleteState: DaemonState = {
        output: '',
        hasErrors: false,
        hasWarnings: false,
        isComplete: false,
        lastUpdate: Date.now()
    };
    private svelteCheckProcess: ChildProcess | null = null;
    private server: net.Server | null = null;
    private socketPath: string;
    private pidPath: string;
    private currentOutput: string = '';
    private lineBuffer: string = '';
    private workspacePath: string;
    private tsconfigPath: string | undefined;
    private routeFileWatchers: fs.FSWatcher[] = [];
    private gitHeadWatcher: fs.FSWatcher | null = null;
    private bigChangesWatcher: fs.FSWatcher | null = null;
    private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private knownFiles: Set<string> = new Set();

    constructor(workspacePath: string, tsconfigPath?: string) {
        this.workspacePath = workspacePath;
        this.tsconfigPath = tsconfigPath;
        this.socketPath = getSocketPath(workspacePath);
        this.pidPath = getPidPath(workspacePath);
    }

    async start(): Promise<void> {
        process.title = 'svelte-check-daemon';
        this.cleanup();

        fs.writeFileSync(this.pidPath, process.pid.toString());

        this.startSvelteCheck();
        this.startRouteFileWatchers();
        this.startGitHeadWatcher();
        this.startBigChangesWatcher();
        await this.startServer();

        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGHUP', () => {
            console.log('Received SIGHUP, restarting svelte-check...');
            this.restartSvelteCheck();
        });
    }

    private startBigChangesWatcher(): void {
        const watchDir = process.env.SVELTE_CHECK_WATCH_BIG_CHANGES;
        if (!watchDir) {
            return;
        }

        const absoluteWatchDir = path.resolve(this.workspacePath, watchDir);
        if (!fs.existsSync(absoluteWatchDir)) {
            console.log(`SVELTE_CHECK_WATCH_BIG_CHANGES: directory ${absoluteWatchDir} does not exist, skipping`);
            return;
        }

        this.scanDirectory(absoluteWatchDir);

        this.bigChangesWatcher = fs.watch(absoluteWatchDir, { recursive: true }, (eventType, filename) => {
            if (!filename) return;

            const fullPath = path.join(absoluteWatchDir, filename);

            if (eventType === 'rename') {
                if (fs.existsSync(fullPath)) {
                    this.knownFiles.add(fullPath);
                } else if (this.knownFiles.has(fullPath)) {
                    this.knownFiles.delete(fullPath);
                    console.log(`File deleted: ${fullPath}, restarting svelte-check...`);
                    this.restartSvelteCheck();
                }
            }
        });
    }

    private scanDirectory(dir: string): void {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    this.scanDirectory(fullPath);
                } else {
                    this.knownFiles.add(fullPath);
                }
            }
        } catch {
            // ignore errors (permission denied, etc.)
        }
    }

    private startGitHeadWatcher(): void {
        const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: this.workspacePath,
            encoding: 'utf-8'
        });
        if (gitRoot.status !== 0 || !gitRoot.stdout) {
            return;
        }

        const gitHeadPath = path.join(gitRoot.stdout.trim(), '.git', 'HEAD');
        if (!fs.existsSync(gitHeadPath)) {
            return;
        }

        this.gitHeadWatcher = fs.watch(gitHeadPath, () => {
            console.log('Git HEAD changed, restarting svelte-check...');
            this.restartSvelteCheck();
        });
    }

    private restartSvelteCheck(): void {
        if (this.svelteCheckProcess) {
            this.svelteCheckProcess.kill();
            this.svelteCheckProcess = null;
        }
        this.currentOutput = '';
        this.lineBuffer = '';
        this.lastCompleteState = {
            output: '',
            hasErrors: false,
            hasWarnings: false,
            isComplete: false,
            lastUpdate: Date.now()
        };
        this.startSvelteCheck();
    }

    private startRouteFileWatchers(): void {
        const parseEnvList = (value: string) =>
            value.split(',').map(p => p.trim()).filter(p => p.length > 0);

        const watchConfigs: Array<{ dir: string; recursive: boolean; envVar: string }> = [
            ...parseEnvList(process.env.WATCH_DIRS || '').map(dir => ({
                dir,
                recursive: false,
                envVar: 'WATCH_DIRS'
            })),
            ...parseEnvList(process.env.WATCH_DIRS_RECURSIVE || '.').map(dir => ({
                dir,
                recursive: true,
                envVar: 'WATCH_DIRS_RECURSIVE'
            }))
        ];

        for (const { dir, recursive, envVar } of watchConfigs) {
            const absoluteDir = path.resolve(this.workspacePath, dir);
            if (!fs.existsSync(absoluteDir)) {
                console.log(`${envVar}: directory ${absoluteDir} does not exist, skipping`);
                continue;
            }

            const watcher = fs.watch(
                absoluteDir,
                { recursive },
                (_eventType, filename) => {
                    if (filename && /\+[^/]+\.ts$/.test(filename)) {
                        if (this.syncDebounceTimer) {
                            clearTimeout(this.syncDebounceTimer);
                        }
                        this.syncDebounceTimer = setTimeout(() => {
                            spawnSync('svelte-kit', ['sync'], {
                                cwd: this.workspacePath,
                                stdio: 'inherit'
                            });
                        }, 250);
                    }
                }
            );
            this.routeFileWatchers.push(watcher);
        }
    }

    private startSvelteCheck(): void {
        const args = ['--watch', '--preserveWatchOutput', '--output', 'human-verbose'];
        if (this.tsconfigPath) {
            args.push('--tsconfig', this.tsconfigPath);
        }

        this.svelteCheckProcess = spawn('svelte-check', args, {
            cwd: this.workspacePath,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        this.svelteCheckProcess.stdout?.on('data', (data: Buffer) => {
            this.handleOutput(data.toString());
        });

        this.svelteCheckProcess.stderr?.on('data', (data: Buffer) => {
            this.handleOutput(data.toString());
        });

        this.svelteCheckProcess.on('exit', () => {
            this.svelteCheckProcess = null;
        });
    }

    private handleOutput(data: string): void {
        if (data.includes('Getting Svelte diagnostics...')) {
            this.lastCompleteState = {
                ...this.lastCompleteState,
                isComplete: false,
                lastUpdate: Date.now()
            };
        }

        this.lineBuffer += data;
        const lines = this.lineBuffer.split('\n');
        this.lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
            this.handleLine(line);
        }
    }

    private handleLine(line: string): void {
        this.currentOutput += line + '\n';

        const summaryMatch = line.match(/svelte-check found (\d+) errors? and (\d+) warnings?/);
        if (summaryMatch) {
            const errorCount = parseInt(summaryMatch[1]!, 10);
            const warningCount = parseInt(summaryMatch[2]!, 10);
            const output = this.currentOutput
                .replace(/={36,}\n?/g, '')
                .replace(/Watching for file changes\.\.\.\n?/g, '')
                .trimEnd();
            this.lastCompleteState = {
                output,
                hasErrors: errorCount > 0,
                hasWarnings: warningCount > 0,
                isComplete: true,
                lastUpdate: Date.now()
            };
            this.currentOutput = '';
        }
    }

    getState(): DaemonState {
        return this.lastCompleteState;
    }

    private async startServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                socket.on('data', (data) => {
                    const request = data.toString().trim();
                    if (request === 'GET_STATUS') {
                        socket.write(JSON.stringify(this.getState()));
                        socket.end();
                    }
                });
            });

            this.server.on('error', (err) => {
                console.error('Server error:', err);
                reject(err);
            });

            this.server.listen(this.socketPath, () => {
                if (process.env.VERBOSE) console.log(`Listening on ${this.socketPath}`);
                resolve();
            });
        });
    }

    private cleanup(): void {
        try {
            if (fs.existsSync(this.socketPath)) {
                fs.unlinkSync(this.socketPath);
            }
        } catch {
            // ignore
        }
        try {
            if (fs.existsSync(this.pidPath)) {
                fs.unlinkSync(this.pidPath);
            }
        } catch {
            // ignore
        }
    }

    private shutdown(): void {
        if (this.syncDebounceTimer) {
            clearTimeout(this.syncDebounceTimer);
        }
        for (const watcher of this.routeFileWatchers) {
            watcher.close();
        }
        if (this.gitHeadWatcher) {
            this.gitHeadWatcher.close();
        }
        if (this.bigChangesWatcher) {
            this.bigChangesWatcher.close();
        }
        if (this.svelteCheckProcess) {
            this.svelteCheckProcess.kill();
        }
        if (this.server) {
            this.server.close();
        }
        this.cleanup();
        process.exit(0);
    }
}

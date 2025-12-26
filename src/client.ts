import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';

import { type DaemonState, getPidPath, getSocketPath } from './daemon.js';

export async function getStatusFromDaemon(workspacePath: string): Promise<DaemonState | null> {
    const socketPath = getSocketPath(workspacePath);

    if (!fs.existsSync(socketPath)) {
        return null;
    }

    return new Promise((resolve) => {
        const socket = net.createConnection(socketPath, () => {
            socket.write('GET_STATUS');
        });

        let data = '';
        socket.on('data', (chunk) => {
            data += chunk.toString();
        });

        socket.on('end', () => {
            try {
                resolve(JSON.parse(data) as DaemonState);
            } catch {
                resolve(null);
            }
        });

        socket.on('error', () => {
            resolve(null);
        });

        setTimeout(() => {
            socket.destroy();
            resolve(null);
        }, 5000);
    });
}

export function isDaemonRunning(workspacePath: string): boolean {
    const pidPath = getPidPath(workspacePath);
    if (!fs.existsSync(pidPath)) {
        return false;
    }

    try {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function runSvelteCheckDirectly(
    workspacePath: string,
    tsconfigPath?: string,
    failOnWarnings?: boolean
): { success: boolean; output: string } {
    const args = ['--output', 'human'];
    if (tsconfigPath) {
        args.push('--tsconfig', tsconfigPath);
    }
    if (failOnWarnings) {
        args.push('--fail-on-warnings');
    }

    const result = spawnSync('svelte-check', args, {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8'
    });

    const output = (result.stdout || '') + (result.stderr || '');
    return {
        success: result.status === 0,
        output
    };
}

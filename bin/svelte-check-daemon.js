#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getStatusFromDaemon, isDaemonRunning, runSvelteCheckDirectly } from '../dist/src/client.js';
import { getPidPath, SvelteCheckDaemon } from '../dist/src/daemon.js';

const args = process.argv.slice(2);
const command = args[0];

function parseArgs() {
    let workspacePath = process.cwd();
    let tsconfigPath = undefined;
    let failOnWarnings = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--workspace' && args[i + 1]) {
            workspacePath = path.resolve(args[i + 1]);
            i++;
        } else if (args[i] === '--tsconfig' && args[i + 1]) {
            tsconfigPath = args[i + 1];
            i++;
        } else if (args[i] === '--fail-on-warnings') {
            failOnWarnings = true;
        }
    }

    return { workspacePath, tsconfigPath, failOnWarnings };
}

async function runDaemon() {
    const { workspacePath, tsconfigPath } = parseArgs();
    const daemon = new SvelteCheckDaemon(workspacePath, tsconfigPath);
    await daemon.start();
}

async function runCheck() {
    const { workspacePath, tsconfigPath, failOnWarnings } = parseArgs();

    // In CI, always run svelte-kit sync first to ensure generated types are up to date
    if (process.env.CI || !isDaemonRunning(workspacePath)) {
        spawnSync('svelte-kit', ['sync'], {
            cwd: workspacePath,
            stdio: 'inherit'
        });
    }

    if (!isDaemonRunning(workspacePath)) {
        if (!process.env.CI) {
            console.error(
                '\x1b[33m⚠ svelte-check-daemon is not running. Running svelte-check directly (slower)...\x1b[0m'
            );
            console.error('\x1b[33m  Start the daemon with: svelte-check-daemon start\x1b[0m\n');
        }

        const { success, output } = runSvelteCheckDirectly(workspacePath, tsconfigPath, failOnWarnings);
        console.log(output);
        process.exit(success ? 0 : 1);
    }

    let status = await getStatusFromDaemon(workspacePath);
    if (!status) {
        console.error('\x1b[31mFailed to get status from daemon\x1b[0m');
        process.exit(1);
    }

    if (!status.isComplete) {
        const maxWaitMs = 120000;
        const pollIntervalMs = 500;
        const startTime = Date.now();

        while (!status.isComplete && Date.now() - startTime < maxWaitMs) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            status = await getStatusFromDaemon(workspacePath);
            if (!status) {
                console.error('\x1b[31mFailed to get status from daemon\x1b[0m');
                process.exit(1);
            }
        }

        if (!status.isComplete) {
            console.error('\x1b[31mTimeout waiting for svelte-check to complete\x1b[0m');
            process.exit(1);
        }
    }

    console.log(status.output);
    const shouldFail = status.hasErrors || (failOnWarnings && status.hasWarnings);
    process.exit(shouldFail ? 1 : 0);
}

function stopDaemon() {
    const { workspacePath } = parseArgs();

    const pidPath = getPidPath(workspacePath);
    if (!fs.existsSync(pidPath)) {
        console.error('Daemon is not running');
        process.exit(1);
    }

    try {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
        process.kill(pid, 'SIGTERM');
        console.log(`Stopped daemon (PID ${pid})`);
        process.exit(0);
    } catch (err) {
        console.error('Failed to stop daemon:', err);
        process.exit(1);
    }
}

async function showStatus() {
    const { workspacePath } = parseArgs();

    if (!isDaemonRunning(workspacePath)) {
        console.log('Daemon is not running');
        process.exit(1);
    }

    const status = await getStatusFromDaemon(workspacePath);
    if (status) {
        console.log('Daemon is running');
        console.log(`  Last update: ${new Date(status.lastUpdate).toISOString()}`);
        console.log(`  Complete: ${status.isComplete}`);
        console.log(`  Errors: ${status.hasErrors}`);
        console.log(`  Warnings: ${status.hasWarnings}`);
        process.exit(0);
    } else {
        console.error('Failed to get status from daemon');
        process.exit(1);
    }
}

function showHelp() {
    console.log(`Usage: svelte-check-daemon <command> [options]

Commands:
  start       Start the daemon (runs svelte-check --watch in background)
  check       Get the latest svelte-check results from the daemon
  stop        Stop the running daemon
  status      Show daemon status

Options:
  --workspace <path>     Path to workspace (default: current directory)
  --tsconfig <path>      Path to tsconfig.json
  --fail-on-warnings     Exit with error code when there are warnings (check command only)
  --help                 Show this help message
`);
}

async function main() {
    if (args.includes('--help') || args.includes('-h')) {
        showHelp();
        return;
    }

    switch (command) {
        case 'start':
            if (process.env.NO_SVELTE_CHECK_DAEMON === '1') {
                console.log('svelte-check-daemon disabled (NO_SVELTE_CHECK_DAEMON=1)');
                process.exit(0);
            }
            await runDaemon();
            break;
        case 'check':
            await runCheck();
            break;
        case 'stop':
            stopDaemon();
            break;
        case 'status':
            await showStatus();
            break;
        default:
            showHelp();
            process.exit(command ? 1 : 0);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

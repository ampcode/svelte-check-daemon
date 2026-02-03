# svelte-check-daemon

Instant `svelte-check` typechecking and diagnostics in [SvelteKit](https://svelte.dev/docs/kit/introduction) projects, by using a daemon that monitors `svelte-check --watch` and returns the latest results when you run `svelte-check-daemon check`.

## Usage

Add `@ampcode/svelte-check-daemon` as a dependency to your project:

```bash
npm install --save-dev @ampcode/svelte-check-daemon
# -or-
pnpm add -D @ampcode/svelte-check-daemon
```

Then update your `package.json` scripts to run `svelte-check-daemon start` alongside your dev server and `svelte-check-daemon check` to get results:

```json
{
    "scripts": {
        "dev": "concurrently \"svelte-check-daemon start --tsconfig tsconfig.json\" \"vite dev\"",
        "check": "svelte-check-daemon check"
    }
}
```

This uses [concurrently](https://www.npmjs.com/package/concurrently) to run both processes and ensure the daemon is properly terminated when you stop the dev server.

If the daemon isn't running, `svelte-check-daemon check` will just run `svelte-check`, which is a fallback in CI or if you've forgotten to run the daemon.

## Commands

| Command                      | Description                                                  |
| ---------------------------- | ------------------------------------------------------------ |
| `svelte-check-daemon start`  | Start the daemon (runs `svelte-check --watch` in background) |
| `svelte-check-daemon check`  | Get the latest results from the daemon                       |
| `svelte-check-daemon stop`   | Stop the running daemon                                      |
| `svelte-check-daemon status` | Show daemon status                                           |

## Options

| Option               | Description                                    |
| -------------------- | ---------------------------------------------- |
| `--workspace <path>` | Path to workspace (default: current directory) |
| `--tsconfig <path>`  | Path to tsconfig.json                          |
| `--help`             | Show help message                              |

## Signals

| Signal   | Description                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| `SIGHUP` | Restarts `svelte-check --watch`. Useful when you want to force a full recheck without restarting the daemon.   |

To force a restart: `pkill -HUP svelte-check-daemon`

## AGENTS.md

Add this to your project's `AGENTS.md` to help AI agents work with the daemon:

```markdown
If svelte-check results seem stale, run `pkill -HUP svelte-check-daemon` to force a full recheck.
```

## Environment variables

| Variable                          | Description                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WATCH_DIRS`                      | Comma-delimited list of relative paths to watch non-recursively (default: `""`). Use with `WATCH_DIRS_RECURSIVE` to watch root-level files without recursing into submodules. |
| `WATCH_DIRS_RECURSIVE`            | Comma-delimited list of relative paths to watch recursively (default: `.`). Set to `src` or `src,lib` to avoid watching submodules or vendor directories. |
| `SVELTE_CHECK_WATCH_BIG_CHANGES`  | Path to a directory (relative to cwd) to watch for deleted files. When a file is deleted in this directory, `svelte-check --watch` is restarted. Useful when `svelte-check --watch` gets out of sync after many file deletions. |
| `NO_SVELTE_CHECK_DAEMON`          | Set to `1` to disable the daemon (the `start` command will exit immediately, which means checking will always run a full `svelte-check` and not use cached results).                                                                                                                                  |
| `VERBOSE`                         | Set to enable verbose logging.                                                                                                                                                                                  |

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

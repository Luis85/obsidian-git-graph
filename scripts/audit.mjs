import { spawnSync } from 'node:child_process';

/**
 * `npm audit --omit=dev --audit-level=critical`, run with one inherited config stripped.
 *
 * The plain command works. Running it *through* `npm run` does not: npm exports every
 * resolved config key into the script's environment as `npm_config_*`, so a
 * `allow-scripts=<pkg>` line in the user's own `~/.npmrc` — which is legal where it is
 * written, and unrelated to this project — reaches the nested `npm audit` as
 * `npm_config_allow_scripts` and npm 12 rejects it with `EALLOWSCRIPTS: --allow-scripts is
 * not allowed in project-scoped installs`. The audit never runs, and the failure reads
 * like a broken audit script or a real advisory rather than one line of machine-global
 * config. Confirmed on npm 12.0.2, 2026-09-06.
 *
 * Deleting the key from the CHILD's environment is the whole fix: it does not touch the
 * user's `~/.npmrc`, it does not disable anything the user set that key for (nothing here
 * installs), and on a machine — every CI runner included — where the key was never set,
 * this deletes nothing and the command is identical.
 *
 * `--omit=dev` scopes the audit to what actually reaches a vault. `--audit-level=critical`
 * is what makes this a gate rather than a report: anything lower is advice, and a gate
 * nobody can clear is one people learn to ignore.
 */
const env = { ...process.env };
delete env.npm_config_allow_scripts;

const args = ['audit', '--omit=dev', '--audit-level=critical'];

// `npm_execpath` is npm's own CLI entry point, set by npm when it runs a script. Going
// through it with this Node avoids resolving `npm` on PATH — which on Windows is
// `npm.cmd`, a shell script, and so needs `shell: true` and the quoting that comes with
// it. The fallback covers running this file directly, outside `npm run`.
const npmCli = process.env.npm_execpath;
const { status, error } = npmCli
	? spawnSync(process.execPath, [npmCli, ...args], { stdio: 'inherit', env })
	: spawnSync('npm', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });

if (error) {
	console.error(`audit: could not run npm audit: ${error.message}`);
	process.exit(1);
}
process.exit(status ?? 1);

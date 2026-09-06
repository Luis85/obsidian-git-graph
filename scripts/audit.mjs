import { spawnSync } from 'node:child_process';

/**
 * `npm audit --omit=dev --audit-level=critical`, run with one inherited config key removed.
 *
 * `npm run` exports every resolved config key into the script's environment as
 * `npm_config_*`, including keys that came from a user- or global-level `.npmrc` this
 * repository does not control. `allow-scripts` is one npm 12 then refuses to accept from a
 * project scope: the nested `npm audit` sees `npm_config_allow_scripts`, exits with
 * `EALLOWSCRIPTS`, and audits nothing — while reading like a broken script or a real
 * advisory. The bare command is unaffected, so the failure appears only through `npm run`,
 * which is the one form CI uses.
 *
 * Deleting the key from the CHILD's environment is the whole fix. It touches no config
 * file, disables nothing (this command installs nothing), and where the key was never set
 * — every CI runner — it deletes nothing and the command is unchanged.
 *
 * `--omit=dev` scopes the audit to what actually reaches a vault: this plugin ships one
 * runtime dependency and the rest of the tree is build-time only. `--audit-level=critical`
 * is what makes this a gate rather than a report.
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

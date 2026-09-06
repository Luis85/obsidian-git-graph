import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Installs the built plugin into this repository's own vault: .obsidian/plugins/<id>/.
// Obsidian loads these three file names; the manifest and styles are source files,
// main.js is the vite build (`test-build` runs `vite build --mode development` first).
const VAULT_FILES = [
	['dist/main.js', 'main.js'],
	['manifest.json', 'manifest.json'],
	['styles.css', 'styles.css'],
];

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const vaultDir = '.obsidian';
const pluginDir = path.join(vaultDir, 'plugins', manifest.id);

await mkdir(pluginDir, { recursive: true });
await Promise.all(VAULT_FILES.map(([from, to]) => copyFile(from, path.join(pluginDir, to))));

const listed = await enablePlugin(manifest.id);

console.log(`\n${manifest.name} ${manifest.version} → ${pluginDir}`);
console.log('Open this folder as a vault in Obsidian (or reload it if it is already open).');
if (listed) console.log('First open: Settings → Community plugins → turn off Restricted Mode.');
console.log("The plugin is in the vault's enabled list.");

// Adds the id to community-plugins.json, merging with whatever is already there.
async function enablePlugin(id) {
	const listPath = path.join(vaultDir, 'community-plugins.json');
	let enabled = [];
	try {
		const parsed = JSON.parse(await readFile(listPath, 'utf8'));
		if (Array.isArray(parsed)) enabled = parsed.filter((entry) => typeof entry === 'string');
	} catch {
		// no vault config yet
	}
	if (enabled.includes(id)) return false;
	enabled.push(id);
	await writeFile(listPath, `${JSON.stringify(enabled, null, 2)}\n`);
	return true;
}

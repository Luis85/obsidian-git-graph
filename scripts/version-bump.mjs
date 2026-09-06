import { readFileSync, writeFileSync } from 'node:fs';

// Run by `npm version` (package.json's `version` script), which sets
// npm_package_version to the NEW version before this runs. It keeps the two files npm
// does not know about — manifest.json and versions.json — in step with package.json, and
// package.json's `version` script stages them so all three land in one commit.
const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	console.error('version-bump.mjs expects npm_package_version; run it through `npm version`.');
	process.exit(1);
}

// Sync manifest.json with the version from `npm version`.
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, '  ')}\n`);

// Record the minimum app version this release needs. Obsidian reads versions.json to
// decide which release to offer a vault running an older app.
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', `${JSON.stringify(versions, null, '  ')}\n`);

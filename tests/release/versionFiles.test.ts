import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `package.json`, `manifest.json` and `versions.json` held against each other.
 *
 * `npm version` writes package.json and then `scripts/version-bump.mjs` writes the other
 * two, so in the normal path they cannot disagree. This exists for the paths that are not
 * that one: a version edited by hand in a single file, or a bump made without the
 * `version` script (a fresh clone whose `.npmrc` or scripts were bypassed). Obsidian
 * installs a plugin by reading `manifest.json`, and the release workflow refuses a tag
 * that disagrees with it — so a mismatch that reaches `main` is caught here, on the pull
 * request, rather than at publish time when the tag is already pushed.
 *
 * What this cannot check: that the version is the *right* one. Three files agreeing on
 * `0.1.0` when the change deserved a minor bump passes here and always will.
 */
describe('the version files agree', () => {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
	const versions = JSON.parse(readFileSync('versions.json', 'utf8'));

	it('gives manifest.json the same version as package.json', () => {
		expect(manifest.version).toBe(pkg.version);
	});

	it('records this version in versions.json against the manifest minAppVersion', () => {
		expect(versions[manifest.version]).toBe(manifest.minAppVersion);
	});

	it('names a plain x.y.z version, since the release tag must match it exactly', () => {
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
	});
});

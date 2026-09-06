import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function vueFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : [],
	);
}

describe('single-file components', () => {
	it('carry no <style> block; all CSS lives in styles.css', () => {
		for (const file of vueFiles('src')) {
			expect(readFileSync(file, 'utf8'), file).not.toMatch(/<style[\s>]/);
		}
	});

	it('manifest matches the spec identity', () => {
		const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
		expect(manifest).toMatchObject({ id: 'git-graph', name: 'Git Graph', minAppVersion: '1.13.0', isDesktopOnly: true });
	});

	// The lookbehind excludes bound `:class="..."` (and `v-bind:class="..."`) attributes, whose
	// class names are built from the same git-graph- prefix in code; only static class="..."
	// attributes are checked here.
	it('uses only git-graph- prefixed classes plus Obsidian core classes', () => {
		const allowed = new Set(['clickable-icon', 'mod-cta', 'dropdown']);
		for (const file of vueFiles('src')) {
			const src = readFileSync(file, 'utf8');
			for (const m of src.matchAll(/(?<![:\w-])class="([^"]+)"/g)) {
				for (const cls of (m[1] ?? '').split(/\s+/).filter(Boolean)) {
					expect(cls.startsWith('git-graph-') || allowed.has(cls), `${file}: ${cls}`).toBe(true);
				}
			}
		}
	});
});

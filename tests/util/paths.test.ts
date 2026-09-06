import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { realPath, samePath } from '../../src/util/paths';

describe('paths', () => {
	it('realPath canonicalizes an existing path and resolves a missing one', () => {
		const dir = mkdtempSync(join(tmpdir(), 'git-graph-paths-'));
		try {
			expect(realPath(dir)).toBe(realpathSync.native(dir));
			expect(realPath(join(dir, 'missing'))).toBe(resolve(join(dir, 'missing')));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('samePath treats the short, canonical, differently cased and linked spellings as one directory', () => {
		// tmpdir() is the 8.3 short form on Windows machines with a long profile name; the canonical form differs there.
		const short = mkdtempSync(join(tmpdir(), 'git-graph-paths-'));
		const canonical = realpathSync.native(short);
		const link = join(realpathSync.native(tmpdir()), `git-graph-paths-link-${process.pid}`);
		symlinkSync(canonical, link, 'junction');
		const other = mkdtempSync(join(tmpdir(), 'git-graph-paths-other-'));
		try {
			expect(samePath(short, canonical)).toBe(true);
			expect(samePath(link, canonical)).toBe(true);
			expect(samePath(canonical.toUpperCase(), canonical)).toBe(process.platform === 'win32');
			expect(samePath(other, canonical)).toBe(false);
		} finally {
			rmSync(link, { force: true });
			rmSync(short, { recursive: true, force: true });
			rmSync(other, { recursive: true, force: true });
		}
	});
});

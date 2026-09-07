import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { realPath, relativeWithin, samePath } from '../../src/util/paths';

describe('paths', () => {
	it('realPath canonicalizes an existing path and a missing one through its deepest existing ancestor', () => {
		const dir = mkdtempSync(join(tmpdir(), 'git-graph-paths-'));
		try {
			expect(realPath(dir)).toBe(realpathSync.native(dir));
			// The tail does not exist, but the directory holding it does: the result is the
			// canonical spelling of that directory plus the missing name, not the input spelling.
			expect(realPath(join(dir, 'missing'))).toBe(join(realpathSync.native(dir), 'missing'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// A vault opened through a symlink or junction, with the file already renamed away on disk:
	// the fallback path no longer exists, so realpath cannot canonicalize it directly. Resolving
	// it lexically would keep the link spelling, and relativeWithin would then call the file
	// outside a base git reports canonically — emptying the history of every renamed file.
	it('realPath follows a link in the existing ancestors of a missing path', () => {
		const base = mkdtempSync(join(tmpdir(), 'git-graph-paths-'));
		const target = realpathSync.native(base);
		const link = join(realpathSync.native(tmpdir()), `git-graph-paths-missing-${process.pid}`);
		symlinkSync(target, link, 'junction');
		try {
			expect(realPath(join(link, 'missing', 'note.md'))).toBe(join(target, 'missing', 'note.md'));
			expect(relativeWithin(target, join(link, 'gone.md'))).toBe('gone.md');
		} finally {
			rmSync(link, { force: true });
			rmSync(base, { recursive: true, force: true });
		}
	});

	it('relativeWithin reports a path inside the base and null for anything outside it', () => {
		const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-graph-paths-')));
		const other = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-graph-paths-other-')));
		try {
			expect(relativeWithin(base, join(base, 'a', 'b.md'))).toBe('a/b.md');
			// A file whose name starts with two dots stays inside; only `..` itself climbs out.
			expect(relativeWithin(base, join(base, '..notes.md'))).toBe('..notes.md');
			expect(relativeWithin(base, resolve(base, '..'))).toBeNull();
			expect(relativeWithin(base, other)).toBeNull();
		} finally {
			rmSync(base, { recursive: true, force: true });
			rmSync(other, { recursive: true, force: true });
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
			// Windows is always case-insensitive here. Elsewhere (e.g. macOS's default case-insensitive
			// APFS), realpath restores the on-disk case, so the upper-cased spelling can also canonicalize
			// equal to `canonical`; assert against what realpath actually reports instead of a fixed value.
			if (process.platform === 'win32') {
				expect(samePath(canonical.toUpperCase(), canonical)).toBe(true);
			} else {
				let upperResolvesToCanonical: boolean;
				try {
					upperResolvesToCanonical = realpathSync.native(canonical.toUpperCase()) === canonical;
				} catch {
					upperResolvesToCanonical = false;
				}
				expect(samePath(canonical.toUpperCase(), canonical)).toBe(upperResolvesToCanonical);
			}
			expect(samePath(other, canonical)).toBe(false);
		} finally {
			rmSync(link, { force: true });
			rmSync(short, { recursive: true, force: true });
			rmSync(other, { recursive: true, force: true });
		}
	});
});

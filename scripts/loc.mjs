import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Backstop for files eslint's size rules don't reach (.css, .mjs configs, etc.) — eslint's
// max-lines already caps src/** (300) and tests/scripts (500); this catches anything larger
// than either tier could reasonably justify.
const MAX_FILE_CODE_LINES = 400;

// `styles` is here because eslint reaches no CSS at all, so the 400-line backstop is the
// only cap the partials have. `styles-assemble.mjs` enforces the same number per partial at
// build time, which is what makes a too-large partial fail the BUILD rather than only the
// report; this keeps the whole directory visible in the LOC table alongside everything else.
const TOP_LEVEL_DIRS = ['src', 'tests', 'scripts', 'harness', 'styles'];
const EXTENSIONS = new Set(['.ts', '.vue', '.mjs', '.css']);
const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', '.obsidian']);

// Classifies each physical line of a file as blank, comment-only, or code. Handles `//` line
// comments, `/* ... */` and `<!-- ... -->` block comments (including multi-line ones), and
// `*` JSDoc-style continuation lines. A line that mixes code with a trailing comment (e.g.
// `const x = 1; // note`) counts as code, matching "comment-only lines" in the spec.
function classifyLines(text) {
	const lines = text.split(/\r\n|\r|\n/);
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	let blank = 0;
	let comment = 0;
	let code = 0;
	let closingToken = null; // set while inside a multi-line /* */ or <!-- --> block
	for (const raw of lines) {
		const line = raw.trim();
		if (line.length === 0) {
			blank++;
			continue;
		}
		if (closingToken !== null) {
			comment++;
			if (line.includes(closingToken)) closingToken = null;
			continue;
		}
		if (line.startsWith('//') || line.startsWith('*')) {
			comment++;
			continue;
		}
		if (line.startsWith('/*')) {
			comment++;
			if (!line.slice(2).includes('*/')) closingToken = '*/';
			continue;
		}
		if (line.startsWith('<!--')) {
			comment++;
			if (!line.slice(4).includes('-->')) closingToken = '-->';
			continue;
		}
		code++;
	}
	return { total: lines.length, blank, comment, code };
}

async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const files = [];
	for (const entry of entries) {
		if (IGNORED_DIR_NAMES.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(full)));
		} else if (EXTENSIONS.has(path.extname(entry.name))) {
			files.push(full);
		}
	}
	return files;
}

async function collect(rootDir) {
	const files = [];
	for (const top of TOP_LEVEL_DIRS) {
		const dir = path.join(rootDir, top);
		const found = await walk(dir);
		for (const file of found) {
			const text = await readFile(file, 'utf8');
			const stats = classifyLines(text);
			files.push({ path: path.relative(rootDir, file).split(path.sep).join('/'), topLevel: top, ...stats });
		}
	}
	return files;
}

function byTopLevelDir(files) {
	const dirs = new Map();
	for (const file of files) {
		const dir = dirs.get(file.topLevel) ?? { files: 0, code: 0, comment: 0, blank: 0, total: 0 };
		dir.files++;
		dir.code += file.code;
		dir.comment += file.comment;
		dir.blank += file.blank;
		dir.total += file.total;
		dirs.set(file.topLevel, dir);
	}
	return dirs;
}

function testsToSrcRatio(dirs) {
	const srcCode = dirs.get('src')?.code ?? 0;
	const testsCode = dirs.get('tests')?.code ?? 0;
	return { srcCode, testsCode, ratio: srcCode === 0 ? null : testsCode / srcCode };
}

function printDirTable(dirs) {
	console.log('\nLOC by directory (code lines exclude blank and comment-only lines):\n');
	console.log('directory'.padEnd(10), 'files'.padStart(6), 'code'.padStart(7), 'comment'.padStart(8), 'blank'.padStart(7), 'total'.padStart(7));
	for (const top of TOP_LEVEL_DIRS) {
		const d = dirs.get(top);
		if (!d) continue;
		console.log(top.padEnd(10), String(d.files).padStart(6), String(d.code).padStart(7), String(d.comment).padStart(8), String(d.blank).padStart(7), String(d.total).padStart(7));
	}
}

function printTopFiles(files) {
	const top10 = files.toSorted((a, b) => b.code - a.code).slice(0, 10);
	console.log('\nTop 10 files by code lines:\n');
	for (const f of top10) console.log(String(f.code).padStart(5), f.path);
}

function printRatio(ratio) {
	console.log('\ntests/src code ratio:', ratio.ratio === null ? 'n/a (no src files)' : `${ratio.ratio.toFixed(2)} (${ratio.testsCode} tests code lines / ${ratio.srcCode} src code lines)`);
}

function printOffenders(offenders) {
	console.log(`\nFiles over the ${MAX_FILE_CODE_LINES}-code-line backstop:\n`);
	for (const f of offenders) console.log(String(f.code).padStart(5), f.path);
}

async function main() {
	const rootDir = path.join(import.meta.dirname, '..');
	const files = await collect(rootDir);
	const offenders = files.filter((f) => f.code > MAX_FILE_CODE_LINES);
	const asJson = process.argv.includes('--json');

	if (asJson) {
		const dirs = Object.fromEntries(byTopLevelDir(files));
		console.log(JSON.stringify({ files, dirs, ratio: testsToSrcRatio(byTopLevelDir(files)), maxFileCodeLines: MAX_FILE_CODE_LINES, offenders }, null, 2));
	} else {
		const dirs = byTopLevelDir(files);
		printDirTable(dirs);
		printTopFiles(files);
		printRatio(testsToSrcRatio(dirs));
		if (offenders.length > 0) printOffenders(offenders);
	}

	if (offenders.length > 0) {
		console.error(`\nloc: ${offenders.length} file(s) exceed MAX_FILE_CODE_LINES (${MAX_FILE_CODE_LINES}).`);
		process.exitCode = 1;
	}
}

await main();

// Screenshots the harness pane in Chromium, one PNG per scenario and theme.
//
//   node scripts/screenshot.mjs [--scenario=name|all] [--theme=light|dark|both]
//                               [--out=screenshots] [--url=http://host:port]
//                               [--width=420] [--height=700]
//
// Without --url it starts the harness dev server itself (vite.harness.config.ts) and shuts it
// down again, so `npm run screenshot` is a single command. Requires `npm run harness:install`
// once, to download the Chromium build Playwright drives.

import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = path.join(import.meta.dirname, '..');
const THEMES = ['light', 'dark'];
const PORT = 5174;

function parseArgs(argv) {
	const args = new Map();
	for (const arg of argv) {
		const match = /^--([^=]+)=(.*)$/.exec(arg);
		if (match === null) throw new Error(`screenshot: unrecognized argument "${arg}"`);
		args.set(match[1], match[2]);
	}
	const theme = args.get('theme') ?? 'both';
	if (theme !== 'both' && !THEMES.includes(theme)) throw new Error(`screenshot: --theme must be light, dark or both`);
	return {
		scenario: args.get('scenario') ?? 'all',
		themes: theme === 'both' ? THEMES : [theme],
		out: path.resolve(ROOT, args.get('out') ?? 'screenshots'),
		url: args.get('url') ?? null,
		width: Number(args.get('width') ?? 420),
		height: Number(args.get('height') ?? 700),
	};
}

/** Reuse a harness someone already has running (`npm run harness`) — the port is strict. */
async function alreadyServing(url) {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
		return response.ok;
	} catch {
		return false;
	}
}

async function startHarness() {
	const running = `http://localhost:${PORT}/`;
	if (await alreadyServing(running)) {
		console.log(`harness dev server: ${running} (already running, reused)`);
		return { url: running, close: async () => {} };
	}
	const server = await createServer({
		configFile: path.join(ROOT, 'vite.harness.config.ts'),
		root: path.join(ROOT, 'harness'),
		logLevel: 'warn',
		server: { port: PORT, strictPort: true },
	});
	await server.listen();
	const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${PORT}/`;
	console.log(`harness dev server: ${url}`);
	return { url, close: () => server.close() };
}

function pageUrl(base, scenario, theme, options) {
	const url = new URL(base);
	url.search = new URLSearchParams({
		scenario,
		theme,
		width: String(options.width),
		height: String(options.height),
	}).toString();
	return url.toString();
}

async function shoot(page, base, scenario, theme, options) {
	await page.goto(pageUrl(base, scenario, theme, options), { waitUntil: 'load' });
	await page.evaluate(() => window.__harness.ready);
	const file = path.join(options.out, `${scenario}-${theme}.png`);
	await page.locator('#app').screenshot({ path: file });
	const { size } = await stat(file);
	console.log(`${path.relative(ROOT, file).split(path.sep).join('/')}  ${size} bytes`);
	return file;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	await mkdir(options.out, { recursive: true });

	const harness = options.url === null ? await startHarness() : { url: options.url, close: async () => {} };
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: options.width + 48, height: options.height + 140 } });
		await page.goto(harness.url, { waitUntil: 'load' });
		const all = await page.evaluate(() => window.__harness.scenarios.map((s) => s.name));
		const scenarios = options.scenario === 'all' ? all : [options.scenario];
		const unknown = scenarios.filter((name) => !all.includes(name));
		if (unknown.length > 0) throw new Error(`screenshot: unknown scenario(s) ${unknown.join(', ')}; known: ${all.join(', ')}`);

		const written = [];
		for (const scenario of scenarios) {
			for (const theme of options.themes) {
				written.push(await shoot(page, harness.url, scenario, theme, options));
			}
		}
		console.log(`\nwrote ${written.length} screenshot(s) to ${path.relative(ROOT, options.out)}/`);
	} finally {
		await browser.close();
		await harness.close();
	}
}

await main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});

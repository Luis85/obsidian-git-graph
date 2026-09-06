import { expect, test, type Page } from '@playwright/test';

// Smoke tests for the browser harness. They assert that the real view tree renders against the
// fixture repositories — not that pixels match. Every wait is a Playwright locator/poll
// assertion or `window.__harness.ready`; there are no sleeps.

/** Waits for main.ts to have installed the API, then for its first load to settle. */
async function waitReady(page: Page): Promise<void> {
	await page.waitForFunction(() => window.__harness !== undefined);
	await page.evaluate(() => window.__harness.ready);
}

async function open(page: Page, query: string): Promise<void> {
	await page.goto(`/?${query}`);
	await waitReady(page);
}

function spacerHeight(page: Page): Promise<number> {
	return page.locator('.git-graph-list-spacer').evaluate((el) => el.getBoundingClientRect().height);
}

test('merge renders one row per commit', async ({ page }) => {
	await open(page, 'scenario=merge');
	await expect(page.locator('.git-graph-row')).toHaveCount(8);
	await expect(page.locator('.git-graph-row-dirty')).toHaveCount(0);
	await expect(page.locator('svg.git-graph-lanes').first()).toBeVisible();
});

test('dirty adds a working tree row above the commits', async ({ page }) => {
	await open(page, 'scenario=dirty');
	await expect(page.locator('.git-graph-row-dirty')).toHaveCount(1);
	await expect(page.locator('.git-graph-row-dirty')).toContainText('3 changes');
	await expect(page.locator('.git-graph-row')).toHaveCount(9);
});

test('dirty expands the changes row into the working tree files', async ({ page }) => {
	await open(page, 'scenario=dirty');
	await expect(page.locator('.git-graph-dirty-details')).toHaveCount(0);
	await page.locator('.git-graph-row-dirty').click();
	await expect(page.locator('.git-graph-dirty-details .git-graph-file')).toHaveCount(3);
});

test('clicking a file in the dirty changes row records it on window.__harness.opened', async ({ page }) => {
	await open(page, 'scenario=dirty');
	await page.locator('.git-graph-row-dirty').click();
	await page.locator('.git-graph-dirty-details .git-graph-file-link').first().click();
	await expect.poll(() => page.evaluate(() => window.__harness.opened)).toHaveLength(1);
});

test('branches marks the HEAD ref, and HEAD is not the first row', async ({ page }) => {
	await open(page, 'scenario=branches');
	const headRow = page.locator('.git-graph-row-head');
	await expect(headRow).toHaveCount(1);
	await expect(headRow.locator('.git-graph-ref-head')).toHaveCount(1);
	const rows = page.locator('.git-graph-row');
	await expect(rows.first()).not.toHaveClass(/git-graph-row-head/);
});

test('dark theme sets body.theme-dark and paints a dark background', async ({ page }) => {
	await open(page, 'scenario=merge&theme=dark');
	await expect(page.locator('body')).toHaveClass(/theme-dark/);
	const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(background).not.toBe('rgb(255, 255, 255)');
	expect(background).not.toBe('rgba(0, 0, 0, 0)');
});

test('rows below the details keep their measured offset after collapsing and expanding another row', async ({ page }) => {
	await open(page, 'scenario=long');
	const rows = page.locator('.git-graph-row');
	const measure = () =>
		page.evaluate(() => {
			const host = document.querySelector<HTMLElement>('.git-graph-details')?.parentElement ?? null;
			const items = [...document.querySelectorAll<HTMLElement>('.git-graph-item')];
			const at = items.findIndex((item) => host !== null && item.contains(host));
			const [expandedY, nextY] = [items[at], items[at + 1]].map((el) => Number(/translateY\((-?\d+(?:\.\d+)?)px\)/.exec(el?.style.transform ?? '')?.[1] ?? NaN));
			return { hostHeight: host?.offsetHeight ?? 0, expandedY: expandedY ?? NaN, nextY: nextY ?? NaN };
		});

	await rows.nth(1).click();
	await expect(page.locator('.git-graph-details-hash code')).toBeVisible();
	await expect.poll(async () => (await measure()).nextY).not.toBeNaN();
	const first = await measure();
	expect(first.hostHeight).toBeGreaterThan(0);
	expect(first.nextY).toBe(first.expandedY + 22 + first.hostHeight);

	await rows.nth(1).click();
	await expect(page.locator('.git-graph-details')).toHaveCount(0);

	await rows.nth(5).click();
	await expect(page.locator('.git-graph-details-hash code')).toBeVisible();
	await expect.poll(async () => {
		const m = await measure();
		return m.nextY === m.expandedY + 22 + m.hostHeight;
	}).toBe(true);
});

test('clicking a commit row opens its details', async ({ page }) => {
	await open(page, 'scenario=merge');
	await expect(page.locator('.git-graph-details')).toHaveCount(0);
	await page.locator('.git-graph-row').first().click();
	await expect(page.locator('.git-graph-details')).toBeVisible();
	await expect(page.locator('.git-graph-details-hash code')).toHaveText(/^[0-9a-f]{40}$/);
});

test('clicking a changed file records it on window.__harness.opened', async ({ page }) => {
	await open(page, 'scenario=merge');
	await page.locator('.git-graph-row').first().click();
	await page.locator('.git-graph-file-link').first().click();
	await expect.poll(() => page.evaluate(() => window.__harness.opened)).toHaveLength(1);
});

test('a text filter hides the lane graph but keeps matching rows', async ({ page }) => {
	await open(page, 'scenario=merge&filter=Fix');
	await expect(page.locator('svg.git-graph-lanes')).toHaveCount(0);
	const rows = page.locator('.git-graph-row');
	expect(await rows.count()).toBeGreaterThan(0);
	expect(await rows.count()).toBeLessThan(8);
	await expect(rows.first()).toContainText('Fix');
});

test('long pages in more commits when scrolled to the bottom', async ({ page }) => {
	await open(page, 'scenario=long');
	const before = await spacerHeight(page);
	await page.locator('.git-graph-list').evaluate((el) => el.scrollTo(0, el.scrollHeight));
	await expect.poll(() => spacerHeight(page)).toBeGreaterThan(before);
});

test('none reports that the vault is not a git repository', async ({ page }) => {
	await open(page, 'scenario=none');
	await expect(page.locator('.git-graph-empty')).toContainText('not a git repository');
	await expect(page.locator('.git-graph-row')).toHaveCount(0);
});

test('empty reports that there are no commits', async ({ page }) => {
	await open(page, 'scenario=empty');
	await expect(page.locator('.git-graph-empty')).toContainText('No commits yet.');
});

test('error shows a banner and keeps the rows it already had', async ({ page }) => {
	await open(page, 'scenario=error');
	await expect(page.locator('.git-graph-banner')).toBeVisible();
	await expect(page.locator('.git-graph-banner-text')).toContainText('fatal: bad object HEAD');
	expect(await page.locator('.git-graph-row').count()).toBeGreaterThan(0);
});

test('the harness exposes its scenarios and controls to an agent', async ({ page }) => {
	await open(page, 'scenario=merge');
	const names = await page.evaluate(() => window.__harness.scenarios.map((s) => s.name));
	expect(names).toContain('octopus');
	expect(names).toContain('slow');
	await page.evaluate(() => window.__harness.setFilter('Fix'));
	await expect(page.locator('svg.git-graph-lanes')).toHaveCount(0);
});

test('octopus renders a merge node with three parents', async ({ page }) => {
	await open(page, 'scenario=octopus');
	await expect(page.locator('circle.git-graph-node-merge').first()).toBeVisible();
	await expect(page.locator('.git-graph-row').first()).toContainText('Merge');
});

test('expand opens a commit from the URL and dateFormat switches the date column', async ({ page }) => {
	await open(page, 'scenario=merge&expand=Initial+commit&dateFormat=absolute');
	await expect(page.locator('.git-graph-details')).toBeVisible();
	await expect(page.locator('.git-graph-details-body')).toContainText('Initial commit');
	await expect(page.locator('.git-graph-date').first()).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('slow resolves its commit details after the fixture delay', async ({ page }) => {
	await open(page, 'scenario=slow&expand=Initial+commit');
	await expect(page.locator('.git-graph-details-loading')).toBeVisible();
	await expect(page.locator('.git-graph-details-body')).toBeVisible();
	await expect(page.locator('.git-graph-files .git-graph-file').first()).toBeVisible();
});

test('an expand= that matches nothing fails loudly instead of rendering a plausible page', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	await page.goto('/?scenario=merge&expand=no-such-commit');
	await page.waitForFunction(() => window.__harness !== undefined);
	const outcome = await page.evaluate(() => window.__harness.ready.then(() => 'resolved', (e: unknown) => `rejected: ${String(e)}`));
	expect(outcome).toMatch(/^rejected: .*no-such-commit/);
	expect(errors.some((t) => t.includes('no-such-commit'))).toBe(true);
});

test('the harness toast shows what a file click would open and clears on the next change', async ({ page }) => {
	await open(page, 'scenario=merge');
	const toast = page.locator('.harness-toast');
	await expect(toast).toBeHidden();
	await page.locator('.git-graph-row').first().click();
	await page.locator('.git-graph-file-link').first().click();
	await expect(toast).toBeVisible();
	await expect(toast).toHaveText(/^Would open .+/);
	await page.locator('#harness-emit').click();
	await expect(toast).toBeHidden();
});

test('the toolbar lists every scenario and navigates when one is picked', async ({ page }) => {
	await open(page, 'scenario=merge');
	const count = await page.evaluate(() => window.__harness.scenarios.length);
	await expect(page.locator('#harness-scenario option')).toHaveCount(count);
	await expect(page.locator('#harness-description')).toContainText('feature branch');
	await page.locator('#harness-scenario').selectOption('branches');
	await expect(page).toHaveURL(/scenario=branches/);
	await waitReady(page);
	await expect(page.locator('.git-graph-row-head')).toHaveCount(1);
});

// Browser-only QA of the real Webview assets with synthetic host messages.
// Run npm run build first. No VS Code host, user records, or model calls are used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchUiBrowser } from './ui-browser.mjs';

const root = process.cwd(), out = path.join(root, 'artifacts/analytics-ui');
execFileSync(process.execPath, ['scripts/preview-analytics.mjs'], { cwd: root, stdio: 'inherit' });
const fixture = JSON.parse(await readFile(path.join(out, 'fixture.json'), 'utf8'));
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(out, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(out + path.sep)) { response.writeHead(403).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await launchUiBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.actions = [];
    let factory;
    Object.defineProperty(window, 'acquireVsCodeApi', {
      configurable: true, get: () => factory,
      set(value) {
        factory = () => {
          const api = value();
          return { ...api, postMessage(message) { window.actions.push(structuredClone(message)); api.postMessage(message); } };
        };
      },
    });
  });
  const url = (theme = 'dark', scenario = '') => `http://127.0.0.1:${server.address().port}/${theme}.html${scenario ? '?scenario=' + scenario : ''}`;
  const open = async (theme = 'dark', scenario = '') => {
    await page.goto(url(theme, scenario));
    await page.waitForFunction(() => document.querySelector('.metric') || document.querySelector('#detail-page .empty-state'));
  };
  const noPageOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'Horizontal scrolling should stay inside tables, not the page');
  const readable = async selector => {
    const ratios = await page.locator(selector).evaluateAll(elements => {
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
      canvas.width = canvas.height = 1;
      const pixel = color => {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      const luminance = rgb => rgb.slice(0, 3).map(value => {
        value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      return elements.filter(element => element.getBoundingClientRect().width > 0).map(element => {
        const layers = [];
        for (let node = element; node; node = node.parentElement) layers.unshift(pixel(getComputedStyle(node).backgroundColor));
        let background = [0, 0, 0];
        for (const rgba of layers) background = background.map((value, index) => rgba[index] * rgba[3] / 255 + value * (1 - rgba[3] / 255));
        const foreground = pixel(getComputedStyle(element).color), a = luminance(foreground), b = luminance(background);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
    });
    assert.ok(ratios.length && ratios.every(ratio => ratio >= 4.5), `${selector} contrast: ${ratios.join(',')}`);
  };
  const total = rows => rows.filter(row => !row.stats.inherited).reduce((sum, row) => sum + (row.stats.tokens?.total ?? 0), 0).toLocaleString('zh-CN');
  const overviewTotal = () => page.locator('#overview-content > .metrics .metric-value').first().getAttribute('title');
  const selectedTurn = () => page.locator('.turn-chart [aria-pressed="true"]').getAttribute('data-turn');

  // Theme changes and split-editor widths must keep controls usable and overflow local.
  for (const theme of ['dark', 'light', 'contrast']) {
    await open(theme);
    assert.equal(await page.locator('.session-list tbody tr').count(), fixture.data.sessions.length);
    assert.equal(await overviewTotal(), total(fixture.data.sessions));
    await noPageOverflow();
    await readable('.metric-label, .metric-value, .metric-note, .session-link, .row-meta, th, .legend-share, .status-text');
    await page.locator('.session-link').first().focus();
    assert.equal(await page.locator('.session-link').first().evaluate(element => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    }), true, 'Keyboard focus should have a visible indicator');
    await page.locator('.session-link').first().evaluate(element => element.blur());
    await page.screenshot({ path: path.join(out, `overview-${theme}.png`), fullPage: true });
    for (const width of [960, 640, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await noPageOverflow();
      assert.equal(await page.locator('#query').isVisible(), true);
      assert.equal(await page.locator('#directory').isVisible(), true);
    }
    await page.screenshot({ path: path.join(out, `overview-${theme}-narrow.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-focus="detail-s0"]').click();
    await page.locator('#detail-page .turn-chart').waitFor();
    await noPageOverflow();
    await page.screenshot({ path: path.join(out, `detail-${theme}.png`), fullPage: true });
    for (const width of [960, 640, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await noPageOverflow();
      assert.equal(await page.locator('#detail-page .primary-button').isVisible(), true);
    }
    await page.screenshot({ path: path.join(out, `detail-${theme}-narrow.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Search and directory filters change the list and aggregate together; clearing restores both.
  await open();
  const query = fixture.data.sessions[0].title;
  await page.locator('#query').fill(query);
  const matching = fixture.data.sessions.filter(row => `${row.title} ${row.cwd} ${row.cwdLabel}`.includes(query));
  assert.equal(await page.locator('.session-list tbody tr').count(), matching.length);
  assert.equal(await overviewTotal(), total(matching));
  await page.locator('#query').fill('no-synthetic-record-matches-this');
  assert.equal(await page.locator('.session-list tbody tr').count(), 0);
  assert.equal(await page.locator('#overview-content .empty-state').isVisible(), true);
  await page.locator('#query').fill('');
  const directory = fixture.data.sessions[0].cwd;
  await page.locator('#directory').selectOption(directory);
  const inDirectory = fixture.data.sessions.filter(row => row.cwd === directory);
  assert.equal(await page.locator('.session-list tbody tr').count(), inDirectory.length);
  assert.equal(await overviewTotal(), total(inDirectory));
  await page.locator('#directory').selectOption('');
  assert.equal(await page.locator('.session-list tbody tr').count(), fixture.data.sessions.length);
  await page.locator('[data-focus="sort"]').selectOption('duration');
  const longest = [...fixture.data.sessions].sort((a, b) => (b.stats.recordedDurationMs ?? -1) - (a.stats.recordedDurationMs ?? -1) || b.updatedAt - a.updatedAt)[0];
  assert.equal(await page.locator('.session-link').first().getAttribute('data-focus'), `detail-${longest.id}`);

  // Keyboard activation, chart/list selection, and review target remain consistent.
  await page.locator('[data-focus="detail-s0"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#detail-page .turn-chart').waitFor();
  const firstTurn = page.locator('.turn-chart [data-turn="turn-0-0"]');
  await firstTurn.focus();
  await page.keyboard.press('Enter');
  assert.equal(await selectedTurn(), 'turn-0-0');
  assert.equal(await page.locator('[data-focus="turn-turn-0-0"]').evaluate(el => el.closest('tr').classList.contains('selected')), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await selectedTurn(), 'turn-0-1');
  assert.match(await page.locator('#turn-inspector').getAttribute('title'), /turn-0-1/);
  assert.equal(await page.locator('.turn-chart [data-turn="turn-0-1"]').evaluate(el => el === document.activeElement), true);
  await page.locator('[data-focus="inspect-turn-0-1"]').click();
  assert.deepEqual(await page.evaluate(() => window.actions.filter(action => action.action === 'review').at(-1)), { action: 'review', id: 's0', turnId: 'turn-0-1' });
  await page.locator('#overview').click();
  await page.locator('#overview-page').waitFor({ state: 'visible' });
  await page.locator('#overview').click();
  assert.equal(await page.locator('#detail-page').isHidden(), true);

  // Long histories coordinate chart pages and row pages without dropping selection.
  await open('dark', 'long');
  assert.equal(await page.locator('.turn-list tbody tr').count(), 30);
  assert.equal(await page.locator('.turn-chart [data-turn]').count(), 6);
  await page.locator('.chart-controls button').first().click();
  assert.equal(await page.locator('.turn-chart [data-turn]').count(), 40);
  await page.locator('.turn-chart [data-turn="long-40"]').click();
  assert.equal(await selectedTurn(), 'long-40');
  assert.equal(await page.locator('[data-focus="turn-long-40"]').evaluate(el => el.closest('tr').classList.contains('selected')), true);
  await page.locator('.turn-list .pagination button').last().click();
  assert.equal(await selectedTurn(), 'long-40');
  assert.equal(await page.locator('.turn-list tbody tr').count(), 26);

  // Refresh append does not steal the selected turn, including repeated refreshes.
  await open('dark', 'append');
  await page.locator('.turn-chart [data-turn="turn-0-0"]').click();
  await page.locator('#refresh').click();
  await page.locator('.turn-chart [data-turn="appended"]').waitFor();
  assert.equal(await selectedTurn(), 'turn-0-0');
  await page.locator('#refresh').click();
  assert.equal(await page.locator('.turn-chart [data-turn]').count(), 13);
  assert.equal(await selectedTurn(), 'turn-0-0');

  await open('light', 'empty');
  assert.equal(await page.locator('.session-list tbody tr').count(), 0);
  assert.equal(await page.locator('#overview-content .empty-state').isVisible(), true);
  assert.equal(await page.locator('#overview-content > .metrics .metric-value').first().getAttribute('title'), null);
  await open('light', 'zero');
  assert.equal(await page.locator('#detail-page > .metrics .metric-value').first().getAttribute('title'), '0');
  assert.equal(await page.locator('.turn-chart [data-turn]').count(), 2);
  await open('dark', 'missing');
  assert.equal(await page.locator('#detail-page .empty-state').isVisible(), true);
  assert.equal(await page.locator('#detail-page .turn-chart').count(), 0);
  await page.locator('#detail-page .back-link').click();
  assert.equal(await page.evaluate(() => window.actions.at(-1).action), 'overview');
  await open('dark', 'fork');
  assert.equal(await page.locator('#detail-page .scope-note').isVisible(), true);
  await open('dark', 'offline');
  assert.equal(await page.locator('.live-running').count(), 0);

  // Reduced-motion settings must also suppress the live-status animation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open();
  assert.equal(await page.locator('.live-running svg').evaluateAll(icons => icons.some(icon => icon.getAnimations().length)), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ themes: true, textContrast: true, visibleFocus: true, responsiveLayout: true, filteredAggregates: true, sorting: true,
    keyboardSelection: true, chartTableSync: true, reviewTarget: true, repeatedNavigation: true,
    longHistoryPaging: true, selectionAfterRefresh: true, emptyMissingZeroFork: true,
    offlineState: true, reducedMotion: true, browserFixtureOnly: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

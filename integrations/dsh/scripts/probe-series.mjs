/** 系列 Matter 真实数据只读回归：系列程序在右侧栏的展示与标签。 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.CASEBENCH_PLAYWRIGHT) throw new Error('请用 CASEBENCH_PLAYWRIGHT 指定已有 Playwright Core 入口。');
const { chromium } = await import(pathToFileURL(process.env.CASEBENCH_PLAYWRIGHT));
const root = process.env.CASEBENCH_WORKSPACE || `${process.env.HOME}/Documents/My Legal-agents`;
const seriesName = process.env.CASEBENCH_SERIES;
if (!seriesName) throw new Error('请用 CASEBENCH_SERIES 指定要验证的系列 Matter 名称（真实案件名不入库）。');
const view = resolve(import.meta.dirname, '../dist/skill/scripts/casebench_view.py');
const read = (...args) => JSON.parse(execFileSync('python3.12', [view, ...args], { encoding: 'utf8' }));
const workspace = read('workspace', '--root', root);
const series = workspace.matters.find((item) => item.name === seriesName);
assert.ok(series, `工作区中没有 ${seriesName}`);
assert.ok(series.proceeding_count > 8, '系列案件程序数不足以验证（要求 > 8）');
const detail = read('matter', '--case-dir', series.path);
assert.equal(detail.proceedings.length, series.proceeding_count);

let host, browser;
try {
  const url = await new Promise((done, fail) => {
    host = spawn('dsh', ['web', '--no-open', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => fail(new Error('DSH boot timeout')), 30000);
    host.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);
      if (match) { clearTimeout(timer); done(match[0]); }
    });
    host.on('error', fail);
  });
  browser = await chromium.launch({ executablePath: process.env.CASEBENCH_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.mouse.click(1415, 25);
  await page.getByText('案件工作台', { exact: true }).click();

  // 列表卡片：系列案件应显示程序数量。
  const card = page.getByPlaceholder('搜索案件').locator('..').getByRole('button')
    .filter({ has: page.getByText(seriesName, { exact: true }) });
  await card.waitFor();
  assert.ok((await card.textContent()).includes(`${series.proceeding_count} 个关联案件`), '列表卡片未显示关联案件数');
  await card.click();

  // 详情：标题、关联案件分节、全部程序逐行渲染且标签中文化。
  await page.getByRole('heading', { name: `关联案件 · ${series.proceeding_count}`, exact: true }).waitFor();
  const tab = page.locator('[data-sidebar-right-tab]').filter({ has: page.getByRole('heading', { name: '最近工作', exact: true }) });
  const text = await tab.textContent();
  for (const item of detail.proceedings) {
    assert.ok(text.includes(item.name), `缺少程序：${item.name}`);
    assert.ok(text.includes(item.case_number || '案号待核'), `缺少案号：${item.proceeding_id}`);
  }
  for (const bad of ['first-instance', 'second-instance', 'retrial-review', 'interlocutory', 'closed', 'appealed', 'appeal-filed', 'withdrawn', 'unknown']) {
    assert.ok(!text.includes(bad), `页面残留英文代码：${bad}`);
  }
  for (const good of ['一审', '二审', '再审审查', '中间程序', '已结案', '已上诉', '已提起上诉', '已撤回']) {
    assert.ok(text.includes(good), `缺少中文标签：${good}`);
  }
  // 数量行与只读子页。
  const statutes = detail.authority_refs.filter((item) => item.type === 'statute').length;
  const cases = detail.authority_refs.filter((item) => item.type === 'case').length;
  await tab.getByRole('button', { name: new RegExp(`已定稿\\s+${detail.final_artifact_count}`) }).waitFor();
  await tab.getByRole('button', { name: new RegExp(`本案法条\\s+${statutes}`) }).click();
  await page.getByRole('heading', { name: '本案法条', exact: true }).waitFor();
  const statutePage = page.locator('[data-sidebar-right-tab]').last();
  const statuteText = await statutePage.textContent();
  for (const item of detail.authority_refs.filter((entry) => entry.type === 'statute')) {
    assert.ok(statuteText.includes(item.title), `法管子页缺少：${item.title}`);
    assert.ok(statuteText.includes('核验：已核验'), '法管子页缺少核验状态');
  }
  await page.getByRole('button', { name: '← 返回', exact: true }).click();
  await page.getByRole('heading', { name: `关联案件 · ${series.proceeding_count}`, exact: true }).waitFor();
  assert.equal(errors.length, 0, '页面产生异常');
  assert.equal(await page.getByRole('alert').count(), 0, '出现错误提示');
  console.log(JSON.stringify({ series: seriesName, proceedings: series.proceeding_count, statutes, cases,
    finals: detail.final_artifact_count, allProceedingsRendered: true, labelsChinese: true, pageErrors: errors.length }));
} catch (error) {
  console.error(String(error.stack || error).replace(/([?&]token=)[^\s"'&]+/g, '$1[redacted]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  host?.kill('SIGTERM');
}

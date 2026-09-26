/** 用户 Profile 的只读浏览器回归；认证链接仅在内存使用，不写日志。 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { stat, readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.CASEBENCH_PLAYWRIGHT) throw new Error('请用 CASEBENCH_PLAYWRIGHT 指定已有 Playwright Core 入口。');
const { chromium } = await import(pathToFileURL(process.env.CASEBENCH_PLAYWRIGHT));
const root = process.env.CASEBENCH_WORKSPACE || `${process.env.HOME}/Documents/My Legal-agents`;
const view = resolve(import.meta.dirname, '../dist/skill/scripts/casebench_view.py');
const read = (...args) => JSON.parse(execFileSync('python3.12', [view, ...args], { encoding: 'utf8' }));
const workspace = read('workspace', '--root', root);
const practice = read('practice-list', '--root', root);
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
  page.on('console', (message) => { if (message.type() === 'error' && /same key|casebench/i.test(message.text())) errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.mouse.click(1415, 25);
  await page.getByText('案件工作台', { exact: true }).click();
  for (let index = 0; index < 4; index++) {
    await page.getByRole('button', { name: '办案经验', exact: true }).click();
    const notes = page.getByPlaceholder('搜索办案经验').locator('..').locator(':scope > button');
    await page.waitForFunction((count) => {
      const input = document.querySelector('input[aria-label="搜索办案经验"]');
      return input && input.parentElement.querySelectorAll(':scope > button').length === count;
    }, practice.notes.length);
    assert.equal(await notes.count(), practice.notes.length);
    assert.deepEqual(await notes.locator('strong').allTextContents(), practice.notes.map((item) => item.title));
    await page.getByRole('button', { name: '案件', exact: true }).click();
    const matters = page.getByPlaceholder('搜索案件').locator('..').locator(':scope > button');
    assert.equal(await matters.count(), workspace.matters.length);
    assert.deepEqual(await matters.locator('strong').allTextContents(), workspace.matters.map((item) => item.name));
    assert.ok(!(await matters.allTextContents()).some((text) => text.includes('unknown')));
  }
  let sample, docx;
  for (const matter of workspace.matters) {
    if (matter.status !== 'ok') continue;
    const detail = read('matter', '--case-dir', matter.path);
    for (const [index, artifact] of detail.recent_artifacts.slice(0, 6).entries()) {
      if (!artifact.path || !/\.(md|docx)$/.test(artifact.path)) continue;
      const absolute = resolve(matter.path, artifact.path);
      if (!(await stat(absolute)).isFile()) continue;
      if (artifact.path.endsWith('.md') && !sample) sample = { matter, artifact, index, absolute };
      if (artifact.path.endsWith('.docx') && !docx) docx = { matter, artifact, index, absolute };
    }
    if (sample && docx) break;
  }
  assert.ok(sample, '真实工作区没有可供只读打开验证的 Markdown 成果');
  await page.getByPlaceholder('搜索案件').locator('..').getByRole('button').filter({ has: page.getByText(sample.matter.name, { exact: true }) }).click();
  await page.getByRole('heading', { name: '最近工作', exact: true }).waitFor();
  const caseTab = page.locator('[data-sidebar-right-tab]').filter({ has: page.getByRole('heading', { name: '最近工作', exact: true }) });
  await caseTab.getByRole('button', { name: '打开', exact: true }).nth(sample.index).click();
  await page.getByText(basename(sample.absolute), { exact: true }).first().waitFor({ timeout: 15000 });
  const source = await readFile(sample.absolute, 'utf8');
  const heading = source.match(/^#{1,6}\s+(.+)$/m)?.[1];
  assert.ok(heading, 'Markdown 样本缺少用于比对显示内容的标题');
  await page.waitForFunction((text) => [...document.querySelectorAll('[data-sidebar-right-tab]')]
    .some((node) => node.innerText.includes(text)), heading, { timeout: 15000 });
  // 再次点击同一成果，验证 tab 去重和返回后动作仍然有效。
  await page.getByText('案件工作台', { exact: true }).first().click();
  if (await page.getByPlaceholder('搜索案件').isVisible()) {
    await page.getByPlaceholder('搜索案件').locator('..').getByRole('button').filter({ has: page.getByText(sample.matter.name, { exact: true }) }).click();
    await page.getByRole('heading', { name: '最近工作', exact: true }).waitFor();
  }
  await caseTab.getByRole('button', { name: '打开', exact: true }).nth(sample.index).click();
  await page.getByText(basename(sample.absolute), { exact: true }).first().waitFor();
  assert.ok(docx, '真实工作区没有可供只读打开验证的 Word 成果');
  await page.getByText('案件工作台', { exact: true }).first().click();
  if (!await page.getByPlaceholder('搜索案件').isVisible()) await page.getByRole('button', { name: '← 返回', exact: true }).click();
  await page.getByPlaceholder('搜索案件').locator('..').getByRole('button').filter({ has: page.getByText(docx.matter.name, { exact: true }) }).click();
  await page.getByRole('heading', { name: '最近工作', exact: true }).waitFor();
  await caseTab.getByRole('button', { name: '打开', exact: true }).nth(docx.index).click();
  await page.locator('[data-pdf-preview] canvas').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-pdf-text]')]
    .some((node) => node.textContent.length > 20), undefined, { timeout: 15000 });
  assert.equal(errors.length, 0, '页面产生 React key 或点击异常');
  assert.equal(await page.getByRole('alert').count(), 0, '打开后出现错误提示');
  console.log(JSON.stringify({ switchRounds: 4, practiceRows: practice.notes.length, matterRows: workspace.matters.length, openedMarkdown: true, contentVerified: true, openAttempts: 2, openedWord: true, pageErrors: errors.length }));
} catch (error) {
  console.error(String(error.stack || error).replace(/([?&]token=)[^\s"'&]+/g, '$1[redacted]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  host?.kill('SIGTERM');
}

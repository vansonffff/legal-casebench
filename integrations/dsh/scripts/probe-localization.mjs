/** 案件工作台的中文界面回归；只读真实工作区，认证链接仅在内存使用。 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
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
    const timer = setTimeout(() => fail(new Error('服务启动超时')), 30000);
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
  let matterDetails = 0, referencePages = 0, noteDetails = 0, authorityDetails = 0;
  const forbidden = /\b(?:debtor|administrator|plaintiff|appellant|respondent-to-application|unknown|first-instance|second-instance|retrial-review|interlocutory|active|closed|appeal-filed|appealed|withdrawn|research|analysis|final|verified|unverified|partially_verified|statute|Recall|Matter|CaseBench|Core Version)\b/;
  async function checkPane() {
    const pane = page.locator('[data-sidebar-right-tab]').filter({ has: page.getByRole('heading', { name: '案件工作台', exact: true }) });
    const text = await pane.innerText();
    assert.ok(!forbidden.test(text), '案件工作台仍显示英文系统术语');
    assert.equal(await pane.getByRole('alert').count(), 0);
  }
  const roleNames = { debtor: '债务人', administrator: '管理人', plaintiff: '原告', appellant: '上诉人', 'respondent-to-application': '被申请人' };
  for (const matter of workspace.matters.filter(item => item.status === 'ok')) {
    await page.getByPlaceholder('搜索案件').locator('..').getByRole('button').filter({ has: page.getByText(matter.name, { exact: true }) }).click();
    await page.getByRole('heading', { name: '最近工作', exact: true }).waitFor();
    const detail = page.getByRole('heading', { name: matter.name, exact: true }).locator('..');
    if (roleNames[matter.role]) assert.ok((await detail.innerText()).includes(roleNames[matter.role]));
    await checkPane();
    matterDetails++;
    for (const [label, title] of [['已定稿', '已定稿'], ['本案法条', '本案法条'], ['参考案例', '参考案例']]) {
      await detail.getByRole('button', { name: new RegExp('^' + label) }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await checkPane();
      referencePages++;
      await page.getByRole('button', { name: '← 返回', exact: true }).click();
    }
    await page.getByRole('button', { name: '← 返回', exact: true }).click();
  }
  await page.getByRole('button', { name: '办案经验', exact: true }).click();
  await page.getByPlaceholder('搜索办案经验').locator('..').locator(':scope > button').first().waitFor();
  for (const note of practice.notes) {
    await page.getByPlaceholder('搜索办案经验').locator('..').getByRole('button').filter({ has: page.getByText(note.title, { exact: true }) }).click();
    await page.getByRole('heading', { name: '关联依据', exact: true }).waitFor();
    await checkPane();
    const authorities = page.getByRole('heading', { name: '关联依据', exact: true }).locator('..').getByRole('button');
    const count = await authorities.count();
    for (let index = 0; index < count; index++) {
      await authorities.nth(index).click();
      await page.getByText('类型', { exact: true }).waitFor();
      await checkPane();
      assert.ok(await page.getByText(/^(法律规范|参考案例)$/, { exact: true }).count());
      authorityDetails++;
      await page.getByRole('button', { name: '← 办案经验', exact: true }).click();
    }
    noteDetails++;
    await page.getByRole('button', { name: '← 办案经验', exact: true }).click();
  }
  // 从实际入口进入设置，核对插件设置的中文标签。
  const settingsButton = page.getByRole('button', { name: /^设置$/ });
  if (await settingsButton.count()) await settingsButton.first().click();
  else {
    const menu = page.getByRole('button', { name: /设置/ });
    assert.ok(await menu.count(), '找不到真实设置入口');
    await menu.first().click();
  }
  await page.getByText('案件工作台', { exact: true }).last().click();
  await page.getByText('核心版本', { exact: true }).waitFor();
  const settings = page.getByText('核心版本', { exact: true }).locator('..').locator('..');
  const settingsText = await settings.innerText();
  assert.ok(settingsText.includes('工作区路径') && settingsText.includes('已发现案件'));
  assert.ok(!forbidden.test(settingsText));
  assert.ok(settingsText.includes('测试版'));
  assert.equal(errors.length, 0);
  console.log(JSON.stringify({ matterDetails, referencePages, noteDetails, authorityDetails, settingsChecked: true, pageErrors: errors.length }));
} catch (error) {
  console.error(String(error.stack || error).replace(/([?&]token=)[^\s"'&]+/g, '$1[redacted]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  host?.kill('SIGTERM');
}

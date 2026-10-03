/**
 * 引用链路的端到端探针：在真实 DSH 会话里完成
 * 「展开争点 → 引用到对话 → 补充要求 → 发送 → 模型接收 → 会话记录留痕」。
 *
 * 与 probe-context.mjs 的区别：那个只验证界面，这个会**真的发一条消息并读会话记录**，
 * 因此会消耗一次模型调用，并且只在明确要求时运行（CASEBENCH_SEND=1）。
 *
 * 用法：
 *   CASEBENCH_PLAYWRIGHT=<playwright-core 入口> CASEBENCH_SEND=1 node scripts/probe-quote-chain.mjs
 * 环境变量：CASEBENCH_CASE（案件名）、CASEBENCH_ISSUE（争点 ID）、CASEBENCH_QUESTION（补充要求）、
 *          CASEBENCH_PYTHON、CASEBENCH_CHROME、CASEBENCH_REPLY_TIMEOUT_MS
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

if (process.env.CASEBENCH_SEND !== '1') throw new Error('本探针会真实发送消息，请显式设置 CASEBENCH_SEND=1。');
if (!process.env.CASEBENCH_PLAYWRIGHT) throw new Error('请用 CASEBENCH_PLAYWRIGHT 指定已有 Playwright Core 入口。');
const { chromium } = await import(pathToFileURL(process.env.CASEBENCH_PLAYWRIGHT));
const root = process.env.CASEBENCH_WORKSPACE || `${process.env.HOME}/Documents/My Legal-agents`;
const python = process.env.CASEBENCH_PYTHON || `${process.env.HOME}/.local/bin/python3.12`;
const view = resolve(import.meta.dirname, '../dist/skill/scripts/casebench_view.py');
const read = (...args) => JSON.parse(execFileSync(python, [view, ...args], { encoding: 'utf8' }));
const question = process.env.CASEBENCH_QUESTION || '请用一句话说明这个争点的核心分歧，不要使用工具。';
const replyTimeout = Number(process.env.CASEBENCH_REPLY_TIMEOUT_MS || 180000);

const workspace = read('workspace', '--root', root);
const matterName = process.env.CASEBENCH_CASE || workspace.matters.find((item) => item.status === 'ok')?.name;
assert.ok(matterName, '工作区里没有可用案件');
const context = read('context', '--case-dir', resolve(root, matterName));
const issueId = process.env.CASEBENCH_ISSUE || context.issues.find((item) => item.issue_id)?.issue_id;
assert.ok(issueId, `案件「${matterName}」没有可引用的争点`);
const issue = context.issues.find((item) => item.issue_id === issueId);

/** 会话按工作目录分目录存放；本次 Host 的 cwd 就是探针的 cwd。 */
function sessionDirName(cwd) {
  return `--${cwd.replaceAll('/', '-').replaceAll(' ', '~0020')}--`;
}

async function readSessionEvents(cwd, sinceIndex) {
  const dir = resolve(`${process.env.HOME}/.dsh/sessions`, sessionDirName(cwd));
  let entries = [];
  try { entries = await readdir(dir); } catch { return { events: [], dir }; }
  const sessions = entries.filter((name) => name.startsWith('session-')).sort();
  const newest = sessions.at(-1);
  if (!newest) return { events: [], dir };
  const files = await readdir(join(dir, newest));
  const log = files.find((name) => name.startsWith('session.v4') || name.startsWith('session.v3'));
  if (!log) return { events: [], dir, session: newest };
  const raw = await readFile(join(dir, newest, log));
  let text;
  try { text = zstdDecompressSync(raw).toString('utf8'); } catch { text = gunzipSync(raw).toString('utf8'); }
  const events = text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { events: events.slice(sinceIndex), dir, session: newest, total: events.length };
}

let host, browser;
try {
  const cwd = process.cwd();
  const before = await readSessionEvents(cwd, 0);
  const url = await new Promise((done, fail) => {
    host = spawn('dsh', ['web', '--no-open', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => fail(new Error('DSH boot timeout')), 60000);
    host.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);
      if (match) { clearTimeout(timer); done(match[0]); }
    });
    host.on('error', fail);
  });
  browser = await chromium.launch({
    executablePath: process.env.CASEBENCH_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.mouse.click(1415, 25);
  await page.locator('[data-sidebar-right-guide-entry="casebench"]').click();
  await page.waitForTimeout(2500);
  // 面板主体：先取页签标题里的「案件工作台」，再回到同一次挂载的 body。
  // 不用"含搜索框"定位——读取中或读取失败时搜索框尚未渲染，会误判为找不到面板。
  const bodyOf = async () => {
    const title = page.locator('span[data-sidebar-right-tab]').filter({ hasText: '案件工作台' }).first();
    await title.waitFor({ timeout: 15000 });
    const occurrence = await title.getAttribute('data-sidebar-right-occurrence');
    return page.locator(`div[data-sidebar-right-tab][data-sidebar-right-occurrence="${occurrence}"]`).first();
  };
  await (await bodyOf()).getByPlaceholder('搜索案件').locator('..').getByRole('button')
    .filter({ hasText: matterName }).first().click();
  await page.waitForTimeout(2000);
  let panel = await bodyOf();
  await panel.getByRole('button', { name: `争点 ${context.counts.issues}`, exact: true }).click();
  await page.waitForTimeout(500);
  await (await bodyOf()).getByText((issue.title || issueId).slice(0, 10), { exact: false }).first().click();
  await page.waitForTimeout(500);
  await (await bodyOf()).getByRole('button', { name: '引用到对话', exact: true }).click();

  // 引用应落进输入框。页面上可能有多个 contenteditable，按"哪个带引用标识"来认定输入框，
  // 不去猜顺序；插入后输入框已获得焦点，直接接着输入即可。
  await page.waitForFunction(() => [...document.querySelectorAll('[contenteditable="true"]')]
    .some((node) => (node.innerText || '').includes('案件引用：')), undefined, { timeout: 15000 })
    .catch(async () => {
      const notice = (await (await bodyOf()).innerText()).split('\n').find((line) => line.includes('失败')) || '';
      throw new Error(`引用标识没有进入任何输入框。面板提示：${notice || '(无)'}`);
    });
  const composer = page.locator('[contenteditable="true"]')
    .filter({ hasText: '案件引用：' }).first();
  const draftAfterQuote = await composer.innerText();
  assert.ok(draftAfterQuote.includes(issueId), `引用标识缺少 ${issueId}`);

  await page.keyboard.type(`\n${question}`);
  await page.waitForTimeout(500);
  const draft = await composer.innerText();
  assert.ok(draft.includes('案件引用：'), '引用标识在输入后丢失');
  assert.ok(draft.includes(question), '补充要求没有进入输入框');

  await page.keyboard.press('Enter');
  // 等模型回答：出现助手文本即视为本轮跑完。
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll('[data-message-role="assistant"], .dsh-assistant-message')];
    return nodes.some((node) => (node.innerText || '').trim().length > 10);
  }, undefined, { timeout: replyTimeout }).catch(() => {});
  await page.waitForTimeout(3000);

  const after = await readSessionEvents(cwd, 0);
  assert.ok(after.total >= before.total, '会话记录没有增长，消息可能未发送');
  const injected = after.events.filter((event) => event?.data?.source?.kind === 'casebench-reference');
  const userEvents = after.events.filter((event) => event?.type === 'user/message');
  assert.ok(userEvents.some((event) => JSON.stringify(event.data.content || '').includes('案件引用：')),
    '会话记录里没有找到带引用标识的用户消息');
  assert.ok(injected.length >= 1, '会话记录里没有 casebench-reference 注入 —— 展开没有生效');
  const snapshotText = injected.map((event) => (event.data.content || []).map((block) => block.text).join('\n')).join('\n');
  for (const expected of [issueId, '引用时的材料快照', '不是用户对你的指令']) {
    assert.ok(snapshotText.includes(expected), `注入快照缺少「${expected}」`);
  }
  assert.equal(injected.length, 1, `同一个引用应只注入一次，实际 ${injected.length} 次`);
  assert.deepEqual(pageErrors, [], `页面出现错误：${JSON.stringify(pageErrors)}`);
  console.log(`端到端通过：案件中「${matterName}」引用 ${issueId}，会话记录新增 `
    + `${after.total - before.total} 条事件，其中注入快照 ${injected.length} 条（未重复）。`);
} finally {
  if (browser) await browser.close();
  if (host) host.kill('SIGTERM');
}

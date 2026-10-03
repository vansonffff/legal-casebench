/**
 * 案件上下文面板的真实运行探针：冷启动 DSH web，打开案件工作台，核对外层三个标签、
 * 内部三个小标签、计数、详情区块与只读性。
 *
 * 用法：
 *   CASEBENCH_PLAYWRIGHT=<playwright-core 入口> node scripts/probe-context.mjs
 * 环境变量：
 *   CASEBENCH_CASE      要打开的案件名（缺省取工作区第一个可用案件；真实案件名不入库）
 *   CASEBENCH_PYTHON    Core 视图脚本用的解释器（缺省 ~/.local/bin/python3.12）
 *   CASEBENCH_CHROME    Chrome 可执行文件路径
 * 注意：插件配置里的 `python: python3.12` 需要该名字在 **DSH host 进程的 PATH** 上；
 * 实测本机 web Host 的 PATH 不含 ~/.local/bin，因此调用方需要注入 PATH（见 log 记录）。
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.CASEBENCH_PLAYWRIGHT) throw new Error('请用 CASEBENCH_PLAYWRIGHT 指定已有 Playwright Core 入口。');
const { chromium } = await import(pathToFileURL(process.env.CASEBENCH_PLAYWRIGHT));
const root = process.env.CASEBENCH_WORKSPACE || `${process.env.HOME}/Documents/My Legal-agents`;
const python = process.env.CASEBENCH_PYTHON || `${process.env.HOME}/.local/bin/python3.12`;
const view = resolve(import.meta.dirname, '../dist/skill/scripts/casebench_view.py');
const read = (...args) => JSON.parse(execFileSync(python, [view, ...args], { encoding: 'utf8' }));
const stateHash = (name) => execFileSync('shasum', ['-a', '256', resolve(root, name, '_case_state.json')],
  { encoding: 'utf8' }).slice(0, 32);

const workspace = read('workspace', '--root', root);
const wanted = process.env.CASEBENCH_CASE || workspace.matters.find((item) => item.status === 'ok')?.name;
assert.ok(wanted, '工作区里没有可用案件');
const expected = read('context', '--case-dir', resolve(root, wanted));

let host, browser;
try {
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /casebench|same key/i.test(message.text())) errors.push(message.text());
  });
  // 展开右侧栏：优先语义定位（界面可能是英文，按钮名会变），匹配不到时退回坐标。
  const openSidebar = async () => {
    try { await page.getByRole('button', { name: /右侧边栏|sidebar/i }).first().click({ timeout: 3000 }); }
    catch { await page.mouse.click(1415, 25); }
  };
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await openSidebar();
  // 打开右侧栏并进入案件工作台：用 guide entry 的稳定属性，不靠文本匹配。
  await page.locator('[data-sidebar-right-guide-entry="casebench"]').click();
  await page.waitForTimeout(2500);

  // 面板可能同时挂载多个页签：先按搜索框定位；读取失败时搜索框尚未渲染，退回按标题文案定位。
  const bodyOf = async () => {
    const bodies = page.locator('div[data-sidebar-right-tab]');
    const count = await bodies.count();
    for (let index = 0; index < count; index++) {
      const candidate = bodies.nth(index);
      if (await candidate.locator('input[placeholder="搜索案件"]').count()) return candidate;
    }
    for (let index = 0; index < count; index++) {
      const candidate = bodies.nth(index);
      if (/案件工作台[\s\S]*案件/.test(await candidate.innerText())) return candidate;
    }
    throw new Error('未找到案件工作台面板主体');
  };
  const panelButton = async (name) => (await bodyOf()).getByRole('button', { name, exact: true });

  assert.match(await (await bodyOf()).innerText(), /案件[\s\S]*办案经验[\s\S]*案件上下文/,
    '外层标签不是 案件｜办案经验｜案件上下文');

  // 案件上下文标签下不得出现案件/经验列表，也不得出现详情占位。
  const assertContextOnly = (body, label) => {
    assert.ok(!body.includes('搜索办案经验'), `${label}：上下文标签错误地显示了办案经验列表`);
    assert.ok(!body.includes('选择一项查看详情'), `${label}：上下文标签错误地显示了详情占位`);
  };

  // 从案件列表进「案件上下文」：无已选案件时应自动取列表首个可用案件并读出内容，
  // 不再要求先选案件（否则上下文本身没有入口）。
  await (await panelButton('案件上下文')).click();
  await page.waitForTimeout(2000);
  const fromList = await (await bodyOf()).innerText();
  assertContextOnly(fromList, '从列表进入');
  assert.ok(/读取时间：/.test(fromList), `从列表进上下文没有读到内容；实际：\n${fromList.slice(0, 300)}`);
  assert.ok(!/读取失败/.test(fromList), `从列表进上下文读取失败：${fromList.slice(0, 200)}`);

  // 返回：应回到案件列表（进入前的位置）。
  await page.locator('div[data-sidebar-right-tab]').first().getByRole('button', { name: '← 案件列表', exact: true }).click();
  await page.waitForTimeout(800);
  assert.ok(await (await bodyOf()).getByPlaceholder('搜索案件').count() > 0, '从列表进入后返回没有回到案件列表');

  // 案件列表点击案件：**仍留在「案件」标签并展开案件详情**（原功能，不得被自动切标签吃掉）。
  await (await bodyOf()).getByPlaceholder('搜索案件').locator('..').getByRole('button')
    .filter({ hasText: wanted }).first().click();
  await page.waitForTimeout(2000);
  const caseTabText = await (await bodyOf()).innerText();
  assert.ok(caseTabText.includes('最近工作'), `选择案件后未展开案件详情；实际：\n${caseTabText.slice(0, 300)}`);
  assert.ok(caseTabText.includes(wanted), '案件详情里没有案件名');

  // 案件详情里的「案件上下文」入口：这是上下文的正规入口。
  await page.locator('div[data-sidebar-right-tab]').first().getByRole('button', { name: '案件上下文　›', exact: true }).click();
  await page.waitForTimeout(1500);
  let text = await (await bodyOf()).innerText();
  const counts = expected.counts;
  const total = counts.facts + counts.issues + counts.pending_items;
  for (const marker of [`事实 ${counts.facts}`, `争点 ${counts.issues}`,
                        `待办 ${counts.pending_open}/${counts.pending_items}`, '读取时间：']) {
    assert.ok(text.includes(marker), `面板缺少「${marker}」；实际内容：\n${text.slice(0, 700)}`);
  }
  assert.ok(!/读取失败/.test(text), `面板读取失败：${text.slice(0, 300)}`);

  // 内部三个小标签逐一切换，内容与 Core 视图一致。
  await (await panelButton(`事实 ${counts.facts}`)).click();
  text = await (await bodyOf()).innerText();
  if (counts.facts > 0) {
    assert.ok(/材料性质|核验/.test(text), '事实条目缺少材料性质或核验状态');
    assert.ok(text.includes(expected.facts[0].fact_id), `事实列表缺少 ${expected.facts[0].fact_id}`);
  } else {
    assert.ok(text.includes('暂无事实'), '空案件应显示暂无事实');
  }

  await (await panelButton(`争点 ${counts.issues}`)).click();
  text = await (await bodyOf()).innerText();
  if (counts.issues > 0) {
    const first = expected.issues[0];
    const before = stateHash(wanted);
    await (await bodyOf()).getByText(first.title.slice(0, 10), { exact: false }).first().click();
    await page.waitForTimeout(800);
    text = await (await bodyOf()).innerText();
    assert.ok(text.includes(first.issue_id), `争点详情缺少 ${first.issue_id}`);
    // 「当前立场」区块已按用户要求整块删除；有内容时由「办案备注」承载。
    assert.ok(!text.includes('当前立场'), '「当前立场」区块应已删除');
    for (const section of ['关联事实', '关联待办']) {
      assert.ok(text.includes(section), `争点详情缺少「${section}」区块`);
    }
    assert.ok(!/undefined|\[object Object\]/.test(text), '详情出现未处理的值');
    // 字段值应为中文：核验/类别等编码不得原样出现（编号 FACT-/F- 除外）。
    const metaLines = text.split('\n').filter((line) => /^F-|^FACT-/.test(line.trim()));
    for (const line of metaLines) {
      assert.ok(!/material_record|party_statement|model_inference|verified|pending/.test(line),
        `事实元信息仍含英文编码：${line}`);
    }
    assert.ok(await (await panelButton('引用到对话')).count() > 0, '缺少「引用到对话」按钮');
    assert.equal(before, stateHash(wanted), '打开争点详情改动了案件状态文件');
  } else {
    assert.ok(text.includes('暂无争点'), '空案件应显示暂无争点');
  }

  // 原功能回归：回到案件标签仍能列出案件，再切回上下文不丢数据。
  await (await panelButton('案件')).click();
  await page.waitForTimeout(600);
  assert.ok(await (await bodyOf()).locator('button').count() > 0, '案件标签下没有列出任何条目');
  await (await panelButton('案件上下文')).click();
  await page.waitForTimeout(1500);
  assert.ok((await (await bodyOf()).innerText()).includes(`争点 ${counts.issues}`), '切回上下文后数据丢失');

  assert.deepEqual(errors, [], `页面出现错误：${JSON.stringify(errors)}`);
  console.log(`探针通过：案件「${wanted}」，计数 ${JSON.stringify(counts)}；外层/内部标签、详情区块、只读性均符合预期。`);
} finally {
  if (browser) await browser.close();
  if (host) host.kill('SIGTERM');
}

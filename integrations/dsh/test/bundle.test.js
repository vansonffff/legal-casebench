import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { INVOCATIONS } from '../src/remote/invocations.js';
import { TYPERT } from '../typert.host.js';
import { TYPERT_REMOTE } from '../typert.remote-client.js';

/** 在 vm 里加载 client bundle 的工厂，取出它的导出面（与运行时同一份文件）。 */
async function loadClient() {
  let client;
  const script = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  vm.runInNewContext(script, {
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, 'dsh-legal-casebench');
      client = factory((name) => {
        if (name === 'react') return { Component: class {} };
        if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
        throw new Error(`unexpected require: ${name}`);
      });
    } } },
  });
  return client;
}

test('Host、Client Remote 方法逐项一致', async () => {
  assert.deepEqual(TYPERT.invocations.map((x) => x.method), INVOCATIONS.map((x) => x.method));
  assert.deepEqual(TYPERT_REMOTE.descriptors.map((x) => x.method), INVOCATIONS.map((x) => x.method));
  const client = await loadClient();
  assert.deepEqual(Array.from(client.INVOCATIONS, (x) => x.method), INVOCATIONS.map((x) => x.method));
  assert.deepEqual(Array.from(client.inject), ['remote', 'slots', 'sidebarRightTabs']);
  const { rowKey, stageLabel, fileAddress, roleLabel, statusLabel, kindLabel,
    authorityLabel, verificationLabel, versionLabel, dateLabel, errorLabel } = client.uiHelpers;
  assert.notEqual(rowKey('practice', { id: 'PN-000001', matter_id: 'same' }), rowKey('practice', { id: 'PN-000002', matter_id: 'same' }));
  assert.notEqual(rowKey('cases', { matter_id: 'same' }), rowKey('practice', { id: 'same' }));
  assert.equal(stageLabel('unknown'), '阶段待确认');
  assert.equal(stageLabel(''), '阶段待确认');
  assert.equal(stageLabel('first-instance'), '一审');
  assert.equal(stageLabel('second-instance'), '二审');
  assert.equal(stageLabel('retrial-review'), '再审审查');
  assert.equal(roleLabel('debtor'), '债务人');
  assert.equal(roleLabel('respondent-to-application'), '被申请人');
  assert.equal(roleLabel('restructuring-advisor', 'non-litigation'), '重组顾问');
  assert.equal(statusLabel('appeal-filed'), '已提起上诉');
  assert.equal(kindLabel('analysis'), '分析成果');
  assert.equal(kindLabel('final'), '定稿成果');
  assert.equal(authorityLabel('statute'), '法律规范');
  assert.equal(verificationLabel('partially_verified'), '部分核验');
  assert.equal(versionLabel('4.0.0-beta.1'), '4.0.0 测试版 1');
  assert.equal(dateLabel('2026-09-26T12:00:00Z'), '2026-09-26 12:00:00 +00:00');
  assert.equal(errorLabel(new Error('Network error')), '读取失败，请重新读取；如仍失败，请检查工作区配置。');
  assert.equal(errorLabel(new Error('成果文件路径越过案件目录。')), '成果文件路径越过案件目录。');
  for (const fn of [stageLabel, roleLabel, statusLabel, kindLabel, authorityLabel, verificationLabel]) {
    assert.ok(!/[A-Za-z]/.test(fn('new-unknown-code')));
    assert.equal(fn('中文自定义值'), '中文自定义值');
  }
  assert.equal(fileAddress('session-1', '/案件/意见 #1.md'), 'dsh-resource://file/session/session-1//%E6%A1%88%E4%BB%B6/%E6%84%8F%E8%A7%81%20%231.md');
  assert.throws(() => fileAddress('', '/file.md'), /选择一个会话/);
});

test('案件上下文：引用标识短且自足，标签顺序与退化显示固定', async () => {
  const client = await loadClient();
  const { outerTabs, subTabs, quoteText, factVerificationLabel } = client.uiHelpers;
  // 外层标签顺序是既定界面约定：案件｜办案经验｜案件上下文。
  // vm 里构造的数组原型与宿主不同，比较前先归一为宿主数组。
  const outer = Array.from(outerTabs, (entry) => Array.from(entry));
  const inner = Array.from(subTabs, (entry) => Array.from(entry));
  assert.deepEqual(outer.map(([id]) => id), ['cases', 'practice', 'context']);
  assert.deepEqual(outer.map(([, title]) => title), ['案件', '办案经验', '案件上下文']);
  assert.deepEqual(inner.map(([, title]) => title), ['事实', '争点', '待办']);

  const context = { matter: { id: 'matter-1', name: '示例案件', path: '/virtual/别名目录' }, state_hash: 'a'.repeat(64) };
  const issue = { issue_id: 'ISS-0001', title: '某争点' };
  const text = quoteText(context, issue);
  // 标识必须短（完整快照由 Host 展开，不进草稿）、可识别、含三要素。
  assert.ok(text.length < 1500, `引用标识过长：${text.length}`);
  assert.ok(text.startsWith('【案件引用：') && text.endsWith('】'));
  assert.ok(text.includes('示例案件') && text.includes('ISS-0001') && text.includes('某争点'));
  assert.ok(!/[\r\n]/.test(text), '引用标识不得含换行，否则会切断用户草稿');
  // 标题缺失时退到 issue_id，不出现 undefined。
  const bare = quoteText(context, { issue_id: 'ISS-0002' });
  assert.ok(!/undefined/.test(bare) && bare.includes('ISS-0002'));

  // 核验状态两种形态与缺失都要有可读中文，不外泄英文枚举。
  assert.equal(factVerificationLabel(null), '核验状态待确认');
  assert.equal(factVerificationLabel({ form: 'record', status: 'verified' }), '核验：已核验');
  assert.equal(factVerificationLabel({ form: 'legacy_string', status: 'verified' }), '核验：已核验（旧格式）');
  assert.equal(factVerificationLabel({ form: 'record', status: 'pending' }), '核验：待核验');
});

test('事实与待办的字段值全部显示中文，编号除外', async () => {
  const client = await loadClient();
  const { factKindLabel, materialGradeLabel, pendingStatusLabel, factVerificationLabel } = client.uiHelpers;

  // 事实类别：真实数据里的 4 种取值 + 组合编码都要有中文。
  assert.equal(factKindLabel('material_record'), '材料记载');
  assert.equal(factKindLabel('party_statement'), '当事人陈述');
  assert.equal(factKindLabel('model_inference'), '模型推断');
  assert.equal(factKindLabel('legacy_unclassified'), '未分类旧条目');
  assert.equal(factKindLabel('some-new-kind'), '类别待确认');
  assert.equal(factKindLabel(undefined), '类别待确认');

  // 材料性质是 A/B/C 分级，不是编号；缺失时如实说"未登记"。
  assert.equal(materialGradeLabel('A'), 'A 级');
  assert.equal(materialGradeLabel('C'), 'C 级');
  assert.equal(materialGradeLabel(null), '未登记');

  // 待办状态：真实数据混用中英文，英文必须译，中文自由值原样保留。
  assert.equal(pendingStatusLabel('open'), '待处理');
  assert.equal(pendingStatusLabel('pending'), '待处理');
  assert.equal(pendingStatusLabel('done'), '已完成');
  assert.equal(pendingStatusLabel('进行中'), '进行中');
  assert.equal(pendingStatusLabel('待核'), '待核');
  assert.equal(pendingStatusLabel('brand-new-code'), '状态待确认');

  // 核验状态：真实数据里有 14 种取值，含一长串组合编码。
  // 已知枚举走词表；组合编码给出中文可读形式并保留原编码；任何取值都不得原样输出英文。
  for (const status of ['verified', 'unverified', 'partially_verified', 'pending',
                        'verified_as_party_statement', 'verified_as_judgment_record',
                        'verified_as_current_judgment_record', 'verified_with_limited_proposition',
                        'verified_with_unresolved_source_and_destination', 'legacy_unverified',
                        'model_inference', 'conditional_inference',
                        'verified_as_judgment_record; original_not_seen_in_current_read',
                        'something_never_seen_before']) {
    const text = factVerificationLabel({ form: 'record', status });
    assert.ok(text.startsWith('核验：'), `核验状态格式不对：${text}`);
    assert.ok(!/[a-z]/.test(text.replace(/编码：[^）]*/g, '')),
      `核验状态原样输出了英文枚举「${status}」：${text}`);
  }
  assert.equal(factVerificationLabel({ form: 'record', status: 'verified_as_party_statement' }),
    '核验：已核验（属当事人陈述）');
  assert.ok(factVerificationLabel({ form: 'record', status: 'verified_with_limited_proposition' })
    .includes('证明范围有限'));
  // 未知编码仍要可读：给出中文 + 原编码，不假装核验通过、也不隐藏底层值。
  const unknown = factVerificationLabel({ form: 'record', status: 'something_never_seen_before' });
  assert.ok(unknown.includes('状态待确认') && unknown.includes('something_never_seen_before'), unknown);
});

test('争点状态与确信度：已知英文枚举译中文，中文自由值原样保留', async () => {
  const client = await loadClient();
  const { issueStatusLabel, confidenceLabel } = client.uiHelpers;
  // 真实数据里既有英文枚举（open/active），也有中文自由值（异议待处理）：后者不得被归一或丢弃。
  assert.equal(issueStatusLabel('open'), '待处理');
  assert.equal(issueStatusLabel('active'), '进行中');
  assert.equal(issueStatusLabel('closed'), '已结束');
  assert.equal(issueStatusLabel('异议待处理'), '异议待处理');
  assert.equal(issueStatusLabel('进行中'), '进行中');
  assert.equal(issueStatusLabel('some-new-code'), '状态待确认');
  assert.equal(issueStatusLabel(undefined), '状态待确认');
  assert.ok(!/[A-Za-z]/.test(issueStatusLabel('some-new-code')));

  assert.equal(confidenceLabel('high'), '高');
  assert.equal(confidenceLabel('medium'), '中');
  assert.equal(confidenceLabel('low'), '低');
  // unknown 表示"尚未评估"，不能显示成"低"或被当成有效档位。
  assert.equal(confidenceLabel('unknown'), '未登记');
  assert.equal(confidenceLabel(undefined), '未登记');
  assert.equal(confidenceLabel('something-else'), '未登记');
});

test('Bundle 的 Skill 来自 common 组装且含新的只读视图', async () => {
  const base = resolve(import.meta.dirname, '../dist/skill');
  const common = resolve(import.meta.dirname, '../../../skills/legal-case-bench/common');
  for (const relative of ['SKILL.md', 'scripts/casebench_view.py', 'scripts/practice.py', 'references/practice-library.md']) {
    assert.equal(await readFile(resolve(base, relative), 'utf8'), await readFile(resolve(common, relative), 'utf8'));
  }
});

test('选择案件不自动切标签：案件详情必须留在「案件」标签', async () => {
  const client = await loadClient();
  const { matterSelectionTab, outerTabs } = client.uiHelpers;
  // 案件列表点击原本展开的是案件详情（关联案件、最近工作、已定稿/法条/案例入口）。
  // 为「默认进上下文」而自动切标签会吃掉这条路径——已在真实浏览器上踩过一次，这里钉住。
  assert.equal(matterSelectionTab(), 'cases');
  assert.equal(Array.from(outerTabs, (e) => Array.from(e)).find(([id]) => id === 'cases')[1], '案件');
  // 客户端源码里也不得在选案路径上出现 setTab('context')。
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const chooseMatterBody = source.slice(source.indexOf('async function chooseMatter'),
    source.indexOf('async function chooseMatter') + 700);
  assert.ok(!/setTab\('context'\)/.test(chooseMatterBody),
    '选案路径不得自动切到案件上下文标签');
});

test('案件详情必须有「案件上下文」入口，且排在其它去向之前', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  // 案件上下文只能从案件那侧进入：案件列表 → 案件详情 → 案件上下文。
  // 少了这个入口就会出现"进了上下文回不来、上下文也没入口"的死角（已踩过）。
  assert.ok(/onContext && jsx\(NavRow, \{ strong: true, onClick: onContext/.test(source),
    '案件详情缺少案件上下文入口，或入口未加粗');
  // 入口必须排在本案其它去向之前，并与它们同组、同样式，只是加粗。
  // 只断言顺序与样式：具体渲染位置由浏览器探针核对。
  const entryAt = source.indexOf('jsx(NavRow, { strong: true, onClick: onContext');
  const finalAt = source.indexOf('已定稿 · ${');
  assert.ok(entryAt > 0 && finalAt > entryAt, '案件上下文入口必须排在已定稿之前');
  // 三条原有去向紧随「已定稿」之后（法条/案例名也出现在子页标题里，这里只认行条目）。
  for (const row of ['本案法条', '参考案例']) {
    assert.ok(source.indexOf(`${row} · `) > finalAt, `「${row}」行应排在已定稿之后`);
  }
  // 同层级标题字号统一（H3 字级），只靠字重区分重要性；计数格式统一为「名称 · 数量」。
  assert.ok(/function NavRow\(/.test(source) && /fontSize: H3_FONT/.test(source),
    '去向行应与折叠段标题同字级（H3）');
  assert.ok(/title: `最近工作 · \$\{recent\.length\}`/.test(source), '最近工作应带计数');
  assert.ok(!/已定稿　|本案法条　|参考案例　/.test(source), '计数分隔统一用「·」，不再用全角空格');
  assert.ok(source.includes('const backFromContext'), '缺少上下文返回的实现');
  assert.ok(/onBack: backFromContext/.test(source), 'ContextDetail 未接上返回案件列表');
});

test('案件上下文必须同时给出「回案件列表」和「看案件详情」两个真实出口', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const contextDetail = source.slice(source.indexOf('function ContextDetail'),
    source.indexOf('function CaseBenchBody'));
  // 两个出口的文案与目标必须一一对应：入口一回列表，入口二打开案件详情。
  assert.ok(contextDetail.includes("onClick: onBack, children: '← 案件列表'"),
    '上下文缺少「← 案件列表」出口');
  assert.ok(/onOpenMatter && jsx\('button'.*children: '案件详情 ›'/.test(contextDetail),
    '上下文缺少「案件详情 ›」出口');
  assert.ok(/onOpenMatter: matter \? openContextMatter : null/.test(source),
    '「案件详情 ›」未接到打开详情的实现');
  // 打开详情就是把该案件读成 detail，由既有 MatterDetail 分支渲染；详情里的「← 返回」清空 detail 即回到上下文。
  const openBody = source.slice(source.indexOf('async function openContextMatter'),
    source.indexOf('async function chooseMatter'));
  assert.ok(/await openMatter\(\{ path \}\)/.test(openBody), 'openContextMatter 未读取案件详情');
  assert.ok(/context\?\.matter\?\.path \|\| matter\?\.path/.test(openBody), 'openContextMatter 应取上下文或面板案件的目录');
  // 回归钉子：不得再用 "有没有详情可回" 决定文案或第二个入口是否存在。
  // 进入上下文时 detail 必为 null（choose 与 goContext 都清），那样两个入口会退化成一个，
  // 实测结果就是只剩「← 案件列表」，案件详情再也回不去。
  // 只查代码形态（注释里保留旧写法名以便追溯）：
  assert.ok(!/const hasMatterDetail|hasMatterDetail \?/.test(source),
    '返回文案/第二个入口不得再依赖 hasMatterDetail（会退化成只有一个出口）');
  // 切标签清空 detail 是既有行为，不要为了这个需求整体改掉；goContext 仍须清 detail。
  const goBody = source.slice(source.indexOf('async function goContext'), source.indexOf('async function openContextMatter'));
  assert.ok(/setDetail\(null\)/.test(goBody), 'goContext 仍须清掉上一个标签的 detail');
});

test('返回键统一走 QUIET；全面板禁止负 margin（冻结规范）', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  // 冻结规范 §四：返回/刷新类是 QUIET（无边框、三级文字色、水平 padding 0），
  // 左对齐靠"水平 padding 0 落在容器基准线上"，不靠负 margin——
  // sticky 吸附按 margin 边判定，负边距会让吸顶页头提前停住、头顶漏出透明窗（实测坑）。
  assert.ok(!/marginLeft:\s*-|marginTop:\s*-/.test(source), '不得使用负边距做对齐');
  assert.ok(!/backInset|backButton/.test(source), '旧的负边距返回键样式应已移除');
  // 页面级返回键（PageHead 模板、争点详情、上下文导航）必须全部走 QUIET。
  const backLabels = [...source.matchAll(/children: [`'](← [^`']+)[`']/g)];
  assert.ok(backLabels.length >= 3, `返回键数量异常：${backLabels.length}`);
  for (const match of backLabels) {
    const line = source.slice(source.lastIndexOf('\n', match.index), match.index);
    assert.ok(/QUIET/.test(line), `返回键「${match[1]}」必须使用 QUIET 样式：${line.trim()}`);
  }
});

test('上下文里的只读行不可交互，切小标签不残留上一条争点详情', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const contextDetail = source.slice(source.indexOf('function ContextDetail'),
    source.indexOf('function CaseBenchBody'));
  // 事实行只是浏览：不得渲染成"点了没反应"的按钮（实测改前 tag=BUTTON、cursor=pointer、点击无变化）。
  // 争点行走 HoverRow（可点）；待办行走 PendingRow（行不可点，只有复选框是控件）。
  assert.ok(/row\.issue\s*\?\s*jsx\(HoverRow/.test(contextDetail), '只有争点行才是可点行');
  assert.ok(/cursor: 'default'/.test(contextDetail), '只读行不得带 pointer 光标');
  assert.ok(!/onClick: \(\) => item\.issue \? setSelected\(item\.issue\) : undefined/.test(source),
    '不得再渲染无动作的空按钮');
  // 切小标签必须清掉已选争点：否则窄栏下标签已切到「事实」，正文还是争点详情（已在真实浏览器复现）。
  // 筛选状态同时重置，否则切到「事实」还带着「待办」的筛选。
  assert.ok(/onClick: \(\) => \{ setSelectedId\(null\); setFactFilter\(\{ verification: 'all', kind: 'all' \}\); setPendingFilter\('all'\); onSub\(id\); \}/.test(contextDetail),
    '切小标签时应清空已选争点并重置筛选');
  // 「重新读取」面板内只有标题行右上角一个（用户 2026-10-03 要求；设置页另有其一，不在此列）：
  // 它在上下文页同样重读上下文（refresh('context')），子页内不得再有第二个。
  const body = source.slice(source.indexOf('function CaseBenchBody'), source.indexOf('function SettingsSection'));
  assert.equal([...body.matchAll(/children: '重新读取'/g)].length, 1,
    '「重新读取」只能有一个（标题行右上角）');
  assert.ok(/onClick: \(\) => refresh\(tab === 'context' \? 'context' : listTab\)/.test(body),
    '标题行的「重新读取」在上下文页应重读上下文');
  assert.ok(!/onRefresh/.test(contextDetail), 'ContextDetail 不得再自带「重新读取」');
});

test('搜索框与筛选下拉同一套控件规格，空关联依据有文案', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  // 冻结规范 §四：INPUT 通栏宽、0.5px 边框、8px 圆角、5px 10px 内边距；
  // 筛选下拉（SELECT）同规格、宽度随内容。
  assert.ok(/const INPUT = \{[\s\S]*?border: `0\.5px solid \$\{BORDER\}`,[\s\S]*?borderRadius: '8px', padding: '5px 10px'/.test(source),
    'INPUT 应为 0.5px 边框、8px 圆角、5px 10px 内边距');
  assert.ok(/const SELECT = \{ \.\.\.INPUT, width: 'auto' \}/.test(source), '筛选下拉应复用 INPUT 规格');
  assert.ok(/!\(data\.authorities \|\| \[\]\)\.length && empty\('暂无关联依据'\)/.test(source),
    '关联依据为空时要有空态文案，而不是只剩一个空标题');
});

test('吸顶页头：吸附线贴滚动容器顶边，实测底色 + box-shadow 上延，禁止负 margin', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  // 实测：滚动容器带上内边距时，sticky 页头停在距顶 12px 处，顶上那条会漏出滚动内容。
  // 上边距必须由第一个内容块提供，容器自己只能留下边距。
  assert.ok(/padding: '0 6px 12px', height: '100%', boxSizing: 'border-box', overflowY: 'auto'/.test(source),
    '滚动容器不得带顶部内边距，否则吸顶页头吸附线不贴顶边');
  assert.ok(/style: \{ paddingTop: 12, paddingBottom: 12 \}/.test(source),
    '顶部留白由首块提供；底部需有不可折叠的 12px 内边距，隔开吸顶页头的 10px 上延遮罩与按钮');
  // 吸顶页头只有一份定义（HEAD_STICKY），各子页页头与上下文头块共用；
  // 段标题不再各自 sticky——两个 sticky 叠同一个 top 会互相遮挡。
  assert.equal(source.match(/position: 'sticky'/g).length, 1, 'sticky 只能定义在 HEAD_STICKY 一处');
  assert.ok(/const HEAD_STICKY = \{ position: 'sticky', top: 0, zIndex: 2, background: PANE_BG/.test(source),
    '吸顶页头应用实测面板底色');
  assert.ok(/boxShadow: `0 -10px 0 0 \$\{PANE_BG\}`/.test(source),
    '吸顶页头应用同色 box-shadow 向上延伸遮滚动穿透');
  // 底色来自挂载时的 DOM 实测（--cb-pane-bg），不是拍脑袋的变量。
  assert.ok(/setProperty\('--cb-pane-bg', bg\)/.test(source), '应从 DOM 实测面板底色写进 --cb-pane-bg');
});

test('待办：已完成的加粗、未完成的常规；复选框写回与筛选同口径', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

  // 已了结的判定必须只有一处口径：它同时驱动"加粗""未完成计数""复选框勾选态""筛选"，
  // 两处不一致就会出现「显示已完成却仍计未完成」这类矛盾。
  assert.ok(/const SETTLED_PENDING = new Set\(/.test(source), '缺少已了结状态集合');
  assert.ok(/const isSettledPending = /.test(source), '缺少已了结判断函数');
  assert.ok(/fontWeight: isSettledPending\(item\.status\) \? 600 : 400/.test(source), '已完成的加粗、未完成的常规');
  assert.ok(/const unfinished = allPending\.filter\(\(item\) => !isSettledPending\(item\.status\)\)\.length/
    .test(source), '未完成数应按同一口径本地重算，不得直接用 Core 的 counts.pending_open');
  assert.ok(/const done = isSettledPending\(item\.status\)/.test(source), '复选框勾选态应复用同一口径');

  // 待办状态写回：行首复选框 → setPendingStatus(completed/open) → 重读上下文。
  assert.ok(/type: 'checkbox'/.test(source), '待办行应带复选框');
  assert.ok(/remote\.setPendingStatus\(\{[\s\S]*?status: done \? 'completed' : 'open'/.test(source),
    '复选框应写回规范状态值 completed/open');
  assert.ok(/busy === item\.item_id/.test(source), '写入中的待办应禁用复选框');

  // 小标签行（事实｜争点｜待办）在吸顶头块内：往下滑条目时"当前在看哪一类"始终可见。
  const contextDetail = source.slice(source.indexOf('function ContextDetail'),
    source.indexOf('function CaseBenchBody'));
  assert.ok(/const head = jsxs\('div', \{ style: HEAD_STICKY/.test(contextDetail),
    '上下文的页头块应吸顶');
  assert.ok(contextDetail.indexOf('...subTabs.map') > contextDetail.indexOf('const head'),
    '小标签行应在吸顶头块内');
  assert.ok(/const subTabs = \[/.test(source), '缺少小标签定义');
});

test('事实与待办筛选：分组口径与筛选行', async () => {
  const client = await loadClient();
  const { factVerificationGroup, factMatchesFilter, pendingMatchesFilter, isSettledPending,
    FACT_VERIFICATION_GROUPS, PENDING_FILTERS } = client.uiHelpers;

  // 核验状态分组：组合编码按前缀归档，空值/未知归入「待确认」，不逐码硬译。
  assert.equal(factVerificationGroup('verified'), 'verified');
  assert.equal(factVerificationGroup('verified_as_party_statement'), 'verified');
  assert.equal(factVerificationGroup('verified_with_unresolved_source_and_destination'), 'verified');
  assert.equal(factVerificationGroup('verified_as_judgment_record; original_not_seen_in_current_read'), 'verified');
  assert.equal(factVerificationGroup('partially_verified'), 'partial');
  assert.equal(factVerificationGroup('unverified'), 'unverified');
  assert.equal(factVerificationGroup('pending'), 'unverified');
  assert.equal(factVerificationGroup('legacy_unverified'), 'unverified');
  assert.equal(factVerificationGroup('model_inference'), 'unverified');
  assert.equal(factVerificationGroup(''), 'unknown');
  assert.equal(factVerificationGroup(undefined), 'unknown');
  assert.equal(factVerificationGroup('something_never_seen'), 'unknown');
  assert.deepEqual(Array.from(FACT_VERIFICATION_GROUPS, (entry) => Array.from(entry)[0]),
    ['all', 'verified', 'partial', 'unverified', 'unknown']);

  // 事实筛选：两维度组合；kind 缺失归 'unknown' 档。
  const fact = { kind: 'material_record', verification: { status: 'verified_as_party_statement' } };
  assert.ok(factMatchesFilter(fact, { verification: 'all', kind: 'all' }));
  assert.ok(factMatchesFilter(fact, { verification: 'verified', kind: 'material_record' }));
  assert.ok(!factMatchesFilter(fact, { verification: 'partial', kind: 'all' }));
  assert.ok(!factMatchesFilter(fact, { verification: 'all', kind: 'party_statement' }));
  assert.ok(factMatchesFilter({ kind: null, verification: null }, { verification: 'unknown', kind: 'unknown' }));

  // 待办筛选：与 isSettledPending 同口径（中英混用）。
  assert.deepEqual(Array.from(PENDING_FILTERS, (entry) => Array.from(entry)[0]), ['all', 'open', 'done']);
  assert.ok(pendingMatchesFilter({ status: '已完成' }, 'done'));
  assert.ok(pendingMatchesFilter({ status: 'completed' }, 'done'));
  assert.ok(pendingMatchesFilter({ status: '待处理' }, 'open'));
  assert.ok(pendingMatchesFilter({ status: '进行中' }, 'open'));
  assert.ok(!pendingMatchesFilter({ status: '已完成' }, 'open'));
  assert.ok(pendingMatchesFilter({ status: 'blocked' }, 'all'));
  assert.equal(pendingMatchesFilter({ status: 'done' }, 'done'), isSettledPending('done'));

  // 筛选行须在吸顶头块内（下滑时筛选条件始终可见），事实两个下拉、待办一个。
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const contextDetail = source.slice(source.indexOf('function ContextDetail'),
    source.indexOf('function CaseBenchBody'));
  const headEnd = contextDetail.indexOf('const list');
  for (const label of ['按核验状态筛选', '按事实类别筛选', '按状态筛选']) {
    const at = contextDetail.indexOf(label);
    assert.ok(at > 0 && at < headEnd, `筛选「${label}」应在吸顶头块内`);
  }
});

test('最近工作与子页成果：整行单击打开，不再渲染独立「打开」按钮', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  // 独立「打开」按钮独占一行、太占空间且与文字不对齐（用户截图指出）；
  // 有 path 的条目整行可点（ArtifactRow → HoverRow），无 path 保持只读行。
  assert.ok(!/children: '打开'/.test(source), '不得再有独立的「打开」按钮');
  assert.ok(/function ArtifactRow\(/.test(source), '成果条目应统一走 ArtifactRow');
  assert.ok(/if \(!path\) return jsx\('div'/.test(source), '无 path 的条目应保持只读行');
  assert.ok(/jsx\(HoverRow, \{ onClick: \(\) => onOpen\(path\)/.test(source), '有 path 的条目应整行可点');
});

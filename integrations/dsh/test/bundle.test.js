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
  assert.ok(/jsx\(NavRow, \{ strong: true, onClick: onContext, children: '案件上下文' \}\)/.test(source),
    '案件详情缺少案件上下文入口，或入口未加粗');
  // 入口必须排在本案其它去向之前。
  const entryAt = source.indexOf("jsx(NavRow, { strong: true, onClick: onContext");
  const finalAt = source.indexOf('已定稿 · ${');
  assert.ok(entryAt > 0 && finalAt > entryAt, '案件上下文入口必须排在已定稿之前');
  // 用户 2026-10-03 要求：案件上下文单独成块（不套灰卡），不与下面三条子页去向同组。
  const entrySection = source.slice(entryAt, finalAt);
  assert.ok(!/本案法条|参考案例/.test(entrySection), '案件上下文必须独立成块，不与三条子页去向同组');
  const bottomGroup = source.slice(source.lastIndexOf("jsxs('section'", finalAt), source.indexOf('data.warnings', finalAt));
  assert.ok(/className: 'cb-flat cb-navigation'/.test(bottomGroup),
    '已定稿/法条/案例应合为一组（组内用分隔线，不套灰卡）');
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
    source.indexOf('function WorkspaceShell'));

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

test('返回键统一走 QUIET；负边距只允许 Surface Bleed，不得纵向使用', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  // 设计体系 2.0 §12.4 / §15：返回/刷新类是 QUIET（无边框、二级文字色、水平 padding 0），
  // 左对齐靠"水平 padding 0 落在容器基准线上"，不靠负 margin。
  assert.ok(!/marginLeft:\s*-|marginTop:\s*-/.test(source), '不得使用纵向负边距做对齐');
  assert.ok(!/backInset|backButton/.test(source), '旧的负边距返回键样式应已移除');
  // §4.4 Surface Bleed：负边距只允许以 margin-inline 形式出现在裸行上（背景外扩、文字不动），
  // 且只此一处；吸顶页头不得使用任何负边距（吸附按 margin 边判定，会提前停住）。
  assert.equal([...source.matchAll(/margin-inline:-8px/g)].length, 2, '裸行外扩与滚动区预留空间各一处');
  assert.ok(/overflow-x:hidden; margin-inline:-8px; padding:0 8px 24px/.test(source), '滚动区须留出横向圆角空间且不移动正文轨');
  assert.ok(/\.cb-panel \.cb-object-row \{ margin-block:4px; margin-inline:-8px; padding-inline:8px/.test(source),
    '裸行应以 Surface Bleed 外扩背景、文字留在内容轨');
  assert.ok(/\.cb-panel \.cb-content \.cb-object-row \{ margin-inline:calc\(var\(--surface-padding-x\) \* -1\);\s*padding-inline:var\(--surface-padding-x\); border-radius:0;\s*width:calc\(100% \+ 2 \* var\(--surface-padding-x\)\); \}/.test(source),
    '卡内行的底色应铺满整张卡（宽度要配平两侧的负外边距），文字仍留在卡内容轨');
  assert.ok(/\.cb-panel \.cb-content \{ overflow:hidden; \}/.test(source),
    '卡片必须裁掉铺满背景的直角，避免露出卡的圆角外');
  assert.ok(/\.cb-panel \.cb-content \.cb-object-row:focus-visible \{ outline-offset:-3px; \}/.test(source),
    '卡内行的焦点圈要画在卡内，否则被 overflow:hidden 裁掉');
  const sticky = source.slice(source.indexOf('const HEAD_STICKY'), source.indexOf('const PANEL_STYLE'));
  assert.ok(!/margin-\w*:?\s*-|marginInline: '-/.test(sticky), '吸顶头块不得使用负 margin');
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
    source.indexOf('function WorkspaceShell'));

  // 事实行只是浏览：不得渲染成"点了没反应"的按钮（实测改前 tag=BUTTON、cursor=pointer、点击无变化）。
  // 争点行走 HoverRow（可点）；待办行走 PendingRow（行不可点，只有复选框是控件）。
  assert.ok(/row\.issue\s*\?\s*jsx\(HoverRow/.test(contextDetail), '只有争点行才是可点行');
  assert.ok(/jsx\('div', \{ className: 'cb-reading-item'/.test(contextDetail), '事实用只读 div，不能渲染为按钮');
  assert.ok(!/onClick: \(\) => item\.issue \? setSelected\(item\.issue\) : undefined/.test(source),
    '不得再渲染无动作的空按钮');
  // 切小标签必须清掉已选争点：否则窄栏下标签已切到「事实」，正文还是争点详情（已在真实浏览器复现）。
  // 筛选状态同时重置，否则切到「事实」还带着「待办」的筛选。
  assert.ok(/onClick: \(\) => \{ setSelectedId\(null\); setFactFilter\(\{ verification: 'all', kind: 'all' \}\); setPendingFilter\('all'\); setIssueQuery\(''\); onSub\(id\); \}/.test(contextDetail),
    '切小标签时应清空已选争点并重置筛选');
  // 「重新读取」面板内只有标题行右上角一个（用户 2026-10-03 要求；设置页另有其一，不在此列）：
  // 它在上下文页同样重读上下文（refresh('context')），子页内不得再有第二个。
  const body = source.slice(source.indexOf('function CaseBenchBody'), source.indexOf('function SettingsSection'));
  const shell = source.slice(source.indexOf('function WorkspaceShell'), source.indexOf('function CaseBenchBody'));

  assert.equal([...shell.matchAll(/children: '重新读取'/g)].length, 1,
    '「重新读取」只能有一个（标题行右上角）');
  assert.ok(/onRefresh: \(\) => refresh\(tab === 'context' \? 'context' : listTab\)/.test(body),
    '标题行的「重新读取」在上下文页应重读上下文');
  assert.ok(!/onRefresh/.test(contextDetail), 'ContextDetail 不得再自带「重新读取」');
});

test('2.0 Native Metrics：字号层级、控件高度与行高按 kind 生效', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  // §3.1 / §5.1：页面标题 20/28/500、正文 14/22、元信息 12/18，字重只用 400/500。
  assert.ok(/const H1_FONT = '20px';/.test(source) && /const H2_FONT = '20px';/.test(source));
  assert.ok(/const H3_FONT = '14px';/.test(source) && /const NOTE_FONT = '12px';/.test(source));
  assert.ok(/const LH_TITLE = '28px';/.test(source) && /const LH_BODY = '20px';/.test(source));
  assert.ok(/const H3 = \{ fontSize: H3_FONT, lineHeight: '22px', fontWeight: 500/.test(source));
  // §31.2 Release Gate：面板内不得出现 600/700，也不得用 bold。
  assert.ok(!/fontWeight: 600|fontWeight: 700|font-weight:600|font-weight:700|font-weight:bold/.test(source),
    '字重只用 400/500');
  // §3.3 / §12：标准控件 36px，主操作 40px。
  assert.ok(/const CONTROL_HEIGHT = 36;/.test(source) && /const PRIMARY_HEIGHT = 40;/.test(source));
  assert.ok(/const INPUT = \{[\s\S]*?minHeight: CONTROL_HEIGHT, height: CONTROL_HEIGHT,[\s\S]*?border: `1px solid \$\{BORDER\}`,[\s\S]*?borderRadius: '12px', padding: '6px 12px'/.test(source));
  assert.ok(/const SELECT = \{ \.\.\.INPUT/.test(source));
  assert.ok(/className: 'cb-primary', style: \{ \.\.\.BUTTON, minHeight: PRIMARY_HEIGHT \}/.test(source),
    '主操作应为 40px');
  // §6.4：对象行 48、案件行 56、导航行 40 由行组件内联下发（CSS 的 min-height 压不过内联样式）。
  assert.ok(/const ROW_MIN = \{ nav: 30, case: 48, default: 48 \};/.test(source));
  assert.ok(/minHeight: ROW_MIN\[kind\] \|\| ROW_MIN\.default/.test(source));
  assert.ok(!/\.cb-nav-row \{ min-height:40px/.test(source), '行高必须内联生效，不能只写在 CSS 里');
  assert.ok(!/\[data-kind="case"\] \{ min-height:64px/.test(source), '行高必须内联生效，不能只写在 CSS 里');
  // §18 / §19：阅读正文 14/24，折叠段标题 14/22，标签 14/22，元信息 12/18，面包屑 13/20。
  assert.ok(/\.cb-reading-text \{ max-width:720px; margin-left:0; margin-right:auto; font-size:14px; line-height:22px/.test(source));
  assert.ok(/\.cb-tab \{ font-size:14px; line-height:22px; min-height:36px/.test(source));
  assert.ok(/\.cb-reading-meta \{ font-size:12px; line-height:18px;/.test(source));
  // §15 面包屑 13/20 必须内联下发：行内样式压过 CSS（实测写过 CSS 仍是 14/22）。
  assert.ok(/const QUIET_BREADCRUMB = \{ \.\.\.QUIET, fontSize: SECONDARY_FONT, lineHeight: LH_SECONDARY \};/.test(source));
  assert.equal([...source.matchAll(/className: 'cb-breadcrumb'/g)].length, 2, '两处面包屑都应存在');
  assert.equal([...source.matchAll(/style: QUIET_BREADCRUMB/g)].length, 3, '面包屑按钮全部走 QUIET_BREADCRUMB');
  assert.ok(!/\.cb-breadcrumb button \{/.test(source), '面包屑字号不得只写在 CSS 里（会被行内样式压掉）');
  assert.ok(/\.cb-issue \.cb-object-title \{ font-size:14px; font-weight:500; line-height:22px; \}/.test(source));
  // §6.3 / §19.3：阅读条目节距（用户 2026-10-04 为列表分割线放宽到 24px，线取节距中点）、
  // 待办走 Leading Rail（20px 列 + 12px 间隔）。
  assert.ok(/\.cb-reading-item \{ margin-block:0 24px; padding-block:0; \}/.test(source));
  assert.ok(/\.cb-todo \{ display:grid; grid-template-columns:var\(--leading-size\) minmax\(0,1fr\); column-gap:var\(--leading-gap\)/.test(source));
  assert.ok(/--leading-size:20px; --leading-gap:12px;/.test(source));
  // §7 节奏：标题→元信息 4px，搜索框→列表 12px。
  assert.ok(/\.cb-context-meta \{ margin-top:4px; margin-bottom:16px; \}/.test(source));
  assert.ok(/\.cb-list \{ padding-top:0; \}/.test(source) && /className: 'cb-list'/.test(source));
  // §8 布局间距 Token 为 4/8/12/16/24/32，不再有 20px 的"布局 token"。
  assert.ok(/--space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px;/.test(source));
  assert.ok(!/--space-20/.test(source));
  assert.ok(/!\(data\.authorities \|\| \[\]\)\.length && empty\('暂无关联依据'\)/.test(source));
});

test('事实／待办列表分割线：相邻条目之间一条；案件列表不划线', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const start = source.indexOf('/* 事实／待办列表分割线（用户 2026-10-04）');
  const end = source.indexOf('.cb-panel .cb-list { padding-top:0; }');
  assert.ok(start > 0 && end > start, '找不到列表分割线规则块：注释或锚点可能被改动');
  const block = source.slice(start, end);

  // 事实行与待办行之间：同为 .cb-reading-item，节距 24px，线取中点 -12px，横向落页面轨。
  assert.ok(/\.cb-panel \.cb-reading-list > \.cb-reading-item:not\(\.cb-issue\) \+ \.cb-reading-item:not\(\.cb-issue\)::before \{\s*content:''; position:absolute; inset-inline:0; top:-12px; height:1px;/.test(block),
    '事实/待办行之间应有 1px 分割线，取 24px 节距中点');
  // 争点行是可点卡片（hover 圆角底），不参与分割线。
  assert.ok(/:not\(\.cb-issue\)/.test(block), '争点行不得参与列表分割线');
  // 案件列表按用户 2026-10-04 的要求不划线（首页只留案件名）；办案经验共用同一个列表但未要求。
  assert.ok(!/\[data-kind="case"\][^;{]*::before/.test(block), '案件列表不得再划线');
  assert.ok(!/\[data-kind="practice"\][^;{]*::before/.test(block), '办案经验列表不得被划上分割线');
  // 只剩一条规则，且必须真的渲染：绝对定位伪元素 + content:'' + 主题边框色。
  assert.equal([...block.matchAll(/content:''; position:absolute/g)].length, 1, '分割线规则只剩事实/待办这一条');
  assert.equal([...block.matchAll(/background:var\(--dsw-alias-border-l3,#0000001f\); pointer-events:none; \}/g)].length, 1,
    '分割线必须用主题边框色，不得写死颜色');
  // 历史上的坑：用 border-top 画线会被行内 border:none（ROW）整条压掉（从未渲染）。
  assert.ok(!/border-top\s*:/.test(block), '分割线不得用 border-top 画（会被行内 border:none 压掉）');
  // CSS 规则需要一个真实落点：上下文列表容器必须带 cb-reading-list，且只带一处。
  assert.equal([...source.matchAll(/className: 'cb-reading-list'/g)].length, 1,
    '上下文列表容器应恰好带一个 cb-reading-list');
});

test('案件列表小字统一为「案件类型 · 我方立场」；名称走 strong、不划线', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function CaseBenchBody'), source.indexOf('function SettingsSection'));
  // 案件名仍是 strong（面板字重上限 500）。
  assert.ok(/jsx\('strong', \{ children: item\.name \|\| item\.title \}\)/.test(body), '案件名仍用 strong 渲染');
  // 小字统一为两段：案件类型（matter.type）+ 我方立场（engagement.role），顺序固定、分隔符固定。
  assert.ok(/caseTypeLabel\(item\.type\)\} · \$\{roleLabel\(item\.role, item\.type\)\}/.test(body),
    '案件行小字必须是「案件类型 · 我方立场」两段');
  assert.ok(/const caseTypeLabel = \(value\) => valueLabel\('kind', value, '案件类型待确认'\)/.test(source),
    '案件类型要有自己的缺失提示语（不能复用成果类型的「成果类型待确认」）');
  // 被换掉的三类小字：关联案件数／阶段／开庭日、最近成果——它们只出现在案件行分支里。
  for (const gone of ['个关联案件', 'stageLabel(item.stage)', 'dateLabel(item.next_event.at)']) {
    assert.ok(!body.includes(gone), `案件列表不应再渲染「${gone}」`);
  }
  // 读取失败的行仍要说明原因（故障提示，不是状态描述；去掉只剩一个点不动的死行）。
  assert.ok(/item\.status === 'error'\s*\n\s*\?\s*`状态异常：\$\{errorLabel\(item\.error\)\}`/.test(body),
    '读取失败的行必须保留原因');
  // 办案经验列表保持原样（来源 + 最近），不得被误删。
  assert.ok(/来源：\$\{item\.matter_name \|\| '待核'\}/.test(body), '办案经验的来源小字不得被误删');
  assert.ok(/最近：\$\{item\.recent_artifact\.title \|\| '成果'\}/.test(body), '办案经验的最近成果小字不得被误删');
  // 案件列表不划线：不允许出现 data-kind="case" 的分割线规则。
  assert.ok(!/\[data-kind="case"\][^;{]*::before/.test(source), '案件列表不得再划线');
});

test('未选择案件：标题与选择后同一格式（当前案件：待选择 + 一行小字）', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const shell = source.slice(source.indexOf('function WorkspaceShell'), source.indexOf('function CaseBenchBody'));
  // 标题行不再分叉：两种状态都是「13px 标签 + 20/28/500 名称」，未选择时名称位写「待选择」。
  assert.ok(/className: 'cb-current-label', children: '当前案件：'/.test(shell), '标签「当前案件：」必须两种状态都渲染');
  assert.ok(/className: 'cb-current-name', children: matter\?\.name \|\| '待选择'/.test(shell),
    '未选择案件时名称位应显示「待选择」，格式与案件名一致');
  // 小字：选择后是「阶段待确认 · 上诉人」，未选择时是引导语，两者同一位置同一字级（.cb-current-meta）。
  assert.ok(/className: 'cb-current-meta', children: '选择案件后查看详情与上下文'/.test(shell),
    '未选择案件时必须补一行小字，与选择后的阶段身份同格式');
  assert.ok(/matterMeta\(matter\) && jsx\('span', \{ className: 'cb-current-meta', children: matterMeta\(matter\) \}\)/.test(shell),
    '选择后的阶段身份仍只在有内容时渲染');
  // 旧实现是一行裸文本，字号继承正文、占不满 48px 信息槽 → 到搜索框空出一大截（用户 2026-10-04 截图）。
  assert.ok(!source.includes('选择案件查看工作与上下文'), '旧的一行裸文本不得再出现');
});

test('行盒宽度：Surface Bleed 左右对称，宽度由 CSS calc 配平，不得内联写死', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const row = source.slice(source.indexOf('function HoverRow'), source.indexOf('function useHover'));
  assert.ok(row.includes('function HoverRow'), '找不到 HoverRow');
  // 只看行内 style 对象，不看注释：注释里会出现「width:100%」这些字样本身。
  const style = row.slice(row.indexOf('style: {'), row.indexOf('children });'));
  // 行内写死宽度会和 .cb-object-row 的负外边距一起构成过约束：浏览器忽略右外边距并反算成 +8px，
  // 只剩左半边外扩（裸行右缘短 8px、卡内行右缘短 32px，2026-10-04 实测）。宽度统一由 CSS 给。
  assert.ok(!/width\s*:/.test(style), 'HoverRow 不得内联 width：宽度必须由 CSS 的 calc 给出');
  assert.ok(/display: 'block'/.test(style), 'HoverRow 必须保持块级（按钮默认 inline-block，auto 宽度是 fit-content）');
  // ROW 也不得再带 maxWidth:100%：它会把 calc(100% + 16px) 夹回包含块宽度，右侧又短 8px。
  const rowStyle = source.slice(source.indexOf('const ROW = {'), source.indexOf('const BUTTON ='));
  assert.ok(!/maxWidth/.test(rowStyle), 'ROW 不得带 maxWidth:100%：会夹掉 Surface Bleed 的外扩');
  // 两侧负外边距 + 配平宽度：裸行外扩 8px、卡内行铺满整张卡。
  assert.ok(/margin-block:4px; margin-inline:-8px; padding-inline:8px; border-radius:12px; line-height:22px;\s*width:calc\(100% \+ 16px\); \}/.test(source),
    '裸行必须保留 margin-inline:-8px 并配平 width:calc(100% + 16px)');
  assert.ok(/margin-inline:calc\(var\(--surface-padding-x\) \* -1\);[\s\S]{0,140}?width:calc\(100% \+ 2 \* var\(--surface-padding-x\)\); \}/.test(source),
    '卡内行必须保留负外边距并配平铺满卡的宽度');
  // 没有负外边距的行（案件详情分区/导航，48px 热区）宽度必须回 100%，否则会左右各外扩 8px。
  assert.ok(/margin:0; padding:13px 0!important; min-height:48px!important; border-radius:0; width:100%; \}/.test(source),
    '分区/导航行没有负外边距，宽度必须回 100%');
});

test('标签不铺灰底、当前案件是主信息、卡片规格一致', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

  // 用户 2026-10-03：横向标签已有黑色下划线表达选中，任何状态都不得再铺灰底。
  // 灰底不一定画在 background 上：宿主可能用渐变、内阴影或 ::before 画选中块，所以四类通道一起按住。
  assert.ok(/\.cb-panel \.cb-tab:hover, \.cb-panel \.cb-tab:active, \.cb-panel \.cb-tab:focus,\s*\.cb-panel \.cb-tab\[aria-pressed="true"\] \{ background:transparent!important; background-image:none!important; box-shadow:none!important; \}/.test(source),
    '标签在默认/悬停/按下/聚焦/选中态都必须透明');
  assert.ok(/\.cb-panel \.cb-tab::before, \.cb-panel \.cb-tab::after \{ content:none!important; \}/.test(source),
    '标签的伪元素也不得用来画选中块');
  // 真正的坑：通用 hover/active 规则的选择器比标签那条更长（(0,4,1) vs (0,3,0)），两条都 !important
  // 时按优先级定胜负，后补一条 transparent 盖不住 —— 必须在源头 :not() 掉，否则"鼠标放上去才冒灰底"。
  assert.ok(/\.cb-panel button:not\(:disabled\):not\(\.cb-primary\):not\(\.cb-tab\):hover,/.test(source),
    '通用 hover 必须在源头排除 .cb-tab');
  assert.ok(/\.cb-panel button:not\(:disabled\):not\(\.cb-primary\):not\(\.cb-tab\):active \{/.test(source),
    '通用 active 必须在源头排除 .cb-tab');
  assert.ok(/\.cb-panel summary:not\(\.cb-current-summary\):hover \{/.test(source),
    '通用 hover 必须在源头排除「当前案件」信息行');
  assert.ok(!/\.cb-context-actions > summary:hover \{ background:transparent/.test(source),
    '低优先级的"再盖一条 transparent"是无效写法，不要再出现');

  // 面板顶部的这一行就是案件详情页的标题：名称 20/28/500，标签 13/20，阶段身份 12/18。
  assert.ok(/\.cb-panel \.cb-current-name \{ font-size:20px; line-height:28px; font-weight:500;/.test(source),
    '当前案件名称应为 20/28/500（详情页不再重复写一遍标题）');
  assert.ok(/\.cb-panel \.cb-current-label \{ font-size:13px; line-height:18px; font-weight:400;/.test(source));
  assert.ok(/\.cb-panel \.cb-current-meta \{ display:block; margin-top:2px; font-size:12px; line-height:18px; font-weight:400;/.test(source),
    '阶段与身份应跟在名称下面（原详情页那两行移上来）');
  assert.ok(/function matterMeta\(matter\)/.test(source), '缺少"阶段 · 身份"的拼装函数');
  assert.ok(!/title: matter\.name \|\| '案件', children: \[/.test(source), '详情页不得再重复渲染案件标题与阶段身份');
  assert.equal([...source.matchAll(/style: QUIET_SMALL/g)].length, 2, '切换案件/恢复跟随会话应为次级字号');
  assert.ok(/const QUIET_SMALL = \{ \.\.\.QUIET, fontSize: SECONDARY_FONT, lineHeight: LH_SECONDARY \};/.test(source));
  assert.ok(/jsxs\('summary', \{ className: 'cb-current-summary'/.test(source),
    '当前案件行要带 cb-current-summary，通用 hover 才能把它排除掉（信息行不做灰底强调）');
  assert.ok(!/children: '⋯'/.test(source), '不再用省略号做展开提示');
  assert.equal([...source.matchAll(/className: 'cb-arrow'/g)].length, 1, '展开提示改用与折叠段一致的箭头槽');
  assert.ok(/\.cb-panel \.cb-context-actions > summary \.cb-arrow::after \{ content:'›'; \}/.test(source));
  assert.ok(/\.cb-panel \.cb-context-actions\[open\] > summary \.cb-arrow::after \{ content:'⌄'; \}/.test(source));

  // 用户 2026-10-03 进一步要求：案件详情里的分区**不做灰色卡片**，改裸行（FLAT_BLOCK）。
  // 折叠卡原来用 content-box + minHeight 64，实际渲染 88px，比导航卡高 24px 的死空间——一并消掉。
  assert.ok(/const FLAT_BLOCK = \{ margin: 0 \};/.test(source), '分区块应为无底色、无内边距的裸块');
  assert.ok(!/\.cb-panel \.cb-nav-row \{ margin-block:0; \}/.test(source), '全页只用一套行距，去向行不再单独清零间距');
  assert.equal([...source.matchAll(/className: 'cb-flat/g)].length, 3,
    '两个折叠分区 + 两块去向都应走 cb-flat（不套 .cb-content 灰卡）');
  assert.ok(/return jsxs\('section', \{ className: 'cb-flat', style: FLAT_BLOCK, children: \[/.test(source));
  assert.ok(!/className: 'cb-content cb-navigation'/.test(source), '去向不应再套灰色卡片');
  // 分隔线靠 CSS border-top 会被行内 border:none（ROW）压掉，从来没生效过；改为靠间距分组。
  assert.ok(!/cb-nav-row \+ \.cb-nav-row/.test(source), '分组靠间距，不用从来没生效过的分隔线');
  assert.ok(!/minHeight: 64/.test(source), '折叠卡不再有会变成死空间的 minHeight');
  assert.ok(!/radius-compact-hub/.test(source), '卡片圆角已统一，不再有单独的 compact hub 圆角');

  // 用户 2026-10-03：选过案件再回列表，那行灰底会一直留着——当前案件不再铺常驻灰底。
  assert.ok(!/aria-current="true"\] \{ background/.test(source), '不得为 aria-current 铺常驻灰底');
  assert.ok(!/plugin-interactive-selected/.test(source), '选中灰底 token 已无使用处，应一并删除');
  assert.ok(/fontWeight: strong \|\| selected \? 500 : 400, background: 'transparent' \}/.test(source),
    '行背景恒为透明，当前案件只用字重区分');

  // 用户 2026-10-03：最近工作等展开后的文件列表不要加粗（条目 400，分区标题才 500）。
  assert.ok(/jsx\('span', \{ style: \{ \.\.\.H3, fontWeight: 400, display: 'block' \}, children: title \}\)/.test(source),
    '成果条目应为常规字重');
  // 标签 14/22、6px 纵向内边距 + 2px 下划线 = 36px（QUIET 的 7px 会让它变 38px，必须显式写）。
  assert.equal([...source.matchAll(/borderRadius: 0, padding: '6px 0'/g)].length, 2, '两处标签行都要显式定 36px 高');
});

test('空闲时不重绘：只依赖原始值，且只读结果相同不落库', async () => {
  const source = await readFile(new URL('client.js' === '' ? '' : '../client.js', import.meta.url), 'utf8');
  // 实测症状（用户 2026-10-03）：空闲时面板持续闪烁。机制是"重读关联 → 宿主写会话状态 →
  // summary 换引用 → 再重读"的空转回环：effect 依赖 sessions store 里的对象引用就会自我触发。
  assert.ok(/\}, \[summary\?\.running\]\);/.test(source), '回合结束 effect 只能依赖 running 这个原始值');
  assert.ok(!/\}, \[summary\]\);/.test(source), 'effect 不得依赖 summary 对象引用');
  // 第二道保险：只读视图深度相同就不 setState（返回原引用，React 直接跳过重绘）。
  assert.ok(/function sameJson\(/.test(source));
  assert.equal([...source.matchAll(/sameJson\(current, /g)].length, 3,
    'follow / matter / context 三处只读结果都要做"无变化就不落库"判断');
});

test('吸顶头块贴顶且不覆盖上方操作，主题变化同步更新', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  assert.ok(/padding: '0 var\(--page-gutter\) 24px'/.test(source));
  assert.ok(/\.cb-scroll-body \{[^}]*overflow-y:auto; overflow-x:hidden/.test(source));
  assert.equal(source.match(/position: 'sticky'/g).length, 1);
  assert.ok(/const HEAD_STICKY = \{ position: 'sticky', top: 0, zIndex: 2, background: PANE_BG/.test(source));
  assert.ok(!/boxShadow:/.test(source), '头块不得向上用阴影覆盖其它操作');
  assert.ok(/setProperty\('--cb-pane-bg', bg\)/.test(source));
  assert.ok(/new MutationObserver\(update\)/.test(source));
});

test('待办：已完成用 500、未完成 400；复选框写回与筛选同口径', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

  // 已了结的判定必须只有一处口径：它同时驱动"字重""未完成计数""复选框勾选态""筛选"，
  // 两处不一致就会出现「显示已完成却仍计未完成」这类矛盾。
  assert.ok(/const SETTLED_PENDING = new Set\(/.test(source), '缺少已了结状态集合');
  assert.ok(/const isSettledPending = /.test(source), '缺少已了结判断函数');
  // 2.0 §5.1：字重只有 400/500 两档，已完成用 500 与未完成 400 区分。
  assert.ok(/fontWeight: isSettledPending\(item\.status\) \? 500 : 400/.test(source), '已完成 500、未完成 400');
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
    source.indexOf('function WorkspaceShell'));

  assert.ok(/const head = jsxs\('div', \{ style: \{ \.\.\.HEAD_STICKY, marginBottom: 12 \}/.test(contextDetail),
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
    source.indexOf('function WorkspaceShell'));

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

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parseReferences } from '../src/host/references.js';

const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const context = (name) => ({ matter: { id: `id-${name}`, name, path: `/root/${name}` }, state_hash: 'a'.repeat(64),
  counts: { issues: 1 }, issues: [{ issue_id: 'ISS-0001', title: `争点-${name}` }], facts: [], pending_items: [] });

/** 执行真正的客户端组件和事件处理器；可控延迟模拟网络逆序，而非源码字符串断言。 */
async function clientHarness() {
  const slots = [], effects = [], pending = [];
  let cursor = 0, helpers;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const React = {
    Component: class {},
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(fn, deps) { const index = cursor++; if (!same(effects[index]?.deps, deps)) {
      pending.push(() => { effects[index]?.dispose?.(); effects[index] = { deps, dispose: fn() }; });
    } },
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { innerHeight: 800, innerWidth: 1200, __ModuleLoader__: { load: ({ factory }) => { helpers = factory((name) => name === 'react' ? React : { jsx, jsxs: jsx }).uiHelpers; } } },
    setTimeout, clearTimeout,
  });
  return { helpers, renderComponent(type, props) { cursor = 1000; const tree = type(props); while (pending.length) pending.shift()(); return tree; }, render(props) { cursor = 0; const tree = helpers.CaseBenchBody(props); while (pending.length) pending.shift()(); return tree; },
    /** 模拟侧栏标签切换导致的卸载重挂载：组件状态槽清空，模块级会话记忆（sessionSelections）保留。 */
    remount() { for (const effect of effects) effect?.dispose?.(); slots.length = 0; effects.length = 0; pending.length = 0; cursor = 0; },
    dispose() { for (const effect of effects) effect?.dispose?.(); } };
}
function nodes(tree, predicate) {
  const result = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) result.push(node);
    visit(node.props?.children);
  }
  visit(tree); return result;
}
const button = (tree, name) => nodes(tree, (node) => node.type === 'button' && node.props.children === name)[0];
const body = (tree) => nodes(tree, (node) => typeof node.type === 'function' && node.type.name === 'ContextDetail')[0];

test('甲案请求后返回也不得覆盖乙案；切会话废弃原会话请求', async () => {
  const harness = await clientHarness();
  const a = deferred(), b = deferred();
  const remote = { workspace: async () => ({ matters: ['甲', '乙'].map((name) => ({ name, path: `/root/${name}`, status: 'ok' })) }),
    followSession: async () => ({ status: 'missing', cwd: '/root', source: 'workspace' }),
    context: ({ matterPath }) => matterPath.endsWith('甲') ? a.promise : b.promise,
    matter: async ({ path }) => ({ matter: { id: path, path }, recent_artifacts: [] }),
  };
  const props = { remote, sessionId: 's1', useTabInfo: () => ({ tab: {} }) };
  harness.render(props); await tick(); let tree = harness.render(props);
  // 清单行是 HoverRow 组件（function 节点；harness 不执行嵌套组件，直接读 props）。
  const rows = nodes(tree, (node) => node.type?.name === 'HoverRow');
  const first = rows[0].props.onClick(), second = rows[1].props.onClick();
  b.resolve(context('乙')); await second;
  a.resolve(context('甲')); await first;
  tree = harness.render(props);
  // 进入上下文须用当前乙案指针，而不能因甲案晚到而倒退。
  let requested;
  remote.context = async ({ matterPath }) => { requested = matterPath; return context('乙'); };
  await button(tree, '案件上下文').props.onClick(); await tick();
  tree = harness.render(props); assert.equal(requested, '/root/乙'); assert.equal(body(tree).props.context.matter.name, '乙');
  const late = deferred(); remote.followSession = ({ sessionId }) => sessionId === 's1' ? late.promise : Promise.resolve({ status: 'missing', cwd: '/root', source: 'workspace' });
  // 「重新读取」全面板只有标题行那一个；在上下文页点击它同样重读上下文（refresh('context')）。
  const refreshing = button(tree, '重新读取').props.onClick();
  harness.render({ ...props, sessionId: 's2' }); await tick();
  late.resolve({ status: 'ready', context: context('甲'), source: 'manual' }); await refreshing;
  tree = harness.render({ ...props, sessionId: 's2' }); assert.equal(body(tree), undefined);
  harness.dispose();
});

test('自动跟随默认进入上下文；引用校验期间的草稿冲突不得写入', async () => {
  const harness = await clientHarness(); const checked = deferred(); const draft = { revision: 1, text: '原文', attachments: ['附件'] };
  const remote = { workspace: async () => ({ matters: [] }),
    followSession: async () => ({ status: 'ready', cwd: '/root/甲', source: 'reference', context: context('甲') }),
    quoteIssue: async (args) => { assert.equal(args.matterId, 'id-甲'); assert.equal(args.expectedHash, 'a'.repeat(64)); return checked.promise; },
  };
  const actions = { captureInsertion: () => ({ revision: draft.revision }), insertText(text, span) {
    if (span.revision !== draft.revision) return false; draft.text += text; return true;
  } };
  const props = { remote, sessionId: 'quote-session', useTabInfo: () => ({ tab: {} }), inputActions: actions };
  harness.render(props); await tick(); let tree = harness.render(props); assert.equal(body(tree).props.context.matter.id, 'id-甲');
  const insert = body(tree).props.onQuote(context('甲').issues[0]);
  draft.revision++; draft.text = '用户后续编辑';
  checked.resolve({ ...context('甲'), issue: context('甲').issues[0] }); await insert;
  assert.equal(draft.text, '用户后续编辑'); assert.deepEqual(draft.attachments, ['附件']);
  remote.quoteIssue = async () => ({ ...context('甲'), issue: context('甲').issues[0] });
  tree = harness.render(props); await body(tree).props.onQuote(context('甲').issues[0]);
  assert.equal(parseReferences(draft.text)[0].matterPath, '/root/甲');
  assert.deepEqual(draft.attachments, ['附件']);
  assert.match(harness.helpers.factVerificationLabel({ status: 'verified; original_not_seen_in_current_read' }), /本次读取未见原件/);
  harness.dispose();
});

test('面板重挂载后停在离开时的详情页（含二级页指针）', async () => {
  const harness = await clientHarness();
  const remote = {
    workspace: async () => ({ matters: [{ name: '甲', path: '/root/甲', status: 'ok' }] }),
    followSession: async () => ({ status: 'missing', cwd: '/root', source: 'workspace' }),
    context: async () => context('甲'),
    matter: async ({ path }) => ({ matter: { id: 'id-甲', name: '甲', path },
      recent_artifacts: [], final_artifacts: [], authority_refs: [] }),
  };
  const props = { remote, sessionId: 's1', useTabInfo: () => ({ tab: {} }) };
  const detailOf = (tree) => nodes(tree, (node) => node.type?.name === 'MatterDetail')[0];

  harness.render(props); await tick(); let tree = harness.render(props);
  // 点开案件详情。
  const rows = nodes(tree, (node) => node.type?.name === 'HoverRow');
  await rows[0].props.onClick(); await tick();
  tree = harness.render(props);
  assert.ok(detailOf(tree), '点选案件后应打开详情页');

  // 模拟侧栏标签切换导致的卸载重挂载：应恢复案件详情，而不是回到列表首页。
  harness.remount();
  harness.render(props); await tick(); tree = harness.render(props);
  const restored = detailOf(tree);
  assert.ok(restored, '重挂载后应恢复离开时的案件详情页');
  assert.equal(restored.props.data.matter.path, '/root/甲');
  assert.equal(restored.props.initialPage, 'main');
  restored.props.onPageChange('final');
  harness.render(props); harness.remount();
  harness.render(props); await tick(); tree = harness.render(props);
  assert.equal(detailOf(tree).props.initialPage, 'final');
  harness.dispose();
});

test('打开文件后恢复最近工作及三级子页，保留展开状态、隔离会话，主动返回不复活详情', async () => {
  const harness = await clientHarness(); const opened = [];
  const artifact = { title: '文书', path: 'Agents/文书.docx' };
  const remote = {
    workspace: async () => ({ matters: [{ name: '甲', path: '/root/甲', status: 'ok' }] }),
    followSession: async () => ({ status: 'ready', source: 'manual', context: context('甲') }),
    context: async () => context('甲'),
    matter: async ({ path }) => ({ matter: { id: 'id-甲', name: '甲', path },
      proceedings: [{ proceeding_id: '1' }, { proceeding_id: '2' }],
      recent_artifacts: Array.from({ length: 6 }, () => artifact), final_artifacts: [artifact],
      authority_refs: [{ ...artifact, type: 'statute' }, { ...artifact, type: 'case' }] }),
  };
  const props = { remote, sessionId: 'navigation', useTabInfo: () => ({ tab: {
    actions: { openResource: (address) => opened.push(address) } } }) };
  const detailOf = (tree) => nodes(tree, (node) => node.type?.name === 'MatterDetail')[0];
  const renderDetail = (tree) => { const node = detailOf(tree); return harness.renderComponent(node.type, node.props); };
  const restore = async () => { harness.remount(); harness.render(props); await tick(); return harness.render(props); };
  harness.render(props); await tick(); let tree = harness.render(props);
  await button(tree, '案件').props.onClick(); tree = harness.render(props);
  await nodes(tree, (node) => node.type?.name === 'HoverRow')[0].props.onClick();
  tree = harness.render(props); let detail = renderDetail(tree);
  nodes(detail, (node) => node.type?.name === 'Collapsible')[1].props.onToggle();
  const recent = nodes(renderDetail(tree), (node) => node.type?.name === 'Collapsible')[0];
  nodes(recent, (node) => node.type?.name === 'HoverRow')[0].props.onClick();
  detail = renderDetail(tree);
  nodes(detail, (node) => node.type?.name === 'ArtifactRow')[0].props.onOpen(artifact.path);
  tree = await restore(); detail = renderDetail(tree);
  assert.equal(detailOf(tree).props.initialPage, 'main');
  assert.equal(nodes(detail, (node) => node.type?.name === 'Collapsible')[1].props.open, true);
  assert.equal(nodes(detail, (node) => node.type?.name === 'ArtifactRow').length, 6);
  for (const [index, page] of [[1, 'final'], [2, 'statute'], [3, 'case']]) {
    nodes(detail, (node) => node.type?.name === 'NavRow')[index].props.onClick();
    tree = harness.render(props); detail = renderDetail(tree);
    nodes(detail, (node) => node.type?.name === 'ArtifactRow')[0].props.onOpen(artifact.path);
    tree = await restore(); detail = renderDetail(tree);
    assert.equal(detailOf(tree).props.initialPage, page);
    assert.equal(nodes(detail, (node) => node.type?.name === 'PageHead')[0].props.title,
      { final: '已定稿', statute: '本案法条', case: '参考案例' }[page]);
    nodes(detail, (node) => node.type?.name === 'PageHead')[0].props.onBack();
    tree = harness.render(props); detail = renderDetail(tree);
  }
  assert.equal(opened.length, 4);
  harness.remount(); harness.render({ ...props, sessionId: 'other' }); await tick();
  assert.equal(detailOf(harness.render({ ...props, sessionId: 'other' })), undefined);
  tree = await restore(); assert.ok(detailOf(tree));
  detailOf(tree).props.onBack(); harness.render(props);
  tree = await restore(); assert.equal(detailOf(tree), undefined);
  harness.dispose();
});


test('办案经验按当前文档读取关联依据，点选与返回均可达', async () => {
  const harness = await clientHarness();
  const data = { metadata: { title: '办案经验', origin: {} }, body: '经验正文',
    authorities: [{ id: 'a1', title: '关联依据', type: 'statute', locator: '第一条' }] };
  let tree = harness.renderComponent(harness.helpers.PracticeDetail, { data });
  assert.equal(nodes(tree, (node) => node.type?.name === 'PageHead')[0].props.title, '办案经验');
  nodes(tree, (node) => node.type?.name === 'HoverRow')[0].props.onClick();
  tree = harness.renderComponent(harness.helpers.PracticeDetail, { data });
  const head = nodes(tree, (node) => node.type?.name === 'PageHead')[0];
  assert.equal(head.props.title, '关联依据');
  head.props.onBack();
  tree = harness.renderComponent(harness.helpers.PracticeDetail, { data });
  assert.equal(nodes(tree, (node) => node.type?.name === 'PageHead')[0].props.title, '办案经验');
  harness.dispose();
});

test('行高按对象类型内联生效：导航行 30、案件行 48、其余 48', async () => {
  const harness = await clientHarness();
  const { HoverRow } = harness.helpers;
  // 2.0 §3.3 / §6.4 的行高必须通过内联样式下发：CSS 的 min-height 压不过内联样式，
  // 写在内联里才是真实生效的（改前 CSS 写了 40/64，实际渲染全是 56，已用预览 HTML 核对）。
  assert.equal(HoverRow({ kind: 'nav', children: 'x' }).props.style.minHeight, 30);
  assert.equal(HoverRow({ kind: 'case', children: 'x' }).props.style.minHeight, 48);
  assert.equal(HoverRow({ kind: 'practice', children: 'x' }).props.style.minHeight, 48);
  assert.equal(HoverRow({ children: 'x' }).props.style.minHeight, 48);
  // 2.0 §5.1：选中只改字重（500/400）与背景，不改尺寸与文字坐标。
  const plain = HoverRow({ children: 'x' }).props.style;
  const selected = HoverRow({ selected: true, children: 'x' }).props.style;
  assert.equal(plain.fontWeight, 400);
  assert.equal(selected.fontWeight, 500);
  assert.equal(plain.minHeight, selected.minHeight);
  assert.equal(plain.paddingBlock, selected.paddingBlock);
  harness.dispose();
});


test('上下文不重复案件标题；公共 Shell 与正文滚动区分离', async () => {
  const harness = await clientHarness();
  const tree = harness.renderComponent(harness.helpers.ContextDetail, {
    context: context('布局案'), sub: 'issues', onSub() {}, onBack() {}, onOpenMatter() {},
  });
  assert.equal(nodes(tree, (node) => node.type === 'h2').length, 0);
  assert.ok(button(tree, '← 案件列表'));
  assert.ok(button(tree, '案件详情 ›'));
  const panel = harness.render({ remote: { workspace: async () => ({ matters: [] }), followSession: async () => ({ status: 'missing' }) },
    sessionId: 'layout', useTabInfo: () => ({ tab: {} }) });
  assert.equal(panel.props.className, 'cb-panel cb-workspace');
  assert.equal(panel.props.style.overflow, 'hidden');
  assert.equal(nodes(panel, node => node.props?.className === 'cb-workspace-shell').length, 1);
  assert.equal(nodes(panel, node => node.props?.className === 'cb-scroll-body').length, 1);
  harness.dispose();
});


test('上下文使用同一案件详情的阶段与身份，切换案件不串元信息', async () => {
  const harness = await clientHarness();
  const remote = { workspace: async () => ({ matters: [] }),
    followSession: async () => ({ status: 'ready', context: context('元信息') }),
    matter: async ({ path }) => ({ matter: { id: 'id-元信息', path, stage: 'unknown', role: 'appellant' } }) };
  const props = { remote, sessionId: 'metadata', useTabInfo: () => ({ tab: {} }) };
  harness.render(props); await tick(); await tick();
  const tree = harness.render(props);
  const meta = nodes(tree, node => node.props?.className === 'cb-current-meta')[0];
  assert.ok(meta);
  assert.equal(meta.props.children, '阶段待确认 · 上诉人');
  harness.dispose();
});


test('紧凑筛选菜单支持箭头确认和 Escape，选择不触发案件写入', async () => {
  const harness = await clientHarness();
  let value = 'all';
  const props = { label: '测试筛选', value, options: [['all', '全部'], ['verified', '已核验']], onChange: next => { value = next; } };
  let tree = harness.renderComponent(harness.helpers.FilterSelect, props);
  const trigger = nodes(tree, node => node.props?.['aria-haspopup'] === 'listbox')[0];
  trigger.props.ref.current = { getBoundingClientRect: () => ({ left: 16, top: 100, bottom: 136, width: 180 }), focus() {} };
  trigger.props.onClick();
  tree = harness.renderComponent(harness.helpers.FilterSelect, props);
  assert.equal(nodes(tree, node => node.props?.role === 'listbox').length, 1);
  const box = nodes(tree, node => node.props?.role === 'listbox')[0];
  assert.ok(nodes(tree, node => node.props?.id === box.props['aria-activedescendant']).length === 1);
  tree.props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  tree = harness.renderComponent(harness.helpers.FilterSelect, props);
  tree.props.onKeyDown({ key: 'Enter', preventDefault() {} });
  assert.equal(value, 'verified');
  tree = harness.renderComponent(harness.helpers.FilterSelect, { ...props, value });
  assert.equal(nodes(tree, node => node.props?.role === 'listbox').length, 0);
  nodes(tree, node => node.props?.['aria-haspopup'] === 'listbox')[0].props.onClick();
  tree = harness.renderComponent(harness.helpers.FilterSelect, { ...props, value });
  tree.props.onKeyDown({ key: 'Escape', preventDefault() {} });
  tree = harness.renderComponent(harness.helpers.FilterSelect, { ...props, value });
  assert.equal(nodes(tree, node => node.props?.role === 'listbox').length, 0);
  assert.equal(value, 'verified');
  harness.dispose();
});

test('案件列表小字：真实 type/role 渲染为「案件类型 · 我方立场」', async () => {
  const harness = await clientHarness();
  // 取真实工作区 5 案的 type/role 取值（litigation/bankruptcy/non-litigation × plaintiff/appellant/administrator/debtor）。
  const remote = {
    workspace: async () => ({ matter_count: 3, matters: [
      { name: '甲案', path: '/root/甲', status: 'ok', type: 'litigation', role: 'plaintiff' },
      { name: '乙案', path: '/root/乙', status: 'ok', type: 'bankruptcy', role: 'administrator' },
      { name: '丙案', path: '/root/丙', status: 'ok', type: 'non-litigation', role: 'debtor' }] }),
    followSession: async () => ({ status: 'missing', cwd: '/root', source: 'workspace' }),
    context: async () => context('甲'), matter: async () => ({ matter: { id: 'id-甲', path: '/root/甲' }, recent_artifacts: [] }),
  };
  const props = { remote, sessionId: 's1', useTabInfo: () => ({ tab: {} }) };
  harness.render(props); await tick();
  const tree = harness.render(props);
  const texts = [];
  nodes(tree, (node) => { if (typeof node.props?.children === 'string') texts.push(node.props.children); return false; });
  for (const expected of ['诉讼 · 原告', '破产 · 管理人', '非诉 · 债务人']) {
    assert.ok(texts.includes(expected), `案件行缺少统一小字「${expected}」；实际文本：${JSON.stringify(texts)}`);
  }
  assert.ok(!texts.some((text) => /阶段|最近：|个关联案件/.test(text)),
    `案件行不得再渲染阶段/最近成果/关联案件数；实际文本：${JSON.stringify(texts)}`);
  harness.dispose();
});

test('争点搜索匹配标题与编号，清空恢复列表', async () => {
  const harness = await clientHarness();
  const data = { ...context('搜索'), issues: [{ issue_id: 'ISS-0001', title: '借款性质' }, { issue_id: 'ISS-0002', title: '工程款清偿' }] };
  const props = { context: data, sub: 'issues', onSub() {}, onBack() {} };
  let tree = harness.renderComponent(harness.helpers.ContextDetail, props);
  let search = nodes(tree, node => node.props?.['aria-label'] === '搜索争点')[0];
  search.props.onChange({ target: { value: '工程款' } });
  tree = harness.renderComponent(harness.helpers.ContextDetail, props);
  assert.equal(nodes(tree, node => node.type?.name === 'HoverRow').length, 1);
  search = nodes(tree, node => node.props?.['aria-label'] === '搜索争点')[0];
  search.props.onChange({ target: { value: 'ISS-0001' } });
  tree = harness.renderComponent(harness.helpers.ContextDetail, props);
  assert.equal(nodes(tree, node => node.type?.name === 'HoverRow').length, 1);
  nodes(tree, node => node.props?.['aria-label'] === '搜索争点')[0].props.onChange({ target: { value: '' } });
  tree = harness.renderComponent(harness.helpers.ContextDetail, props);
  assert.equal(nodes(tree, node => node.type?.name === 'HoverRow').length, 2);
  harness.dispose();
});

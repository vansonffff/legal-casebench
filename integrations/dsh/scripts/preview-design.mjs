/** 从实际客户端组件生成无案件数据的样式预览；不替代真实 Host/交互验收。 */
import vm from 'node:vm';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
let client;
const jsx = (type, props) => ({ type, props: props || {} });
const React = { Component: class {}, useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (value) => ({ current: value }), useEffect: () => {} };
vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: ({ factory }) => { client = factory((name) => name === 'react' ? React : { jsx, jsxs: jsx }); } } },
});
const { MatterDetail, ContextDetail, PracticeDetail, HoverRow, WorkspaceShell, PanelStyles, PANEL_STYLE, INPUT, pageGutter } = client.uiHelpers;
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unitless = new Set(['fontWeight', 'lineHeight', 'opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order']);
const css = (style) => Object.entries(style || {}).map(([key, value]) => `${key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase())}:${typeof value === 'number' && value !== 0 && !unitless.has(key) ? value + 'px' : value}`).join(';');
function render(node) {
  if (node === null || node === undefined || node === false) return '';
  if (Array.isArray(node)) return node.map(render).join('');
  if (typeof node !== 'object') return escape(node);
  if (typeof node.type === 'function') return render(node.type(node.props));
  const { children, style, ...props } = node.props;
  let attrs = style ? ` style="${escape(css(style))}"` : '';
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') || key === 'ref' || value === undefined || (value === false && !key.startsWith('aria-') && !key.startsWith('data-'))) continue;
    const attr = key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key;
    attrs += value === true && !key.startsWith('aria-') && !key.startsWith('data-') ? ` ${attr}` : ` ${attr}="${escape(value)}"`;
  }
  if (['input', 'hr', 'br'].includes(node.type)) return `<${node.type}${attrs}>`;
  return `<${node.type}${attrs}>${node.type === 'style' ? children : render(children)}</${node.type}>`;
}
const noop = () => {};
const artifacts = [
  { title: '诉讼策略与庭审提纲', kind: 'analysis', at: '2026-10-03', path: 'draft.md' },
  { title: '补充证据目录及说明', kind: 'final', at: '2026-10-02', path: 'final.docx' },
  { title: '关于合同履行与举证责任的法律检索', kind: 'research', at: '2026-10-01', path: 'research.md' },
];
// 两条关联案件：真实系列案都是多条，且只有 >1 条时「关联案件」折叠卡才会出现——
// 单条时预览里看不到折叠卡，也就量不到"折叠卡与导航卡是否一样高"。
const matter = { id: 'sample', name: '示例合同纠纷案件（含较长名称以验证换行）', path: '/fixture/sample', stage: 'first-instance', role: 'plaintiff' };
const data = { matter, proceedings: [{ proceeding_id: 'p1', name: '合同纠纷', case_number: '示例案号', stage: 'first-instance', status: 'active' },
    { proceeding_id: 'p2', name: '示例执行案件', case_number: '示例执字号', stage: 'enforcement', status: 'active' }],
  recent_artifacts: artifacts, final_artifacts: [artifacts[1]], final_artifact_count: 1, authority_refs: [] };
const context = { matter, read_at: '2026-10-03T10:00:00', counts: { facts: 2, issues: 1, pending_items: 2 },
  facts: [{ fact_id: 'FACT-0001', text: '双方确认已交付部分货物，其余货物的交付情况尚待查明。', kind: 'party_statement', material_grade: 'B', verification: { status: 'partially_verified' } },
    { fact_id: 'FACT-0002', text: '对账记录载明已支付首笔货款。', kind: 'material_record', material_grade: 'A', verification: { status: 'verified' } }],
  issues: [{ issue_id: 'ISS-0001', title: '已交付货物的货款是否已清偿', status: 'open', fact_refs: ['FACT-0001'] }],
  pending_items: [{ item_id: 'TASK-0001', title: '核对银行流水与对账记录，逐项标记材料来源、交易日期以及尚待补充核验的事项', status: 'open' },
    { item_id: 'TASK-0002', title: '整理首轮证据目录', status: 'completed' }] };
// 案件列表（首页）：案件名 + 一行统一小字「案件类型 · 我方立场」（用户 2026-10-04）。
// 「未选择案件」与它共用同一份列表与外壳，只是 matter 为 null——两页成对渲染，
// 才能量到「未选择时的间距必须与选择后一致」（用户 2026-10-04：未选择时那句话离下方太远）。
const caseList = jsx('div', { className: 'cb-list', children: [jsx('input', { id: 'sample-search', 'aria-label': '搜索案件', style: { ...INPUT, marginBottom: 8 }, placeholder: '搜索案件' }),
  ...[[matter.name, '诉讼 · 原告'], ['示例公司合同纠纷', '破产 · 管理人'], ['示例执行案件', '非诉 · 债务人']].map(([name, meta], index) => jsx(HoverRow, { onClick: noop, kind: 'case', selected: index === 1,
    children: jsx('span', { children: [jsx('strong', { children: name }),
      jsx('span', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', display: 'block' }, children: meta })] }) }))] });
const pages = [
  ['案件列表', caseList],
  ['未选择案件', caseList],
  ['案件详情', jsx(MatterDetail, { data, onBack: noop, openFile: noop, onContext: noop, viewScope: 'fixture' })],
  ['事实筛选', jsx(ContextDetail, { context, sub: 'facts', onSub: noop, onBack: noop, onOpenMatter: noop, onQuote: noop, onTogglePending: noop })],
  ['争点搜索', jsx(ContextDetail, { context, sub: 'issues', onSub: noop, onBack: noop, onOpenMatter: noop, onQuote: noop, onTogglePending: noop })],
  ['待办', jsx(ContextDetail, { context, sub: 'pending', onSub: noop, onBack: noop, onOpenMatter: noop, onQuote: noop, onTogglePending: noop })],
  ['办案经验', jsx(PracticeDetail, { data: { metadata: { title: '合同证据整理经验', origin: { matter_name: '示例案件' } }, body: '核对交易记录时，应逐项记录材料来源与待核事项。',
    // 带一条关联依据：这张卡里的行是"卡内行底色铺满卡"的唯一实测样本。
    authorities: [{ id: 'a1', title: '关于举证责任分配的规定', type: 'statute', locator: '示例条文' }] }, onBack: noop, onSource: noop })],
];
const preview = pages.map(([title, node]) => `<section><h2>${title}</h2><div class="comparison">${['light', 'dark'].map((theme) => {
  const shell = jsx(WorkspaceShell, { tab: ['事实筛选', '争点搜索', '待办'].includes(title) ? 'context' : title === '办案经验' ? 'practice' : 'cases',
    matter: title === '未选择案件' ? null : matter, follow: { cwd: '/fixture', source: 'workspace' }, onChoose: noop, onRefresh: noop, onReset: noop, onPick: noop });
  const root = jsx('div', { className: 'cb-panel cb-workspace', 'data-cb-theme': theme,
    style: { ...PANEL_STYLE, '--page-gutter': pageGutter(320) + 'px', height: '100%', overflow: 'hidden' },
    children: [jsx(PanelStyles, {}), shell, jsx('div', { className: 'cb-scroll-body', children: node })] });
  return `<div class="host ${theme}" data-page="${title}">${render(root).replaceAll('sample-search', theme + '-sample-search')}<div class="audit-rails" aria-hidden="true"><i style="left:16px">P</i><i style="left:32px">C</i><i style="left:48px">L</i></div></div>`;
}).join('')}</div></section>`).join('');

const wideContext = { ...context, facts: [{ ...context.facts[0], text: context.facts[0].text.repeat(8) }] };
const widePreview = `<section><h2>800px 宽栏阅读</h2>${['light', 'dark'].map(theme => {
  const root = jsx('div', { className: 'cb-panel cb-workspace', 'data-cb-theme': theme,
    style: { ...PANEL_STYLE, '--page-gutter': pageGutter(800) + 'px', height: '100%', overflow: 'hidden' },
    children: [jsx(PanelStyles, {}), jsx(WorkspaceShell, { tab: 'context', matter, follow: { source: 'workspace' }, onChoose: noop, onRefresh: noop }),
      jsx('div', { className: 'cb-scroll-body', children: jsx(ContextDetail, { context: wideContext, sub: 'facts', onSub: noop, onBack: noop, onOpenMatter: noop, onQuote: noop, onTogglePending: noop }) })] });
  return `<div class="host wide ${theme}" data-page="800px 宽栏阅读">${render(root)}<div class="audit-rails" aria-hidden="true"><i style="left:24px">P</i><i style="left:40px">C</i><i style="left:56px">L</i></div></div>`;
}).join('')}</section>`;
const output = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, '../../../Agents/过程稿/casebench-native-metrics-20261003/preview.html');
await mkdir(dirname(output), { recursive: true });
/**
 * 轨线量测（?measure=1）：把代表元素的真实左缘、字号行高与面板溢出情况写进 #cb-measure，
 * 由 scripts/measure-rails.mjs 在 headless 浏览器里读出来核对 §4.8 的 ±1px 门禁。
 * 选择器与量测期望分家：本文件只负责"量什么"，期望值在 measure-rails.mjs 里。
 */
const MEASURE_SELECTORS = {
  'shell-title': '.cb-panel h3',
  breadcrumb: '.cb-breadcrumb button',
  'page-title': '.cb-page-head h2, .cb-context-title',
  search: '.cb-list input',
  'bare-row-box': '.cb-list .cb-object-row',
  'bare-row-text': '.cb-list .cb-object-row strong',
  'surface-row': '.cb-content .cb-object-row',
  'surface-row-text': '.cb-content .cb-object-row > span',
  'surface-reading': '.cb-content .cb-reading-text',
  'fact-text': '.cb-reading-item > .cb-reading-text',
  'todo-check': '.cb-todo input',
  'todo-text': '.cb-todo-title',
  // 横向标签：选中态必须**实测**为透明底（用户两次指出「有黑色下划线就别再上灰底」）。
  'first-tab': '.cb-tab',
  'selected-tab': '.cb-tab[aria-pressed="true"]',
  'section-row': '.cb-flat .cb-object-row',
  'section-row-text': '.cb-flat .cb-object-row > span',
  // 展开后的文件条目：字重必须比分区标题轻（用户 2026-10-03：不要用加粗字号）。
  'artifact-title': '.cb-flat .cb-object-row:not([aria-expanded]) > span',
  // 案件列表的小字统一为「案件类型 · 我方立场」，12/18 落页面轨。
  'case-meta': '.cb-list .cb-object-row > span > span',
  // 面板顶部的当前案件：名称 16/24/500、标签 13/20、阶段身份 12/18。
  'current-case-label': '.cb-current-label',
  'current-case-name': '.cb-current-name',
  'current-case-meta': '.cb-current-meta',
  // 案件详情里的分区行不得再被灰色卡片包住（用户 2026-10-03 要求这一页不做灰卡）。
  'section-row-in-card': '.cb-content .cb-flat .cb-object-row, .cb-content .cb-object-row[aria-expanded]',
};
const MEASURE_SCRIPT = `
const MEASURE_SELECTORS = ${JSON.stringify(MEASURE_SELECTORS, null, 1)};
if (new URLSearchParams(location.search).has('rails')) document.body.classList.add('audit');
if (new URLSearchParams(location.search).has('measure')) {
  const hosts = [...document.querySelectorAll('.host')].map((host) => {
    const panel = host.querySelector('.cb-panel');
    // 一律以面板左缘为 0，量测值直接就是轨线坐标（页面里还有预览自身的 margin 与并排栏偏移）。
    const origin = panel ? panel.getBoundingClientRect().left : host.getBoundingClientRect().left;
    const probes = {};
    for (const [name, selector] of Object.entries(MEASURE_SELECTORS)) {
      const node = host.querySelector(selector);
      if (!node) continue;
      const box = node.getBoundingClientRect();
      const computed = getComputedStyle(node);
      const before = getComputedStyle(node, '::before');
      const after = getComputedStyle(node, '::after');
      probes[name] = { left: +(box.left - origin).toFixed(2), right: +(box.right - origin).toFixed(2),
        height: +box.height.toFixed(2), fontSize: computed.fontSize, lineHeight: computed.lineHeight,
        fontWeight: computed.fontWeight, background: computed.backgroundColor,
        // 灰底不一定画在 background 上：渐变、内阴影、伪元素都要一起量。
        backgroundImage: computed.backgroundImage, boxShadow: computed.boxShadow,
        beforeContent: before.content, beforeBackground: before.backgroundColor,
        afterContent: after.content, afterBackground: after.backgroundColor };
    }
    return { page: host.dataset.page, theme: host.dataset.theme || (host.classList.contains('dark') ? 'dark' : 'light'),
      width: host.clientWidth, gutter: panel ? parseFloat(getComputedStyle(panel).getPropertyValue('--page-gutter')) : null,
      issueCorners: [...host.querySelectorAll('.cb-issue')].map(node => {
        const box = node.getBoundingClientRect(), scroll = host.querySelector('.cb-scroll-body').getBoundingClientRect();
        return { radius: getComputedStyle(node).borderRadius, leftClearance: box.left - scroll.left, rightClearance: scroll.right - box.right };
      }),
      contentStart: ['事实筛选', '争点搜索', '待办'].includes(host.dataset.page) ? host.querySelector('.cb-scroll-body').firstElementChild.children[1].getBoundingClientRect().top - panel.getBoundingClientRect().top : null,
      // 标题信息槽（当前案件：名称 + 小字）里**真实文字**的底边到搜索框顶边的距离。
      // 不能只量 .cb-current 的外框：它是 min-height:48px 撑出来的，两种状态一样，量不出问题；
      // 要量小字（没有小字就退回标题行）——那才是用户看到的"这句话离下方多远"。
      headerGap: (() => {
        const search = host.querySelector('.cb-list input');
        const current = host.querySelector('.cb-current');
        if (!search || !current || !panel) return null;
        const top = panel.getBoundingClientRect().top;
        const text = host.querySelector('.cb-current-meta') || host.querySelector('.cb-current-line');
        return { searchTop: search.getBoundingClientRect().top - top,
          currentBottom: current.getBoundingClientRect().bottom - top,
          textBottom: text ? text.getBoundingClientRect().bottom - top : null };
      })(),
      bands: [...host.querySelectorAll('.cb-matter-main > .cb-flat > .cb-object-row, .cb-matter-main .cb-navigation-item > .cb-object-row')].map(node => {
        const box = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { left: box.left - origin, width: box.width, height: box.height, radius: style.borderRadius, margin: style.margin };
      }),
      dividers: [...host.querySelectorAll('.cb-matter-main > .cb-flat + .cb-flat, .cb-navigation > .cb-navigation-item + .cb-navigation-item')].map(node => {
        const box = node.getBoundingClientRect(), line = getComputedStyle(node, '::before');
        return { left: box.left - origin + parseFloat(line.left), width: parseFloat(line.width) };
      }),
      // 列表分割线候选节点（案件行 / 事实行 / 待办行）：不只量位置，还要读 ::before 的 content——
      // "规则写了但没渲染"正是这个仓库踩过的坑（border-top 被行内 border:none 压掉）。
      // 因此每条记录都带 painted：门禁按**已渲染**的线条数核对，候选节点数单独留证
      // （案件列表要求"有行但 0 条线"，没有候选就没法区分"没画线"和"fixture 空了"）。
      listDividers: [...host.querySelectorAll('.cb-list .cb-object-row[data-kind="case"] + .cb-object-row[data-kind="case"], .cb-reading-list > .cb-reading-item:not(.cb-issue) + .cb-reading-item:not(.cb-issue)')].map(node => {
        const box = node.getBoundingClientRect(), line = getComputedStyle(node, '::before');
        const previous = node.previousElementSibling;
        return { left: box.left - origin + parseFloat(line.left), width: parseFloat(line.width),
          height: parseFloat(line.height), content: line.content, background: line.backgroundColor,
          painted: line.content !== 'none' && line.content !== 'normal' && parseFloat(line.height) > 0,
          // 线上方的节距与线的纵向下移量：线必须落在节距中点（否则会贴住相邻条目）。
          gapAbove: previous ? box.top - previous.getBoundingClientRect().bottom : null,
          lineTop: parseFloat(line.top) };
      }),
      // 行盒横向几何：裸行/争点行是 Surface Bleed 行，底色必须**左右对称外扩 8px**；卡内行必须铺满整张卡。
      // 历史缺陷（2026-10-04 修）：HoverRow 内联 width:100% 让负的右外边距被过约束规则反算成 +8px，
      // 只有左半边外扩——裸行右侧短 8px，卡内行右缘短 32px。这里按真实几何量，不按 CSS 文本猜。
      bleedRows: [['bare', '.cb-list .cb-object-row'], ['issue', '.cb-issue'], ['card', '.cb-content .cb-object-row']]
        .flatMap(([kind, selector]) => [...host.querySelectorAll(selector)].map((node) => {
          const box = node.getBoundingClientRect();
          return { kind, left: box.left - origin, right: box.right - origin };
        })),
      panel: panel ? { scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth } : null, probes };
  });
  document.getElementById('cb-measure').textContent = JSON.stringify({ hosts }, null, 1);
}`;
await writeFile(output, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CaseBench 320px 样式预览</title><style>
body{font-family:-apple-system,"PingFang SC",sans-serif;margin:24px;background:#eee}h1{font-size:20px}h2{font-size:16px}.comparison{display:flex;gap:24px;flex-wrap:wrap}.host{position:relative;width:320px;height:800px;--cb-pane-bg:#fff;--dsw-alias-label-primary:#17191c;--dsw-alias-label-secondary:#666b70;--dsw-alias-label-tertiary:#8a8f94;--dsw-alias-border-l3:#0000001f;background:#fff}.dark{--cb-pane-bg:#181818;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#aaa;--dsw-alias-label-tertiary:#888;--dsw-alias-border-l3:#ffffff26;background:#181818}section{margin-bottom:24px}.host.wide{width:800px;height:720px;margin-bottom:24px}.audit-rails{display:none;position:absolute;inset:0;pointer-events:none}.audit-rails i{position:absolute;top:0;bottom:0;border-left:1px solid #1c80ff;font:11px sans-serif;color:#1c80ff;font-style:normal}.audit .audit-rails{display:block}#cb-measure{white-space:pre-wrap;font:12px ui-monospace,monospace}
</style><h1>CaseBench · 320px 浅色 / 深色样式预览</h1><p>实际 Client 组件的静态输出，使用虚构样本；交互由真实桌面及组件回归验证。轨线：<b>P</b> 页面轨/裸行文字 · <b>C</b> Surface 内容轨（P+16）· <b>L</b> Leading 文字轨（P+32）。</p><pre id="cb-measure"></pre>${preview}${widePreview}<script>${MEASURE_SCRIPT}</script></html>`);
console.log(output);

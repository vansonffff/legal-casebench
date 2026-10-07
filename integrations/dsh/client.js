// CaseBench 右侧栏：读取 Core Read Model；唯一的写通道是待办状态写回（pending.py）。
//
// 视觉遵循 DSH/docs/DSH-PLUGIN-DESIGN-SYSTEM-2.0.md（Native Metrics，2026-10-03）：
// 单列 Object List / Detail、语义 Surface、Content Rail 严格对齐、36px 标准控件、
// Compact / Reading 双密度；面板内字重只用 400 / 500。
window.__ModuleLoader__.load({
  id: 'dsh-legal-casebench',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');
    const { useEffect, useRef, useState, Component } = React;
    exports.inject = ['remote', 'slots', 'sidebarRightTabs'];

    const PACKAGE = 'dsh-legal-casebench';
    const NAMESPACE = 'casebench';
    const ID = 'legal-casebench';
    const KIND = 'casebench';
    const INVOCATIONS = [
      { method: 'status', implementation: 'remoteStatus', parameters: [] },
      { method: 'workspace', implementation: 'remoteWorkspace', parameters: [] },
      { method: 'matter', implementation: 'remoteMatter', parameters: [{ name: 'args' }] },
      { method: 'context', implementation: 'remoteContext', parameters: [{ name: 'args' }] },
      { method: 'followSession', implementation: 'remoteFollowSession', parameters: [{ name: 'args' }] },
      { method: 'quoteIssue', implementation: 'remoteQuoteIssue', parameters: [{ name: 'args' }] },
      { method: 'reference', implementation: 'remoteReference', parameters: [{ name: 'args' }] },
      { method: 'practiceList', implementation: 'remotePracticeList', parameters: [] },
      { method: 'practiceShow', implementation: 'remotePracticeShow', parameters: [{ name: 'args' }] },
      // 面板唯一的写方法：待办状态写回（open/completed）。
      { method: 'setPendingStatus', implementation: 'remoteSetPendingStatus', parameters: [{ name: 'args' }] },
    ];
    const codec = () => ({ mode: 'strict', parse: (value) => value });
    const TYPERT_REMOTE = { package: PACKAGE, descriptors: INVOCATIONS.map((entry) => ({
      id: `${PACKAGE}#${NAMESPACE}/${entry.method}`,
      service: NAMESPACE,
      namespace: NAMESPACE,
      method: entry.method,
      implementation: entry.implementation,
      invocation: { kind: 'direct' },
      parameters: entry.parameters.map((parameter) => ({
        name: parameter.name, wire: parameter.name, source: 'json', acceptsUndefined: false,
        codec: { mode: 'strict', typeSymbol: `${PACKAGE}#${NAMESPACE}/${entry.method}:${parameter.name}`, create: codec },
      })),
      result: { mode: 'strict', typeSymbol: `${PACKAGE}/${NAMESPACE}#${entry.method}:result`, create: codec },
    })) };

    // ── 统一设计 Token（DSH 插件设计体系 2.0 · Native Metrics）────────────
    // 字号层级只用五档：20 页面/对象标题、14 正文与节/对象标题（争点仅保留字重区别）、
    // 13 面包屑（§15）、12 元信息（§3.1）；字重只用 400 / 500（§5.1），面板内不得出现 600。
    const FONT = '14px';
    const LH_BODY = '20px';
    const SECONDARY_FONT = '13px';
    const LH_SECONDARY = '18px';
    const NOTE_FONT = '12px';
    const LH_META = '18px';
    const H3_FONT = '14px';
    const H2_FONT = '20px';
    const H1_FONT = '20px';
    const LH_TITLE = '28px';
    const LH_READING = '22px';
    // 控件与行高：标准控件 36px、主操作 40px（§3.3 / §12）；导航行30px、对象行48px、案件行48px（§6.4）。
    const CONTROL_HEIGHT = 36;
    const PRIMARY_HEIGHT = 40;
    const ROW_MIN = { nav: 30, case: 48, default: 48 };
    const TEXT_PRIMARY = 'var(--dsw-alias-label-primary, #17191c)';
    const TEXT_SECONDARY = 'var(--dsw-alias-label-secondary, #666b70)';
    const TEXT_TERTIARY = 'var(--dsw-alias-label-tertiary, #8a8f94)';
    const BORDER = 'var(--dsw-alias-border-l3, #0000001f)';
    const HOVER = 'var(--plugin-interactive-hover)';
    const PANE_BG = 'var(--cb-pane-bg, var(--dsw-alias-bg-overlay, #fff))';
    const SURFACE = 'var(--plugin-surface-subtle)';
    const CONTROL = 'var(--plugin-surface-control)';
    const H1 = { fontSize: H1_FONT, lineHeight: LH_TITLE, fontWeight: 500, color: TEXT_PRIMARY, margin: 0, overflowWrap: 'anywhere' };
    const H2 = { fontSize: H2_FONT, lineHeight: LH_TITLE, fontWeight: 500, color: TEXT_PRIMARY, margin: 0, overflowWrap: 'anywhere' };
    // H3 会内联进按钮（折叠段标题），所以这里不能带 margin：内联的 margin 简写会压掉
    // CSS 的 Surface Bleed（行盒几何全在 PANEL_CSS 里，见下）。H3 的使用处都是 div/span，
    // 本身没有默认外边距，去掉 margin 不影响其它位置。
    const H3 = { fontSize: H3_FONT, lineHeight: '22px', fontWeight: 500, color: TEXT_PRIMARY };
    const MUTED = { color: TEXT_SECONDARY, fontSize: NOTE_FONT, lineHeight: LH_META };
    const TINY = { color: TEXT_TERTIARY, fontSize: NOTE_FONT, lineHeight: LH_META };
    // 根容器承担页面 16/24px 留白；正文与标题一律落 Content Rail。
    const PAD_X = '0px';
    // 行盒的几何（水平内边距、外边距、圆角）全部由 PANEL_CSS 决定：内联写死就没法区分
    // 裸行（P）与卡内行（P+16，底色铺满卡），实测踩过两次。
    // 也没有 maxWidth:100%：Surface Bleed 行本来就比包含块左右各宽 8px（宽度由 CSS 的
    // calc(100% + 16px) 给出），内联 max-width:100% 会把它夹回包含块宽度，右侧又短 8px
    // （2026-10-04 实测：行盒停在 [轨左−8, 轨右−8]）。溢出由滚动区的 8px 内边距与
    // overflow-x:hidden 承接，长内容由 overflowWrap:anywhere 折行。
    const ROW = {
      display: 'flex', alignItems: 'center', gap: '8px', boxSizing: 'border-box',
      minWidth: 0, minHeight: ROW_MIN.default, paddingBlock: 8,
      border: 'none', background: 'transparent', color: TEXT_PRIMARY,
      font: 'inherit', fontSize: FONT, lineHeight: LH_BODY, textAlign: 'left', cursor: 'pointer', overflowWrap: 'anywhere',
    };
    const BUTTON = { ...ROW, width: 'auto', minHeight: CONTROL_HEIGHT, borderRadius: '12px',
      border: `1px solid ${BORDER}`, padding: '6px 12px' };
    const QUIET = {
      border: 'none', background: 'transparent', color: TEXT_SECONDARY,
      font: 'inherit', fontSize: FONT, lineHeight: LH_BODY, padding: '6px 0', borderRadius: '8px',
      cursor: 'pointer', textAlign: 'left', minHeight: 32,
    };
    // 面包屑是 13/20（§15）：必须内联下发——QUIET 已经把字号写在行内，CSS 规则压不过它
    // （实测过：写了 `.cb-breadcrumb button{font-size:13px}` 仍是 14/22）。
    const QUIET_BREADCRUMB = { ...QUIET, fontSize: SECONDARY_FONT, lineHeight: LH_SECONDARY };
    // 次级操作（切换案件 / 恢复跟随会话）：比主信息小一档，避免和「当前案件」抢层级。
    const QUIET_SMALL = { ...QUIET, fontSize: SECONDARY_FONT, lineHeight: LH_SECONDARY };
    const INPUT = {
      width: '100%', boxSizing: 'border-box', minWidth: 0, minHeight: CONTROL_HEIGHT, height: CONTROL_HEIGHT,
      border: `1px solid ${BORDER}`, borderRadius: '12px', padding: '6px 12px',
      background: CONTROL, color: TEXT_PRIMARY, font: 'inherit', fontSize: FONT, lineHeight: LH_BODY,
    };
    const SELECT = { ...INPUT, width: 'auto', maxWidth: '100%', flex: '1 1 120px', fontSize: SECONDARY_FONT, lineHeight: LH_SECONDARY };
    const CONTENT = { background: SURFACE, borderRadius: '20px', padding: '12px var(--surface-padding-x)',
      margin: '12px 0', minWidth: 0, overflowWrap: 'anywhere' };
    // 案件详情里的分区（最近工作 / 关联案件 / 去向）不做灰色卡片：它们是连续的可点行，
    // 按 §10.2 / §17 用裸行 + Hover Surface 表达；**全页只用一套行距**（行 40px + 8px，§7 的
    // ObjectRow 间距），不再区分"组内紧、组间松"——用户 2026-10-03 要求「统一间距」。
    const FLAT_BLOCK = { margin: 0 };
    const NOTICE_BOX = { ...MUTED, padding: 12, margin: '12px 0',
      borderRadius: '12px', border: `1px solid ${BORDER}`, overflowWrap: 'anywhere' };
    const NOTE = { ...MUTED, padding: `4px ${PAD_X}`, overflowWrap: 'anywhere' };
    const DIVIDER = { height: '1px', background: BORDER, margin: '12px 0' };
    // 无上延阴影与负 margin：不透明背景、top:0，留白由头块自身承担。
    const HEAD_STICKY = { position: 'sticky', top: 0, zIndex: 2, background: PANE_BG,
      paddingTop: 0, paddingBottom: 0, marginBottom: 8 };
    const PANEL_STYLE = {
      color: TEXT_PRIMARY, fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
      fontSize: FONT, lineHeight: LH_BODY, width: '100%', marginInline: 0,
      padding: '0 var(--page-gutter) 24px', minWidth: 0, boxSizing: 'border-box',
    };
    // 样式限定在插件根节点，不改宿主组件；主题由实际面板背景推导并随宿主变化更新。
    const PANEL_CSS = `
      .cb-panel { --plugin-surface-subtle:#f7f7f7; --plugin-surface-control:#fff;
        --plugin-interactive-hover:var(--dsw-alias-interactive-bg-hover,#0000000a);
        --plugin-interactive-active:var(--dsw-alias-interactive-bg-active,#0000001a);
        --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px;
        --page-gutter:16px; --surface-padding-x:16px; --leading-size:20px; --leading-gap:12px;
        --radius-lg:20px; --radius-md:12px; --radius-sm:8px; --radius-pill:999px;
      }
      .cb-panel[data-cb-theme="dark"] { --plugin-surface-subtle:#252525; --plugin-surface-control:#181818;
        --plugin-interactive-hover:var(--dsw-alias-interactive-bg-hover,#ffffff0a);
        --plugin-interactive-active:var(--dsw-alias-interactive-bg-active,#ffffff24); }
      /* hover / active 反馈只给行与按钮。标签（.cb-tab）和「当前案件」信息行必须**在源头就排除**：
         它们自身那条 transparent!important 的选择器更短（.cb-panel .cb-tab:hover 只有 (0,3,0)），
         和下面这两条通用规则（(0,4,1)）比优先级是输的——两条都 !important 时按优先级定胜负，
         结果就是"只在鼠标放上去时冒灰底"（用户 2026-10-03 实测反馈）。
         不要再靠"后面再补一条 transparent"来盖，只能在这里 :not() 掉。 */
      .cb-panel button:not(:disabled):not(.cb-primary):not(.cb-tab):hover,
      .cb-panel summary:not(.cb-current-summary):hover { background:var(--plugin-interactive-hover)!important; }
      .cb-panel button:not(:disabled):not(.cb-primary):not(.cb-tab):active { background:var(--plugin-interactive-active)!important; }
      .cb-panel :is(button,input,select,a,summary):focus-visible { outline:2px solid #1c80ff; outline-offset:3px; }
      .cb-panel input[placeholder^="搜索"]:focus { outline:none; box-shadow:none; }
      .cb-panel :is(button,input,select):disabled { opacity:.5; cursor:not-allowed; }
      .cb-panel input::placeholder { color:var(--dsw-alias-label-secondary,#666b70); opacity:1; }
      .cb-panel input[type="checkbox"] { accent-color:var(--dsw-alias-brand-primary,#1c80ff); }
      .cb-panel [role="alert"] { color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary)); }
      .cb-panel .cb-primary { background:var(--dsw-alias-label-primary,#17191c); color:var(--plugin-surface-control); border:none!important; }
      .cb-panel .cb-primary:not(:disabled):hover { opacity:.85; }
      .cb-panel .cb-primary:not(:disabled):active { opacity:.7; }
      /* 标签任何状态都不铺灰底：不只 background，连 background-image、box-shadow 和伪元素一起按住
         ——宿主样式可能用渐变/内阴影/::before 画选中块，只清 background 拦不住（用户两次反馈）。 */
      .cb-panel .cb-tab, .cb-panel .cb-tab:hover, .cb-panel .cb-tab:active, .cb-panel .cb-tab:focus,
      .cb-panel .cb-tab[aria-pressed="true"] { background:transparent!important; background-image:none!important; box-shadow:none!important; }
      .cb-panel .cb-tab::before, .cb-panel .cb-tab::after { content:none!important; }
      /* 标签 14/22；6px 纵向内边距 + 2px 下划线 = 36px，与标准控件同高（§3.3、§13.1）。 */
      .cb-panel .cb-tab { font-size:14px; line-height:22px; min-height:36px; padding:6px 0; }
      /* 裸行 Surface Bleed：背景向内容轨外扩 8px，文字仍落在页面轨 P（§4.4）。
         **宽度必须显式给**：行是 <button>，表单控件的 auto 宽度是 fit-content、不会撑满包含块；
         只写负外边距在宽度确定时又会过约束——内联 width:100% 会让右外边距被反算成 +8px，
         只有左边外扩、右侧短 8px（2026-10-04 实测）。calc(100% + 16px) 与左右 −8px 配对才左右对称。 */
      .cb-panel .cb-object-row { margin-block:4px; margin-inline:-8px; padding-inline:8px; border-radius:12px; line-height:22px;
        width:calc(100% + 16px); }
      /* 卡内行：背景铺满整张卡（外扩卡的水平内边距），文字仍落在卡内容轨 P+16；
         卡片本身 overflow:hidden，让铺满的背景被卡的圆角裁掉，不露出直角。 */
      .cb-panel .cb-content { overflow:hidden; }
      .cb-panel .cb-content .cb-object-row { margin-inline:calc(var(--surface-padding-x) * -1);
        padding-inline:var(--surface-padding-x); border-radius:0;
        width:calc(100% + 2 * var(--surface-padding-x)); }
      .cb-panel .cb-content .cb-object-row:focus-visible { outline-offset:-3px; }
      /* 去向行与其它对象行同节距：全页只有一套行距（行 40px + 上下各 4px ⇒ 行间 8px）。
         分隔线用 CSS border-top 会被行内 border:none（ROW）压掉，从来没生效过，故不再使用。 */
      /* 当前案件摘要行：它是信息行，不是按钮条——hover 灰底在上面那条通用规则里用
         :not(.cb-current-summary) 排除了（这里再补一条 transparent 是无效的：优先级比通用规则低）。 */
      .cb-panel .cb-context-actions > summary .cb-arrow::after { content:'›'; }
      .cb-panel .cb-context-actions[open] > summary .cb-arrow::after { content:'⌄'; }
      /* 公共 Shell 不参与正文滚动；各子页共用同一条页面轨。 */
      .cb-panel.cb-workspace { display:flex; flex-direction:column; overflow:hidden; padding-bottom:0; }
      .cb-panel .cb-workspace-shell { flex:0 0 auto; min-width:0; background:var(--cb-pane-bg,var(--dsw-alias-bg-overlay,#fff)); }
      .cb-panel .cb-scroll-body { flex:1 1 auto; min-height:0; min-width:0; overflow-y:auto; overflow-x:hidden; margin-inline:-8px; padding:0 8px 24px; }
      .cb-panel .cb-workspace-shell h3 { margin:0; padding:0; }
      .cb-panel .cb-current-summary { margin:0; padding-inline:0; }
      .cb-panel .cb-page-head { padding-inline:0; }
      /* 同级入口之间加细线，绝对定位不改变行距；分割线落在正文轨。 */
      .cb-panel .cb-matter-main > .cb-flat { position:relative; }
      .cb-panel .cb-matter-main > .cb-flat + .cb-flat::before { content:''; position:absolute;
        inset-inline:0; top:0; height:1px; background:var(--dsw-alias-border-l3,#0000001f); pointer-events:none; }
      .cb-panel .cb-navigation-item { position:relative; }
      .cb-panel .cb-matter-main .cb-navigation > .cb-navigation-item + .cb-navigation-item::before { content:''; position:absolute;
        inset-inline:0; top:0; height:1px; background:var(--dsw-alias-border-l3,#0000001f); pointer-events:none; }
      /* 案件详情分区入口使用48px热区，完整占满分割线之间的区域。
         这些行没有负外边距（margin:0），宽度回到 100%，不参与 Surface Bleed 的 calc 外扩。 */
      .cb-panel .cb-matter-main > .cb-flat > .cb-object-row,
      .cb-panel .cb-matter-main .cb-navigation-item > .cb-object-row {
        margin:0; padding:13px 0!important; min-height:48px!important; border-radius:0; width:100%; }
      .cb-panel .cb-matter-main > .cb-flat + .cb-flat::before,
      .cb-panel .cb-matter-main .cb-navigation > .cb-navigation-item + .cb-navigation-item::before { z-index:1; }
      /* 事实／待办列表分割线（用户 2026-10-04）：两条相邻条目之间一条 1px 细线。
         绝对定位的 ::before，不参与布局、不改变行高；不能用 border-top——行内 border:none（ROW）
         会把它整条压掉（这个坑已经踩过一次）。
         横向落页面轨（条目本身就在页面轨上），纵向取节距中点：0 + 24px → 24px → -12px。
         争点行是可点卡片（hover 圆角底），不参与，故 :not(.cb-issue) 排除在外。
         案件列表按用户同一轮的要求**不划线**（只留案件名，保持首页洁净），所以这里没有 data-kind="case" 的规则。 */
      .cb-panel .cb-reading-list > .cb-reading-item { position:relative; }
      .cb-panel .cb-reading-list > .cb-reading-item:not(.cb-issue) + .cb-reading-item:not(.cb-issue)::before {
        content:''; position:absolute; inset-inline:0; top:-12px; height:1px;
        background:var(--dsw-alias-border-l3,#0000001f); pointer-events:none; }
      .cb-panel .cb-list { padding-top:0; }
      .cb-panel .cb-reading-text { max-width:720px; margin-left:0; margin-right:auto; font-size:14px; line-height:22px; font-weight:400; }
      .cb-panel .cb-reading-item { margin-block:0 24px; padding-block:0; }
      .cb-panel .cb-issue { padding-block:0!important; }
      .cb-panel .cb-issue .cb-object-title { font-size:14px; font-weight:500; line-height:22px; }
      .cb-panel .cb-todo { display:grid; grid-template-columns:var(--leading-size) minmax(0,1fr); column-gap:var(--leading-gap); padding:0; margin-block:0 24px; }
      .cb-panel .cb-todo-title { font-size:14px; line-height:22px; }
      .cb-panel .cb-reading-meta { font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary,#666b70); margin-top:4px; }
      /* 面包屑 13/20 由 QUIET_BREADCRUMB 内联下发：行内样式压过 CSS，写在这里等于没写。 */
      .cb-panel .cb-breadcrumb { display:flex; align-items:center; gap:8px; flex-wrap:nowrap; min-height:32px; margin-bottom:8px; }
      .cb-panel .cb-context-title { font-size:20px; line-height:28px; font-weight:500; margin:0; }
      .cb-panel .cb-context-meta { margin-top:4px; margin-bottom:16px; }
      .cb-panel .cb-page-head .cb-context-meta { margin-bottom:0; }
      .cb-panel .cb-context-meta > div { padding:0!important; }
      .cb-panel .cb-select { flex:1 1 120px; min-width:0; }
      .cb-panel .cb-select-menu { position:fixed; z-index:100; box-sizing:border-box; overflow-y:auto;
        padding:4px; border:1px solid var(--dsw-alias-border-l3,#0000001f); border-radius:12px;
        background:var(--plugin-surface-control); color:var(--dsw-alias-label-primary,#17191c); }
      .cb-panel .cb-select-menu button { display:block; width:100%; min-height:32px; border:0; padding:6px 8px;
        border-radius:8px; background:transparent; color:inherit; font:inherit; font-size:13px; line-height:20px; text-align:left; }
      .cb-panel .cb-select-menu button[aria-selected="true"] { font-weight:500; }
      .cb-panel .cb-select-menu button[data-active="true"] { background:var(--plugin-interactive-hover); }
      .cb-panel .cb-filter { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; align-items:center; padding-block:8px 0; height:44px; box-sizing:border-box; }
      .cb-panel .cb-filter > :only-child { grid-column:1 / -1; }
      .cb-panel .cb-filter-note { margin-left:auto; min-width:0; max-width:96px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cb-panel .cb-pending-hit { display:flex; justify-content:center; align-items:flex-start; padding-top:3px; min-height:22px; cursor:pointer; }
      .cb-panel .cb-pending-hit:has(input:disabled) { cursor:default; }
      .cb-panel .cb-context-actions { margin-top:8px; }
      /* 面板顶部的「当前案件」= 案件详情页的标题：名称 20/28/500（§5.1 子页标题 / §5.3 案件名），
         前面 13/20 的标签说明这一行是什么，下面 12/18 是它的阶段与身份（原详情页那两行移到这里）。 */
      .cb-panel .cb-context-actions > summary { display:flex; gap:12px; align-items:center; padding:4px 0; list-style:none; }
      .cb-panel .cb-context-actions > summary::-webkit-details-marker { display:none; }
      .cb-panel .cb-current { display:block; flex:1; min-width:0; min-height:48px; }
      .cb-panel .cb-current-line { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cb-panel .cb-current-label { font-size:13px; line-height:18px; font-weight:400; color:var(--dsw-alias-label-secondary,#666b70); }
      .cb-panel .cb-current-name { font-size:20px; line-height:28px; font-weight:500; color:var(--dsw-alias-label-primary,#17191c); }
      .cb-panel .cb-current-meta { display:block; margin-top:2px; font-size:12px; line-height:18px; font-weight:400;
        color:var(--dsw-alias-label-secondary,#666b70); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cb-panel .cb-context-actions[open] > summary { margin-bottom:8px; }
      .cb-panel strong { font-size:14px; font-weight:500; line-height:22px; }
      .cb-panel summary { cursor:pointer; border-radius:8px; }
      .cb-panel .cb-technical { font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
      .cb-panel .cb-reading-detail > .cb-content { padding:16px!important; }
      .cb-panel .cb-content > .cb-content { background:transparent; border-radius:0; padding:12px 0; border-top:1px solid var(--dsw-alias-border-l3,#0000001f); }
    `;
    function PanelStyles() { return jsx('style', { children: PANEL_CSS }); }
    const pageGutter = (width) => width < 520 ? 16 : 24;
    function usePaneTheme(holder) {
      useEffect(() => {
        const root = holder.current;
        if (!root || !globalThis.getComputedStyle) return;
        const update = () => {
          let node = root.parentElement;
          while (node) {
            const bg = globalThis.getComputedStyle(node).backgroundColor;
            const channels = bg.match(/[\d.]+/g)?.map(Number);
            if (channels?.length >= 3 && (channels.length < 4 || channels[3] === 1)) {
              root.style.setProperty('--cb-pane-bg', bg);
              const lightness = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
              root.setAttribute('data-cb-theme', lightness < 128 ? 'dark' : 'light');
              break;
            }
            node = node.parentElement;
          }
        };
        update();
        const layout = () => root.style.setProperty('--page-gutter', `${pageGutter(root.getBoundingClientRect().width)}px`);
        layout();
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(layout);
        resize?.observe(root);
        const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
        // 只观察祖先主题属性，不监听插件自己写入的 style，避免循环触发。
        for (let node = root.parentElement; node; node = node.parentElement)
          observer?.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] });
        const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
        media?.addEventListener?.('change', update);
        return () => { resize?.disconnect(); observer?.disconnect(); media?.removeEventListener?.('change', update); };
      }, []);
    }
    /**
     * 连续对象保持裸行。当前案件只用字重（500）与 aria-current 标记，**不铺常驻灰底**——
     * 用户 2026-10-03：选过案件再回列表时，那行的灰色强调会一直留着（面板顶部已写明当前案件）。
     * 交互反馈只有 hover / active 两态。
     *
     * **宽度由 CSS 给，不能内联写死**（2026-10-04 修几何不对称时实测）：
     * .cb-object-row 靠左右各 8px 的负外边距 + 8px 内边距做 Surface Bleed（背景向外 8px、
     * 文字留在页面轨）。一旦内联写死宽度，左右外边距就都成了确定值，属于过约束，
     * 浏览器按规则**忽略右外边距并反算它**——负值被改写成 +8px，
     * 结果是行盒 = [页面轨左−8, 页面轨右−8]：只有左半边外扩，右侧反而短 8px；
     * 卡内行更明显（左右各 −16px），右缘短 32px，悬停底色铺不满卡。
     * 宽度统一写在 PANEL_CSS 里（裸行 calc(100% + 16px)、卡内行 calc(100% + 2 * surface-padding-x)）：
     * <button> 的 auto 宽度是 fit-content，靠它撑不满包含块，负外边距也就无从生效。
     */
    function HoverRow({ onClick, disabled, children, strong, selected, kind, reading }) {
      return jsx('button', { type: 'button', onClick, disabled,
        className: `cb-object-row${kind === 'nav' ? ' cb-nav-row' : ''}${reading ? ' cb-reading-item cb-issue' : ''}`, 'data-kind': kind,
        'aria-current': selected ? 'true' : undefined,
        // 行高按对象类型内联下发：CSS 的 min-height 压不过内联样式，写在 CSS 里等于没写（实测）。
        style: { ...ROW, display: 'block', minHeight: ROW_MIN[kind] || ROW_MIN.default,
          fontWeight: strong || selected ? 500 : 400, background: 'transparent' }, children });
    }
    function useHover() {
      const [hover, setHover] = useState(false);
      return [hover, { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }];
    }

    function unwrap(response) {
      if (response && response.ok === true) return response.value;
      if (response && response.ok === false) throw new Error(errorLabel(response.error?.message));
      if (response && typeof response === 'object') return response;
      throw new Error('未返回结果');
    }
    /** 只读视图是纯 JSON，深度相同即"没有新真相"；用于避免无谓重绘，切断重读回环。 */
    function sameJson(left, right) {
      if (left === right) return true;
      try { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }
      catch { return false; }
    }
    function fileAddress(sessionId, path) {
      if (!sessionId) throw new Error('请先选择一个会话再打开文件。');
      return 'dsh-resource://file/session/' + encodeURIComponent(sessionId) + '/' + path.split('/').map(encodeURIComponent).join('/');
    }
    // 仅翻译展示值；规范字段仍按原值参与匹配，未知英文值用中文提示。
    const labels = {
      stage: { 'first-instance': '一审', 'second-instance': '二审', 'retrial-review': '再审审查',
        retrial: '再审', enforcement: '执行', interlocutory: '中间程序', 'claim-review': '债权审查' },
      role: { plaintiff: '原告', defendant: '被告', 'third-party': '第三人', appellant: '上诉人',
        respondent: '被上诉人', applicant: '申请人', 'respondent-to-application': '被申请人',
        administrator: '管理人', debtor: '债务人', creditor: '债权人', investor: '投资人',
        'restructuring-advisor': '重整顾问', other: '其他' },
      status: { active: '进行中', closed: '已结案', 'appeal-filed': '已提起上诉', appealed: '已上诉',
        withdrawn: '已撤回', scheduled: '已安排', completed: '已完成', cancelled: '已取消', pending: '待处理' },
      kind: { research: '检索成果', analysis: '分析成果', final: '定稿成果', legacy_file: '历史定稿文件',
        litigation: '诉讼', bankruptcy: '破产', 'non-litigation': '非诉', other: '其他' },
      authority: { statute: '法律规范', case: '参考案例' },
      verification: {
        unverified: '未核验', partially_verified: '部分核验', verified: '已核验',
        pending: '待核验', legacy_unverified: '未核验（旧编号）',
        model_inference: '模型推断，未核验', conditional_inference: '有条件推断，未核验',
        verified_as_party_statement: '已核验（属当事人陈述）',
        verified_as_judgment_record: '已核验（属裁判记载）',
        verified_as_current_judgment_record: '已核验（属本次裁判记载）',
        verified_with_limited_proposition: '已核验（证明范围有限）',
        verified_with_unresolved_source_and_destination: '已核验（付款人与去向未查明）',
      },
      // 事实类别（fact.kind）：真实数据里 4 种取值都在用。
      factKind: {
        material_record: '材料记载', party_statement: '当事人陈述',
        model_inference: '模型推断', legacy_unclassified: '未分类旧条目',
        judgment_record: '裁判记载', third_party_record: '第三方记载',
      },
      // 材料性质是 A/B/C 分级，不是编号，按"等级"显示更可读。
      materialGrade: { A: 'A 级', B: 'B 级', C: 'C 级', D: 'D 级' },
      // 争点状态与确信度：只翻译已知的英文枚举值，中文自由值（如"异议待处理"）原样保留。
      issue: {
        open: '待处理', active: '进行中', pending: '待处理', closed: '已结束', resolved: '已解决',
        withdrawn: '已撤回', moot: '已无实际意义',
        // 真实数据里这四个中文自由值照原样，此处列出只为说明它们不会被改写。
      },
      confidence: { high: '高', medium: '中', low: '低' },
      // 待办状态：真实数据混用中英文（进行中/待办/open/pending/done…）。
      pending: {
        open: '待处理', pending: '待处理', in_progress: '进行中', doing: '进行中',
        done: '已完成', completed: '已完成', closed: '已关闭', cancelled: '已取消',
        blocked: '受阻', deferred: '已搁置',
      },
    };
    function valueLabel(group, value, fallback) {
      if (!value || value === 'unknown' || value === 'unclassified') return fallback;
      return labels[group]?.[value] || (/[A-Za-z]/.test(String(value)) ? fallback : String(value));
    }
    const stageLabel = (value) => valueLabel('stage', value, '阶段待确认');
    const roleLabel = (value, type) => value === 'restructuring-advisor' && type === 'non-litigation'
      ? '重组顾问' : valueLabel('role', value, '角色待确认');
    const statusLabel = (value) => valueLabel('status', value, '状态待确认');
    /**
     * 面板顶部「当前案件」下面的阶段与身份（从案件详情页移上来的那一行）。
     * 只拼接**数据里真实存在**的字段：从工作区列表来的案件没有 role，就不会凭空写「角色待确认」；
     * 阶段确实登记为 unknown 时保留「阶段待确认」——只显示一次，是有信息量的（与列表行的省略规则不同）。
     */
    /** 紧凑筛选菜单：保留单选语义，键盘箭头选择，Enter 确认，Escape 关闭。 */
    let filterSequence = 0;
    function FilterSelect({ label, value, options, onChange }) {
      const [menu, setMenu] = useState(null);
      const [active, setActive] = useState(0);
      const trigger = useRef(null);
      const listbox = useRef(null);
      const [menuId] = useState(() => `cb-filter-${++filterSequence}`);
      useEffect(() => { if (menu) listbox.current?.focus(); }, [menu]);
      useEffect(() => { listbox.current?.querySelector(`[data-active="true"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
      const current = Math.max(0, options.findIndex(([id]) => id === value));
      useEffect(() => {
        if (!menu) return;
        const close = event => { if (!event.target?.closest?.('.cb-select-menu')) setMenu(null); };
        window.addEventListener?.('scroll', close, true);
        window.addEventListener?.('resize', close);
        return () => { window.removeEventListener?.('scroll', close, true); window.removeEventListener?.('resize', close); };
      }, [menu]);
      function open() {
        const rect = trigger.current.getBoundingClientRect();
        const height = Math.min(options.length * 32 + 8, 240);
        const below = window.innerHeight - rect.bottom;
        setActive(current);
        setMenu({ left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
          top: below >= height ? rect.bottom + 4 : Math.max(8, rect.top - height - 4), width: rect.width,
          maxHeight: Math.min(height, window.innerHeight - 16) });
      }
      function pick(index) { onChange(options[index][0]); setMenu(null); trigger.current?.focus(); }
      function key(event) {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'Escape') { setMenu(null); trigger.current?.focus(); return; }
          if (!menu) { open(); return; }
          if (event.key === 'Enter' || event.key === ' ') { pick(active); return; }
          setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        }
      }
      return jsxs('div', { className: 'cb-select', onKeyDown: key,
        onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null); }, children: [
        jsxs('button', { ref: trigger, type: 'button', style: { ...SELECT, width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
          'aria-label': label, 'aria-haspopup': 'listbox', 'aria-expanded': Boolean(menu), 'aria-controls': menu ? menuId : undefined,
          onClick: () => menu ? setMenu(null) : open(), children: [jsx('span', { children: options[current][1] }), jsx('span', { 'aria-hidden': true, children: '⌄' })] }),
        menu && jsx('div', { ref: listbox, id: menuId, tabIndex: -1, className: 'cb-select-menu', role: 'listbox', 'aria-label': label, 'aria-activedescendant': `${menuId}-option-${active}`, style: menu,
          children: options.map(([id, title], index) => jsx('button', { type: 'button', role: 'option', id: `${menuId}-option-${index}`,
            'aria-selected': id === value, 'data-active': index === active, tabIndex: -1,
            onMouseEnter: () => setActive(index), onClick: () => pick(index), children: title }, id)) }),
      ] });
    }

    function matterMeta(matter) {
      const parts = [];
      if (matter?.stage) parts.push(stageLabel(matter.stage));
      if (matter?.role) parts.push(roleLabel(matter.role, matter.type));
      return parts.join(' · ');
    }
    const kindLabel = (value) => valueLabel('kind', value, '成果类型待确认');
    /** 案件类型（matter.type）：与成果类型共用 kind 映射（诉讼/破产/非诉/其他），但缺失时的提示语不同。 */
    const caseTypeLabel = (value) => valueLabel('kind', value, '案件类型待确认');
    const authorityLabel = (value) => valueLabel('authority', value, '依据类型待确认');
    /** 争点状态：中文自由值原样显示，未知英文值退到"状态待确认"，不外泄英文。 */
    const issueStatusLabel = (value) => valueLabel('issue', value, '状态待确认');
    /** 确信度：`unknown` 与缺失一律显示"未登记"，避免把"未评估"说成"低"。 */
    const confidenceLabel = (value) => (value === 'unknown' ? '未登记' : valueLabel('confidence', value, '未登记'));
    const verificationLabel = (value) => valueLabel('verification', value, '核验状态待确认');
    /** 事实类别。 */
    const factKindLabel = (value) => valueLabel('factKind', value, '类别待确认');
    /** 材料性质：A/B/C 是分级，用"级"表述以免被读成编号。 */
    const materialGradeLabel = (value) => valueLabel('materialGrade', value, '未登记');
    /** 待办状态：中文自由值原样保留。 */
    const pendingStatusLabel = (value) => valueLabel('pending', value, '状态待确认');
    /**
     * 已了结的待办状态（中英混用）。同一判断驱动四件事：未完成计数、加粗显示、
     * 复选框勾选态与筛选分组——口径必须一致，只能有这一个实现。
     */
    const SETTLED_PENDING = new Set(['completed', 'done', 'closed', 'cancelled', '已完成', '已关闭', '已取消']);
    const isSettledPending = (value) => SETTLED_PENDING.has(String(value ?? '').trim().toLowerCase());
    /**
     * 事实核验状态。真实数据里除少量枚举外还有一长串组合编码
     * （如 verified_as_party_statement、verified_with_unresolved_source_and_destination），
     * 逐个硬编码不可持续：已知枚举走词表，其余按前缀给出中文可读形式并附原编码，
     * 既不把英文原样甩给用户，也不隐瞒底层值。
     */
    function factVerificationLabel(value) {
      if (!value?.status) return '核验状态待确认';
      const [prefix, ...limits] = String(value.status).split(';').map((part) => part.trim());
      const legacy = value.form === 'legacy_string' ? '（旧格式）' : '';
      const head = labels.verification[prefix] || (/^verified/.test(prefix) ? `已核验（编码：${prefix}）`
        : /^(unverified|not_verified)/.test(prefix) ? `未核验（编码：${prefix}）` : `状态待确认（编码：${prefix}）`);
      const qualifiers = limits.filter(Boolean).map((part) => part === 'original_not_seen_in_current_read' ? '本次读取未见原件' : part);
      return `核验：${head}${legacy}${qualifiers.length ? `；限定：${qualifiers.join('；')}` : ''}`;
    }
    /**
     * 事实核验状态的筛选分组：把一长串组合编码折成四档，与 factVerificationLabel
     * 同一前缀思路（不逐码硬译）。筛选按分组匹配，不按原编码。
     */
    const FACT_VERIFICATION_GROUPS = [['all', '全部核验状态'], ['verified', '已核验'],
      ['partial', '部分核验'], ['unverified', '未核验/待核验'], ['unknown', '待确认']];
    function factVerificationGroup(status) {
      const prefix = String(status || '').split(';')[0].trim();
      if (!prefix) return 'unknown';
      if (/^partially/.test(prefix)) return 'partial';
      if (/^verified/.test(prefix)) return 'verified';
      if (/^(unverified|not_verified|pending|legacy_unverified|model_inference|conditional_inference)/.test(prefix)) return 'unverified';
      return 'unknown';
    }
    /** 事实筛选：verification 按分组、kind 按原值（缺失归入 'unknown' 档）。 */
    function factMatchesFilter(fact, filter) {
      if (filter.verification && filter.verification !== 'all'
        && factVerificationGroup(fact.verification?.status) !== filter.verification) return false;
      if (filter.kind && filter.kind !== 'all' && (fact.kind || 'unknown') !== filter.kind) return false;
      return true;
    }
    /** 待办筛选：三档（全部/未完成/已完成），判定复用 isSettledPending。 */
    const PENDING_FILTERS = [['all', '全部状态'], ['open', '未完成'], ['done', '已完成']];
    function pendingMatchesFilter(item, filter) {
      if (!filter || filter === 'all') return true;
      return (filter === 'done') === isSettledPending(item.status);
    }
    function errorLabel(error, fallback = '读取失败，请重新读取；如仍失败，请检查工作区配置。') {
      const message = String(error?.message || error || '');
      return message && !/[A-Za-z]/.test(message) ? message : fallback;
    }
    function versionLabel(value) {
      if (!value) return '';
      return String(value).replace(/-beta\./g, ' 测试版 ').replace(/-alpha\./g, '早期测试版 ')
        .replace(/-rc\./g, ' 候选版 ').replace(/[A-Za-z][A-Za-z.-]*/g, '');
    }
    const dateLabel = (value) => String(value || '').replace('T', ' ').replace(/Z$/, ' +00:00');
    function rowKey(tab, item, index) {
      return `${tab}:${tab === 'practice' ? item.id : item.matter_id || item.path || index}`;
    }
    function caption(text) { return jsx('div', { style: { ...NOTE, marginBottom: 4 }, children: text }); }
    function empty(text) { return jsx('div', { style: { ...TINY, padding: `12px ${PAD_X}` }, children: text }); }
    function heading(text) { return jsx('h3', { style: { ...H2, margin: `4px ${PAD_X} 12px` }, children: text }); }
    function labelled(label, value) {
      if (value === null || value === undefined || value === '') return null;
      return jsxs('div', { style: { marginBottom: 12, padding: `0 ${PAD_X}` }, children: [caption(label), jsx('div', { children: String(value) })] });
    }
    function guarded(View) {
      return class Boundary extends Component {
        constructor(props) { super(props); this.state = { error: null }; }
        static getDerivedStateFromError(error) { return { error }; }
        render() {
          return this.state.error ? jsx('div', { style: { padding: 16, ...TINY },
            children: errorLabel(this.state.error, '案件工作台显示失败，请重新读取或刷新页面。') }) : jsx(View, this.props);
        }
      };
    }

    /**
     * Detail：返回与对象标题分行，长案件名在窄栏仍保留完整阅读宽度。
     * 案件详情页不再传 title——案件名与阶段身份都由面板顶部的「当前案件」一行承担，
     * 页面里不再重复一次（用户 2026-10-03：上下两处都写案件名，重复了）。
     */
    function PageHead({ onBack, backLabel, title, extra, children }) {
      return jsxs('div', { className: 'cb-page-head', style: HEAD_STICKY, children: [
        jsxs('div', { className: 'cb-breadcrumb', children: [
          onBack && jsx('button', { type: 'button', style: QUIET_BREADCRUMB, onClick: onBack, children: `← ${backLabel || '返回'}` }),
          extra || null,
        ] }),
        title && jsx('h2', { style: H2, children: title }),
        children && jsx('div', { className: 'cb-context-meta', children }),
      ] });
    }

    /**
     * 可折叠段：段标题用 H3 确立层级，整行可点（hover 出底色）。
     * 吸附只保留在各子页的 PageHead 上，段标题不再各自 sticky——两个 sticky
     * 叠同一个 top 会互相遮挡。
     */
    /**
     * 箭头槽：折叠段与去向行的箭头统一放右缘定宽槽（16px 居中）。
     * 原来箭头用全角空格跟在标题后面（`标题　›`），x 位置随标题长度漂移，
     * 且 › 与 ⌄ 字形宽度不同，展开/收起时箭头左右跳（用户截图指出）。
     */
    function ArrowSlot({ open, children }) {
      return jsx('span', { style: { width: 16, textAlign: 'center', flexShrink: 0,
        color: TEXT_TERTIARY }, children: children || (open ? '⌄' : '›') });
    }

    function Collapsible({ title, open, onToggle, children }) {
      const [hover, hoverEvents] = useHover();
      // 裸行分区，不套灰色卡片：标题行走 Surface Bleed（文字在页面轨 P，底色向外 8px），
      // 展开后的条目与它同轨——层级由字重与箭头表达，不靠卡片底色和缩进。
      return jsxs('section', { className: 'cb-flat', style: FLAT_BLOCK, children: [
        jsxs('button', { type: 'button', 'aria-expanded': open, onClick: onToggle, ...hoverEvents,
          className: 'cb-object-row',
          style: { ...ROW, minHeight: 48, paddingBlock: 0, display: 'flex', width: '100%', ...H3, background: hover ? HOVER : 'transparent' },
          children: [
            jsx('span', { style: { flex: 1, minWidth: 0 }, children: title }),
            jsx(ArrowSlot, { open }),
          ] }),
        // 展开的条目不再额外加内边距：全页只有一套行距（行间 4px），展开前后节距一致。
        open && jsx('div', { children }),
      ] });
    }

    /**
     * 去向行：标题（含计数）在左，› 在右缘箭头槽——与折叠段箭头同一列。
     * 与 Collapsible 段标题同层级：字号统一用 H3 字级（统一设计体系 §4），
     * 只靠字重区分重要性（用户 2026-10-03 截图指出）。
     */
    function NavRow({ onClick, strong, children }) {
      return jsx('div', { className: 'cb-navigation-item', children: jsx(HoverRow, { onClick, kind: 'nav', children: jsxs('span', {
        style: { display: 'flex', alignItems: 'center', width: '100%',
          fontSize: H3_FONT, fontWeight: strong ? 500 : 400 }, children: [
        jsx('span', { style: { flex: 1, minWidth: 0 }, children }),
        jsx(ArrowSlot, {}),
      ] }) }) });
    }

    /** 段正文：左右留白已由行样式统一提供，这里不再重复加，保证与段标题左对齐。 */
    const sectionBody = { padding: 0 };

    /**
     * 成果条目：有 path 的整行单击直接打开文件，不再用独立的「打开」按钮行
     * （按钮独占一行太占空间，且与文字不对齐——用户截图指出）。无 path 保持只读行。
     */
    function ArtifactRow({ title, meta, note, path, onOpen }) {
      // 展开后的文件列表是**条目**，不是节标题：字重 400；只有「最近工作 · 18」这类分区标题才是 500
      //（用户 2026-10-03：最近工作等展开后的文件列表不要用加粗字号）。
      const inner = jsxs('span', { children: [
        jsx('span', { style: { ...H3, fontWeight: 400, display: 'block' }, children: title }),
        meta && jsx('span', { style: { ...MUTED, display: 'block', marginTop: 4 }, children: meta }),
        note && jsx('span', { style: { ...TINY, display: 'block', marginTop: 4 }, children: note }),
      ] });
      if (!path) return jsx('div', { style: { ...ROW, display: 'block', cursor: 'default' }, children: inner });
      return jsx(HoverRow, { onClick: () => onOpen(path), children: inner });
    }

    function MatterDetail({ data, onBack, openFile, onContext, viewScope, initialPage = 'main', onPageChange }) {
      const matter = data.matter || {};
      const procedures = data.proceedings || [];
      // 二级页（已定稿/法条/案例）通过 onPageChange 上报给外层做会话级记忆：
      // 面板被标签切换卸载后重挂载，要停在离开时的那一页（用户 2026-10-03 报告）。
      const [page, setPageState] = useState(initialPage);
      const setPage = (next) => { setPageState(next); onPageChange?.(next); };
      // 折叠默认值：关联案件通常很长（系列案可到十几个），默认收起；
      // 最近工作是常用的落点，默认展开。
      const [openSections, setOpenSections] = useViewState(viewScope, 'sections', { proceedings: false, recent: true });
      /** 最近工作默认只展示 5 条，其余点「查看更多」。 */
      const [showAllRecent, setShowAllRecent] = useViewState(viewScope, 'recent-all', false);
      const toggle = (key) => setOpenSections((current) => ({ ...current, [key]: !current[key] }));
      const sublist = page === 'final' ? data.final_artifacts : page === 'statute'
        ? data.authority_refs.filter((x) => x.type === 'statute')
        : data.authority_refs.filter((x) => x.type === 'case');
      if (page !== 'main') return jsxs('div', { children: [
        jsx(PageHead, { onBack: () => setPage('main'), backLabel: '返回',
          title: page === 'final' ? '已定稿' : page === 'statute' ? '本案法条' : '参考案例' }),
        ...(sublist || []).map((item, index) => jsx(ArtifactRow, {
          title: item.title || item.case_number || item.path || '未命名',
          meta: item.locator || item.proposition || '',
          note: item.verification?.status ? `核验：${verificationLabel(item.verification.status)}` : null,
          path: item.path, onOpen: openFile,
        }, item.artifact_id || item.authority_ref_id || index)),
        !(sublist || []).length && empty('暂无内容'),
      ] });
      const recent = data.recent_artifacts || [];
      const visibleRecent = showAllRecent ? recent : recent.slice(0, 5);
      return jsxs('div', { className: 'cb-matter-main', children: [
        // 标题与阶段身份上移到面板顶部（WorkspaceShell 的「当前案件」一行），这里只留返回。
        jsx(PageHead, { onBack, backLabel: '返回' }),
        procedures.length === 1 && jsxs('section', { className: 'cb-content', style: CONTENT, children: [
          labelled('案件', procedures[0].name), labelled('案号', procedures[0].case_number),
          ...(procedures[0].parties || []).map((party, index) => labelled(roleLabel(party.role, matter.type), party.name)),
        ] }),
        data.next_event && jsxs('section', { className: 'cb-content', style: CONTENT, children: [caption('下次开庭或程序节点'),
          jsx('div', { style: { padding: `0 ${PAD_X}` }, children: dateLabel(data.next_event.at) }),
          data.next_event.location && jsx('div', { style: NOTE, children: data.next_event.location }),
        ] }),
        // 最近工作排在关联案件之前：它是常用落点，系列案的关联案件列表很长。
        // 计数格式与同层级去向行统一为「名称 · 数量」（用户 2026-10-03 截图指出格式不一）。
        jsx(Collapsible, { title: `最近工作 · ${recent.length}`, open: openSections.recent, onToggle: () => toggle('recent'),
          children: jsxs('div', { style: sectionBody, children: [
            ...visibleRecent.map((item, index) => jsx(ArtifactRow, {
              title: item.title || '成果',
              meta: `${kindLabel(item.kind)} · ${String(item.at || '').slice(0, 10)}`,
              path: item.path, onOpen: openFile,
            }, item.artifact_id || index)),
            !recent.length && empty('暂无登记成果'),
            recent.length > 5 && jsx(HoverRow, { onClick: () => setShowAllRecent((current) => !current),
              children: showAllRecent ? '收起' : `查看更多（共 ${recent.length} 项）` }),
          ] }) }),
        procedures.length > 1 && jsx(Collapsible, { title: `关联案件 · ${procedures.length}`,
          open: openSections.proceedings, onToggle: () => toggle('proceedings'),
          children: jsx('div', { style: sectionBody, children: procedures.map((item) => jsxs('div', {
            style: { ...ROW, display: 'block', cursor: 'default' }, children: [
            jsx('span', { style: { display: 'block' }, children: item.name }),
            jsx('span', { style: { ...MUTED, display: 'block', marginTop: 4 },
              children: `${item.case_number || '案号待核'} · ${stageLabel(item.stage)} · ${statusLabel(item.status)}` }),
          ] }, item.proceeding_id)) }) }),
        // 去向分两块（都不套卡片）：案件上下文是"另一个视图"，单独一块；
        // 下面三条是同类子页去向，合为一组，组内以分隔线相连。
        // 各行共用 NavRow（标题在左、› 在右缘箭头槽，与折叠段箭头同一列）。
        onContext && jsxs('section', { className: 'cb-flat cb-navigation', style: FLAT_BLOCK, children: [
          jsx(NavRow, { strong: true, onClick: onContext, children: '案件上下文' }),
        ] }),
        jsxs('section', { className: 'cb-flat cb-navigation', style: FLAT_BLOCK, children: [
          jsx(NavRow, { onClick: () => setPage('final'), children: `已定稿 · ${data.final_artifact_count || 0}` }),
          jsx(NavRow, { onClick: () => setPage('statute'),
            children: `本案法条 · ${(data.authority_refs || []).filter((x) => x.type === 'statute').length}` }),
          jsx(NavRow, { onClick: () => setPage('case'),
            children: `参考案例 · ${(data.authority_refs || []).filter((x) => x.type === 'case').length}` }),
        ] }),
        (data.warnings || []).length > 0 && jsx('div', { style: NOTICE_BOX,
          children: data.warnings.map((warning) => errorLabel(warning, '案件信息存在待核事项，请检查案件登记。')).join('；') }),
      ] });
    }

    function PracticeDetail({ data, onBack, onSource }) {
      const meta = data.metadata || {};
      const [selectedId, setSelectedId] = useState(null);
      const selected = selectedId === null ? null : (data.authorities || []).find((item) => item.id === selectedId) || null;
      if (selected) return jsxs('div', { children: [
        jsx(PageHead, { onBack: () => setSelectedId(null), backLabel: '办案经验',
          title: selected.title || selected.case_number || '关联依据' }),
        labelled('类型', authorityLabel(selected.type)), labelled('案号', selected.case_number),
        labelled('法院', selected.court), labelled('裁判日期', selected.decision_date),
        labelled('条文定位', selected.locator),
        selected.source?.url && /^https?:\/\//.test(selected.source.url) && jsx('div', {
          style: { padding: `0 ${PAD_X}` }, children: jsx('a', {
            href: selected.source.url, target: '_blank', rel: 'noreferrer', children: '查看来源' }) }),
        labelled('历史核验时间', dateLabel(selected.source?.verified_at)),
        jsx('div', { style: NOTICE_BOX, children: '历史依据用于新案件前须重新联网核验。' }),
      ] });
      return jsxs('div', { children: [
        jsx(PageHead, { onBack, backLabel: '办案经验', title: meta.title || '办案经验' }),
        jsx('div', { style: { padding: `0 ${PAD_X}`, marginBottom: 8 }, children: jsx('button', {
          type: 'button', style: BUTTON, onClick: onSource,
          children: `来源：${meta.origin?.matter_name || '待核'}` }) }),
        caption(`关联争点：${(meta.origin?.issue_refs || []).length} 项 · 关联成果：${(meta.origin?.artifact_refs || []).length} 项`),
        jsx('div', { className: 'cb-content', style: CONTENT, children: jsx('div', { className: 'cb-reading-text', style: { whiteSpace: 'pre-wrap' }, children: data.body || '' }) }),
        jsxs('section', { className: 'cb-content', style: CONTENT, children: [
          jsx('div', { style: { ...H3, padding: `0 ${PAD_X} 8px` }, children: '关联依据' }),
          ...(data.authorities || []).map((item) => jsx(HoverRow, { onClick: () => setSelectedId(item.id),
            children: jsxs('span', { children: [
              jsx('span', { style: { display: 'block' }, children: item.title || item.case_number || '关联依据' }),
              jsx('span', { style: { ...MUTED, display: 'block', marginTop: 4 }, children: item.locator || item.court || '' }),
            ] }) }, item.id)),
          // 实测两条真实经验都没有关联依据：原来只剩一个空标题，看不出是"没有"还是"没渲染出来"。
          !(data.authorities || []).length && empty('暂无关联依据')] }),
        jsx('div', { style: NOTICE_BOX,
          children: '历史经验仅用于研究起点，在新案件使用法条或案例前须重新联网核验。' }),
      ] });
    }

    // 案件上下文：事实/争点为只读浏览，待办状态可勾选写回；引用经 inputActions
    // 以纯文本标识插入，完整快照由 Host 在模型准备阶段展开（不使用 setDraft，
    // 避免覆盖用户后来的编辑）。
    const subTabs = [['facts', '事实'], ['issues', '争点'], ['pending', '待办']];
    const REFERENCE_PREFIX = '【案件引用：';

    function quoteText(context, issue) {
      if (!context.matter?.id || !context.matter?.path || !issue.issue_id || !context.state_hash) throw new Error('案件身份或状态不完整，请重新读取。');
      const clean = (text) => String(text).replace(/[·】\n]/g, ' ');
      const payload = encodeURIComponent(JSON.stringify({ matterId: context.matter.id, matterPath: context.matter.path,
        issueId: issue.issue_id, expectedHash: context.state_hash }));
      return `${REFERENCE_PREFIX}${clean(context.matter.name || '案件')} · ${issue.issue_id} · ${clean(issue.title || issue.issue_id)} · v2:${payload}】`;
    }
    /** 每个读取动作绑定会话与代次；旧请求即使晚返回也不得更新面板。 */
    function createRequestGate() {
      let session, generation = 0;
      return {
        session(id) { if (id !== session) { session = id; generation++; } },
        begin() { return { session, generation: ++generation }; },
        current(ticket) { return ticket.session === session && ticket.generation === generation; },
      };
    }
    // 仅保存会话级面板选择指针，不缓存事实、争点或快照。
    const sessionSelections = new Map();
    // 仅保存本次 Client 生命周期内的导航/UI 状态，不写案件文件或浏览器存储。
    const viewStates = new Map();
    function useViewState(scope, field, initial) {
      const key = JSON.stringify([scope, field]);
      const [value, setValue] = useState(() => viewStates.has(key) ? viewStates.get(key) : initial);
      return [value, (next) => setValue((current) => {
        const result = typeof next === 'function' ? next(current) : next;
        viewStates.set(key, result);
        return result;
      })];
    }

    /** 待办状态复选框：面板唯一的写入口。勾选态由 isSettledPending 决定，与加粗、计数同口径。 */
    function PendingCheck({ item, busy, onTogglePending }) {
      const done = isSettledPending(item.status);
      return jsx('input', { type: 'checkbox', checked: done, disabled: Boolean(busy) || !item.item_id,
        'aria-label': done ? `把 ${item.item_id || '该待办'} 标记为未完成` : `把 ${item.item_id || '该待办'} 标记为已完成`,
        title: done ? '标记为未完成' : '标记为已完成',
        onChange: (event) => onTogglePending(item, event.target.checked),
        style: { margin: 0, width: 16, height: 16, boxSizing: 'border-box' } });
    }

    /** 待办行：复选框 + 标题 + 小字元信息；已完成用 500、未完成 400（2.0 只有 400/500 两档）。 */
    function PendingRow({ item, busy, onTogglePending, showIssueRef }) {
      return jsxs('div', { className: 'cb-todo cb-reading-item', children: [
        jsx('label', { className: 'cb-pending-hit', children: jsx(PendingCheck, { item, busy, onTogglePending }) }),
        jsxs('div', { style: { minWidth: 0 }, children: [
          jsx('div', { className: 'cb-todo-title cb-reading-text', style: { fontWeight: isSettledPending(item.status) ? 500 : 400 },
            children: item.title || '内容待核' }),
          jsx('div', { className: 'cb-reading-meta',
            children: `${item.item_id || '编号待补'} · ${pendingStatusLabel(item.status)}${item.due ? ` · 截止 ${item.due}` : ''}${showIssueRef && item.issue_ref ? ` · 关联争点 ${item.issue_ref}` : ''}` }),
          busy === item.item_id && jsx('div', { role: 'status', style: TINY, children: '正在更新…' }),
        ] }),
      ] });
    }

    function IssueDetail({ context, issue, onQuote, quoteNotice, busyPending, onTogglePending }) {
      const facts = (context.facts || []).filter((fact) => (issue.fact_refs || []).includes(fact.fact_id));
      const pending = (context.pending_items || []).filter((item) => item.issue_ref === issue.issue_id);
      return jsxs('div', { className: 'cb-reading-detail', children: [
        // 争点标题按 §19.2 的 15/24/500：它不撑成页面标题，但要比正文高半档。
        jsx('div', { style: { ...H3, fontSize: 15, lineHeight: LH_READING, padding: `0 ${PAD_X}`, marginBottom: 4 }, children: issue.title || '争点标题待确认' }),
        jsx('div', { style: NOTE, children: `${issue.issue_id}${issue.display_id ? ` · 展示编号 ${issue.display_id}` : ''} · 状态：${issueStatusLabel(issue.status)}` }),
        jsx('div', { style: { padding: `8px ${PAD_X}` }, children: [
          // 每个视图只有一个明显主操作：它是 40px，其它动作保持 36px（§12.2）。
          jsx('button', { type: 'button', className: 'cb-primary', style: { ...BUTTON, minHeight: PRIMARY_HEIGHT },
            onClick: () => onQuote(issue), children: '引用到对话' }),
        ] }),
        quoteNotice && jsx('div', { role: 'status', style: { ...NOTE, marginBottom: 8 }, children: quoteNotice }),
        // 立场、反对意见、证据缺口、下一步按用户要求整块删去；有内容时改由「办案备注」承载。
        // 办案备注是独立字段，不与立场混同：实测真实案件的办案记录写在这里，而 current_position 为空。
        issue.note && jsxs('section', { className: 'cb-content', style: CONTENT, children: [
          jsx('div', { style: NOTE, children: '办案备注' }),
          jsx('div', { className: 'cb-reading-text', style: { whiteSpace: 'pre-wrap', padding: `0 ${PAD_X}` }, children: issue.note }),
        ] }),
        jsxs('section', { className: 'cb-content', style: CONTENT, children: [
          jsx('div', { style: NOTE, children: `关联事实 · ${facts.length}` }),
          facts.length ? facts.map((fact) => jsxs('div', { className: 'cb-reading-item', children: [
            jsx('span', { className: 'cb-reading-text', style: { display: 'block' }, children: fact.text || '内容待核' }),
            jsx('span', { className: 'cb-reading-meta', style: { display: 'block' }, title: `原编码：${fact.kind || '—'} / ${fact.material_grade || '—'}`,
              children: `${fact.fact_id || '编号待补'} · ${factKindLabel(fact.kind)} · 材料性质：${materialGradeLabel(fact.material_grade)} · ${factVerificationLabel(fact.verification)}` }),
          ] }, fact.fact_id)) : empty('本案未登记与该争点关联的事实')] }),
        jsxs('section', { className: 'cb-content', style: CONTENT, children: [
          jsx('div', { style: NOTE, children: `关联待办 · ${pending.length}` }),
          pending.length ? pending.map((item) => jsx(PendingRow, { item, busy: busyPending,
            onTogglePending, showIssueRef: false }, item.item_id)) : empty('无关联待办')] }),
      ] });
    }

    /**
     * 案件上下文：单列列表与争点详情。
     * 页头（导航行 + 小标签 + 筛选行）合并为一个吸顶块：
     * 往下滑条目时"当前在看哪一案、哪一类、筛了什么"始终可见；一个吸顶块也避免了
     * 两个 sticky 叠同一个 top 互相遮挡的问题。
     */
    function ContextDetail({ context, sub, onSub, onQuote, onBack, onOpenMatter,
      quoteNotice, busyPending, onTogglePending }) {
      const [selectedId, setSelectedId] = useState(null);
      // 筛选状态是本组件的本地态：组件按 matter.id 挂了 key，切案件自动重置；
      // 切小标签时在 onClick 里显式重置。
      const [factFilter, setFactFilter] = useState({ verification: 'all', kind: 'all' });
      const [pendingFilter, setPendingFilter] = useState('all');
      const [issueQuery, setIssueQuery] = useState('');
      const selected = (context.issues || []).find((issue) => issue.issue_id === selectedId) || null;
      const counts = context.counts || {};
      const allFacts = context.facts || [];
      const allPending = context.pending_items || [];
      const facts = allFacts.filter((fact) => factMatchesFilter(fact, factFilter));
      const pending = allPending.filter((item) => pendingMatchesFilter(item, pendingFilter));
      // 事实类别筛选项只列出本案真实出现的取值，标签复用 factKindLabel。
      const factKinds = [...new Set(allFacts.map((fact) => fact.kind || 'unknown'))];
      const rows = sub === 'facts'
        ? facts.map((fact) => ({ key: fact.fact_id, title: fact.text || '内容待核',
            meta: `${fact.fact_id || '编号待补'} · ${factKindLabel(fact.kind)} · 材料性质：${materialGradeLabel(fact.material_grade)} · ${factVerificationLabel(fact.verification)}` }))
        : sub === 'issues'
          ? (context.issues || []).filter(issue => [issue.title, issue.issue_id].filter(Boolean).join(' ').toLowerCase().includes(issueQuery.trim().toLowerCase())).map((issue) => ({ key: issue.issue_id, title: issue.title || '标题待确认',
              meta: `${issue.issue_id || '身份待确认'} · 状态：${issueStatusLabel(issue.status)} · 关联事实 ${(issue.fact_refs || []).length}`,
              issue }))
          : pending.map((item) => ({ key: item.item_id, item }));
      const totals = { facts: counts.facts || 0, issues: counts.issues || 0, pending: counts.pending_items || 0 };
      // 未完成数在本地按 isSettledPending 重算，而不是用 Core 的 counts.pending_open：
      // 同一个"已了结"判断既要驱动计数、又要驱动加粗与复选框，口径必须一致。
      const unfinished = allPending.filter((item) => !isSettledPending(item.status)).length;
      const filterNote = sub === 'facts' && (factFilter.verification !== 'all' || factFilter.kind !== 'all')
        ? `显示 ${facts.length} / 共 ${allFacts.length} 条`
        : sub === 'pending' && pendingFilter !== 'all' ? `显示 ${pending.length} / 共 ${allPending.length} 条` : '';
      const head = jsxs('div', { style: { ...HEAD_STICKY, marginBottom: 12 }, children: [
        // 两个出口各司其职、且都真实可达：回案件列表 / 打开该案件的详情视图。
        // 文案不能由"有没有详情可回"决定：进入上下文时 detail 必为 null（choose 与 goContext 都清），
        // 那样两个入口会退化成一个——只剩回列表，案件详情再也回不去（已实测到过）。
        // 「重新读取」全面板只有标题行右上角那一个：它在上下文页同样重读上下文（refresh('context')），
        // 这里不再放第二个（用户要求，2026-10-03）。
        jsxs('div', { className: 'cb-breadcrumb', children: [
          jsx('button', { type: 'button', style: QUIET_BREADCRUMB, onClick: onBack, children: '← 案件列表' }),
          onOpenMatter && jsx('button', { type: 'button', style: QUIET_BREADCRUMB, onClick: onOpenMatter, children: '案件详情 ›' }),
          jsx('span', { className: 'cb-filter-note', style: TINY, 'aria-live': 'polite', children: sub === 'issues' && issueQuery.trim() ? `${rows.length}/${(context.issues || []).length}` : filterNote }),
        ] }),
        // 案件名统一由公共 Shell 的「当前案件」承载，子页直接进入业务标签。
        !context.issues?.length && !context.facts?.length && !context.pending_items?.length
          && empty('本案尚未登记事实、争点或待办。'),
        // 小标签行在吸顶块内：往下滑事实/争点/待办时，"当前在看哪一类"始终可见。
        jsxs('div', { style: { display: 'flex', gap: 12, borderBottom: `1px solid ${BORDER}`,
          margin: `4px ${PAD_X} 0` }, children: [
          ...subTabs.map(([id, title]) => jsx('button', { type: 'button', className: 'cb-tab', 'aria-pressed': sub === id,
            style: { ...QUIET, lineHeight: '22px', color: sub === id ? TEXT_PRIMARY : TEXT_TERTIARY,
              fontWeight: sub === id ? 500 : 400,
              borderBottom: sub === id ? `2px solid ${TEXT_PRIMARY}` : '2px solid transparent',
              borderRadius: 0, padding: '6px 0' },
            // 切小标签必须清掉已选争点：否则窄栏下会留在上一条争点的详情里，
            // 出现"标签显示事实、正文却是争点详情"的错位（实测复现）。筛选一并重置。
            onClick: () => { setSelectedId(null); setFactFilter({ verification: 'all', kind: 'all' }); setPendingFilter('all'); setIssueQuery(''); onSub(id); },
            children: id === 'pending' && unfinished !== undefined ? `${title} ${unfinished}/${totals[id]}` : `${title} ${totals[id]}` }, id)),
        ] }),
        // 筛选行：事实按核验状态+类别，待办按状态；与标签行同在吸顶块内，筛选条件始终可见。
        sub === 'facts' && jsxs('div', { className: 'cb-filter', children: [
          jsx(FilterSelect, { label: '按核验状态筛选', value: factFilter.verification, options: FACT_VERIFICATION_GROUPS,
            onChange: value => setFactFilter(current => ({ ...current, verification: value })) }),
          jsx(FilterSelect, { label: '按事实类别筛选', value: factFilter.kind,
            options: [['all', '全部类别'], ...factKinds.map(kind => [kind, kind === 'unknown' ? '类别待确认' : factKindLabel(kind)])],
            onChange: value => setFactFilter(current => ({ ...current, kind: value })) }),
        ] }),
        sub === 'pending' && jsxs('div', { className: 'cb-filter', children: [
          jsx(FilterSelect, { label: '按状态筛选', value: pendingFilter, options: PENDING_FILTERS, onChange: setPendingFilter }),
        ] }),
        sub === 'issues' && jsx('div', { className: 'cb-filter', children:
          jsx('input', { 'aria-label': '搜索争点', placeholder: '搜索争点', value: issueQuery,
            style: { ...INPUT, fontSize: SECONDARY_FONT }, onChange: event => setIssueQuery(event.target.value) }) }),
      ] });
      // 只有争点行可点开详情；事实行是只读浏览；待办行带复选框（写回状态），行本身不展开详情。
      // cb-reading-list 是列表分割线的落点（事实行与待办行之间）；没有这个类名，CSS 规则就没有落脚处。
      const list = jsxs('div', { className: 'cb-reading-list', style: { paddingTop: 0 }, children: [
        rows.map((row) => (row.issue
          ? jsx(HoverRow, { reading: true, selected: selectedId === row.issue.issue_id, onClick: () => setSelectedId(row.issue.issue_id),
            children: jsxs('span', { children: [jsx('strong', { className: 'cb-object-title', children: row.title }),
              jsx('span', { style: { ...MUTED, display: 'block' }, children: row.meta })] }) }, row.key)
          : row.item
            ? jsx(PendingRow, { item: row.item, busy: busyPending, onTogglePending, showIssueRef: true }, row.key)
            : jsx('div', { className: 'cb-reading-item',
              children: [jsx('div', { className: 'cb-reading-text', children: row.title }),
                jsx('div', { className: 'cb-reading-meta', children: row.meta })] }, row.key))),
        !rows.length && empty((sub === 'facts' ? '暂无事实' : sub === 'issues' ? '暂无争点' : '暂无待办')
          + (filterNote ? '（当前筛选条件下）' : '')),
        (context.warnings || []).length > 0 && jsx('div', { style: NOTICE_BOX,
          children: context.warnings.map((warning) => errorLabel(warning, '案件存在待核事项。')).join('；') }),
      ] });
      // 单列详情：保留显式返回列表入口。
      const detail = selected
        ? jsxs('div', { children: [
          jsx('div', { style: { padding: `4px ${PAD_X}` }, children: jsx('button', {
            type: 'button', style: QUIET, onClick: () => setSelectedId(null), children: '← 争点列表' }) }),
          jsx(IssueDetail, { context, issue: selected, onQuote, quoteNotice, busyPending, onTogglePending }),
        ] })
        : empty(sub === 'issues' ? '选择一条争点查看详情与引用入口' : '浏览事实，勾选待办更新状态');
      return jsxs('div', { children: [head, selected ? detail : list] });
    }

    function WorkspaceShell({ tab, onChoose, onRefresh, loading, matter, follow, manual, onReset, onPick, error }) {
      return jsxs('div', { className: 'cb-workspace-shell', style: { paddingTop: 8, paddingBottom: 4 }, children: [
          jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: `0 ${PAD_X}` }, children: [
            jsx('h3', { style: H1, children: '案件工作台' }),
            // 「重新读取」全面板只有这一个（右上角固定）：在上下文页同样重读上下文
            // （refresh('context') → syncFollow），子页内不再放第二个（用户要求，2026-10-03）。
            jsx('button', { type: 'button', style: QUIET, disabled: loading,
              onClick: onRefresh, children: '重新读取' }),
          ] }),
          // 标题→标签行 8px：标签自带6px上内边距，公共区域按新版Compact收紧，且落在 4/8 栅格上。
          jsxs('div', { style: { display: 'flex', gap: 12, borderBottom: `1px solid ${BORDER}`,
            margin: `8px ${PAD_X} 0` }, children: [
            ...[['cases', '案件'], ['practice', '办案经验'], ['context', '案件上下文']].map(([id, title]) => jsx('button', { type: 'button', className: 'cb-tab', 'aria-pressed': tab === id,
              style: { ...QUIET, lineHeight: '22px', color: tab === id ? TEXT_PRIMARY : TEXT_TERTIARY,
                fontWeight: tab === id ? 500 : 400,
                borderBottom: tab === id ? `2px solid ${TEXT_PRIMARY}` : '2px solid transparent',
                // 6px 纵向内边距 + 22px 行高 + 2px 下划线 = 36px（与 QUIET 的 7px 不同，必须显式写）。
                borderRadius: 0, padding: '6px 0' },
              onClick: () => onChoose(id), children: title }, id)),
          ] }),
          // 面板顶部这一行就是案件详情页的标题：案件名 20/28/500（§5.1 子页标题／§5.3 案件名），
          // 下面紧跟它的阶段与身份——原来这两处在详情页里又写了一遍（用户 2026-10-03：重复了）。
          // 切换与恢复跟随是次级操作（13/20），路径与来源是技术信息（12/18）；层级靠字号，不靠灰底。
          jsxs('details', { className: 'cb-context-actions', children: [
            jsxs('summary', { className: 'cb-current-summary', 'aria-label': '当前案件与更多操作', children: [
              jsxs('span', { className: 'cb-current', style: { flex: 1, minWidth: 0 }, children: [
                // 未选择案件时也用**同一套标题格式**：「当前案件：待选择」。
                // 原来这里只有一行裸文本提示：字号继承正文，又占不满 .cb-current 预留的 48px 信息槽
                // （名称 28 + 小字 18 = 46），于是它到下方搜索框之间空出一大截——用户 2026-10-04 截图
                // 指出「选择案件后间距正常，未选择时太远」。标题 + 小字两行铺满同一个信息槽，间距就一致了。
                jsx('span', { className: 'cb-current-line', title: matter?.name || '',
                  children: jsxs('span', { children: [jsx('span', { className: 'cb-current-label', children: '当前案件：' }),
                    jsx('span', { className: 'cb-current-name', children: matter?.name || '待选择' })] }) }),
                // 小字与选中后的「阶段待确认 · 上诉人」同格式同位置（12/18 次级色、紧跟名称下方）。
                matter?.name
                  ? matterMeta(matter) && jsx('span', { className: 'cb-current-meta', children: matterMeta(matter) })
                  : jsx('span', { className: 'cb-current-meta', children: '选择案件后查看详情与上下文' }),
              ] }),
              jsx('span', { className: 'cb-arrow', 'aria-hidden': true,
                style: { width: 16, textAlign: 'center', flexShrink: 0, color: TEXT_TERTIARY } }),
            ] }),
            jsxs('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' }, children: [
              jsx('button', { type: 'button', style: QUIET_SMALL, onClick: () => onChoose('cases'), children: '切换案件' }),
              manual && jsx('button', { type: 'button', style: QUIET_SMALL,
                onClick: onReset, children: '恢复跟随会话' }),
            ] }),
            jsx('div', { className: 'cb-technical', style: NOTE, children: `工作区：${follow.cwd || '未登记'}` }),
            jsx('div', { className: 'cb-technical', style: NOTE, children: `选择来源：${manual ? '手动选择（仅当前会话）' : follow.source === 'reference' ? '最近已发送引用' : '跟随会话工作区'}` }),
          ] }),
          !manual && follow.status === 'ambiguous' && jsxs('div', { style: { marginTop: 8 }, children: [
            caption('会话关联多个案件，请选择本次办理的案件。'),
            ...(follow.candidates || []).map((entry) => jsx('button', {
              type: 'button', style: BUTTON, onClick: () => onPick(entry),
              children: entry.name }, entry.id)),
          ] }),
          error && jsx('div', { role: 'alert', style: NOTICE_BOX, children: error }),
          loading && jsx('div', { role: 'status', style: NOTE, children: '正在读取…' }),
        ] });
    }

    function CaseBenchBody(props) {
      const remote = props.remote;
      const { tab: currentTab } = props.useTabInfo();
      const holder = useRef(null);
      const [tab, setTab] = useState('cases');
      const [query, setQuery] = useState('');
      const [workspace, setWorkspace] = useState(null);
      const [notes, setNotes] = useState(null);
      const [detail, setDetailState] = useState(null);
      function setDetail(value, page = 'main') {
        setDetailState(value);
        persistSelection({ detail: value?.kind === 'matter'
          ? { kind: 'matter', path: value.data.matter.path, page }
          : value?.kind === 'practice' ? { kind: 'practice', id: value.data.metadata.id } : null });
      }
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(false);
      const [matter, setMatter] = useState(null);
      const [context, setContext] = useState(null);
      const [sub, setSub] = useState('issues');
      const [quoteNotice, setQuoteNotice] = useState('');
      /** 正在写回状态的待办编号（空串表示无写入进行中）。 */
      const [busyPending, setBusyPending] = useState('');
      const [follow, setFollow] = useState({ source: 'workspace', status: 'missing', cwd: null });
      const gateRef = useRef(null);
      if (!gateRef.current) gateRef.current = createRequestGate();
      const gate = gateRef.current;
      gate.session(props.sessionId);
      const initialized = useRef(false);
      const tabRef = useRef(tab); tabRef.current = tab;
      const manualRef = useRef(sessionSelections.get(props.sessionId)?.matter || null);
      const modeSession = useRef(props.sessionId);
      if (modeSession.current !== props.sessionId) {
        modeSession.current = props.sessionId; manualRef.current = sessionSelections.get(props.sessionId)?.matter || null;
      }
      const summary = props.useSessions ? props.useSessions((sessions) => sessions.byId[props.sessionId]) : null;
      /** 案件详情的二级页（main/final/statute/case）：跟随 detail 一起做会话级记忆。 */
      const [matterPage, setMatterPage] = useState(sessionSelections.get(props.sessionId)?.detail?.page || 'main');
      /**
       * 会话级面板记忆：除案件指针与标签外，还要记住停在哪个详情页——
       * 面板被侧栏标签切换卸载后重挂载，应停在离开时的页面（用户 2026-10-03 报告：
       * 打开成果文件后回来，详情页与二级页都丢了）。
       * 记忆只是指针（kind + path/id + page），不缓存详情数据本身。
       */
      function persistSelection(patch) {
        sessionSelections.set(props.sessionId, { ...sessionSelections.get(props.sessionId), ...patch });
      }
      function selectTab(value) {
        setTab(value); tabRef.current = value;
        persistSelection({ matter: manualRef.current, tab: value });
      }
      function remember(entry) {
        manualRef.current = entry;
        persistSelection({ matter: entry, tab: tabRef.current });
      }
      function visible(ticket) { return gate.current(ticket); }

      usePaneTheme(holder);
      async function displayMatter(snapshot) {
        const base = snapshot?.matter;
        if (!base || (base.stage && base.role) || !remote.matter) return base;
        const view = unwrap(await remote.matter({ path: base.path, sessionId: props.sessionId }));
        if (view.matter?.path !== base.path || (view.matter.id && base.id && view.matter.id !== base.id)) return base;
        return { ...base, stage: base.stage ?? view.matter.stage, role: base.role ?? view.matter.role, type: base.type ?? view.matter.type };
      }

      async function syncFollow(initial = false, ticket = gate.begin()) {
        setLoading(true); setError('');
        try {
          const manual = manualRef.current;
          const association = unwrap(await remote.followSession({ sessionId: props.sessionId,
            ...(manual ? { matterPath: manual.path, matterId: manual.matter_id } : {}) }));
          if (!visible(ticket)) return;
          // 只读结果深度相同就不落库：远程只读视图是纯 JSON，值没变就没有"新的真相"，
          // 不必重绘（这也是切断"重读→写状态→通知→再重读"回环的第二道保险）。
          setFollow((current) => sameJson(current, association) ? current : association);
          const nextContext = association.context;
          if (!visible(ticket)) return;
          const display = await displayMatter(nextContext);
          if (!visible(ticket)) return;
          const entry = display ? { ...display, matter_id: display.id } : null;
          setMatter((current) => sameJson(current, entry) ? current : entry);
          setContext((current) => sameJson(current, nextContext ?? null) ? current : (nextContext ?? null));
          setQuoteNotice('');
          // 会话关联到了别的案件时，清掉不属于它的详情页；但没有关联（entry 为 null）
          // 不得清——重挂载恢复详情页时 syncFollow 与 openMatter 并发，恢复完成的详情
          // 不能被晚到的"无关联"结果清掉（2026-10-03 恢复功能引入）。
          if (entry && detail?.kind === 'matter' && detail.data.matter.path !== entry.path) setDetail(null);
          if (initial) {
            const saved = sessionSelections.get(props.sessionId);
            const hasContent = nextContext && Object.values(nextContext.counts || {}).some((value) => value > 0);
            selectTab(saved?.tab || (hasContent ? 'context' : 'cases'));
          }
          if (association.status === 'ambiguous' && !manual) setError('当前会话关联多个案件，请选择一个案件。');
        } catch (failure) { if (visible(ticket)) { setContext(null); setMatter(null); setError(errorLabel(failure)); } }
        finally { if (visible(ticket)) setLoading(false); }
      }
      async function refresh(which = tab) {
        if (which === 'context') return syncFollow();
        const ticket = gate.begin();
        setLoading(true); setError('');
        try {
          const result = unwrap(await (which === 'cases' ? remote.workspace() : remote.practiceList()));
          if (!visible(ticket)) return;
          if (which === 'cases') setWorkspace(result); else setNotes(result);
        } catch (failure) { if (visible(ticket)) setError(errorLabel(failure)); }
        finally { if (visible(ticket)) setLoading(false); }
      }
      useEffect(() => {
        initialized.current = false;
        setDetailState(null); setMatter(null); setContext(null); setError('');
        const saved = sessionSelections.get(props.sessionId);
        manualRef.current = saved?.matter || null;
        setMatterPage(saved?.detail?.kind === 'matter' ? saved.detail.page || 'main' : 'main');
        // 工作区列表只在打开/切换会话时读取；焦点和回合结束只读当前关联。
        let active = true;
        void remote.workspace().then((value) => { if (active) setWorkspace(unwrap(value)); })
          .catch((error) => { if (active) setError(errorLabel(error)); });
        // 按顺序跟随、恢复，避免两个 gate.begin() 互相废弃请求。
        // 用户在恢复期间主动导航，或会话切换后，旧存档不得再覆盖新页面。
        const ticket = gate.begin();
        void (async () => {
          try {
            await syncFollow(true, ticket);
            if (!active || !visible(ticket)) return;
            const savedDetail = saved?.detail;
            if (savedDetail?.kind === 'matter' && savedDetail.path) await openMatter({ path: savedDetail.path, page: savedDetail.page });
            else if (savedDetail?.kind === 'practice' && savedDetail.id) await openNote({ id: savedDetail.id });
          } finally { if (active) initialized.current = true; }
        })();
        return () => { active = false; gate.begin(); };
      }, [remote, props.sessionId]);
      /**
       * 回合结束后只读当前关联。依赖必须是**原始值**：`summary` 是 sessions store 里的对象，
       * 宿主在会话状态变化时会给出新引用，若直接依赖它，就会出现
       * 「重读关联 → 宿主写会话状态 → summary 换引用 → 再重读」的空转回环——
       * 空闲时也会每 250ms 重绘一次（实测症状：面板持续闪烁）。
       * 这里只关心"回合是否结束"，所以只依赖 running 这个布尔值。
       */
      useEffect(() => {
        if (!initialized.current || summary?.running) return;
        const timer = setTimeout(() => void syncFollow(), 250);
        return () => clearTimeout(timer);
      }, [summary?.running]);
      useEffect(() => {
        const focus = () => { if (initialized.current) void syncFollow(); };
        window.addEventListener?.('focus', focus);
        return () => window.removeEventListener?.('focus', focus);
      }, [remote, props.sessionId, matter?.path]);
      async function openMatter(entry, ticket = gate.begin()) {
        setLoading(true); setError('');
        try {
          const data = unwrap(await remote.matter({ path: entry.path, sessionId: props.sessionId }));
          if (visible(ticket)) { setMatter({ ...data.matter, matter_id: data.matter.id }); setMatterPage(entry.page || 'main'); setDetail({ kind: 'matter', data }, entry.page || 'main'); }
        } catch (failure) { if (visible(ticket)) setError(errorLabel(failure)); }
        finally { if (visible(ticket)) setLoading(false); }
      }
      async function openNote(entry) {
        const ticket = gate.begin(); setLoading(true); setError('');
        try {
          const data = unwrap(await remote.practiceShow({ id: entry.id }));
          if (visible(ticket)) setDetail({ kind: 'practice', data });
        } catch (failure) { if (visible(ticket)) setError(errorLabel(failure)); }
        finally { if (visible(ticket)) setLoading(false); }
      }
      function openFile(path) {
        try {
          if (!detail || detail.kind !== 'matter') throw new Error('请先选择案件。');
          const root = detail.data.matter.path;
          if (typeof path !== 'string' || path.split('/').includes('..')) throw new Error('成果文件路径无效。');
          if (path.startsWith('/') && !path.startsWith(`${root}/`)) throw new Error('成果文件路径越过案件目录。');
          const absolute = path.startsWith('/') ? path : `${root}/${path}`;
          currentTab.actions.openResource(fileAddress(props.sessionId, absolute));
        } catch (failure) { setError(errorLabel(failure, '文件打开失败，请刷新页面后重试。')); }
      }
      function openSource() {
        const sourceId = detail?.data?.metadata?.origin?.matter_id;
        const entry = workspace?.matters?.find((item) => item.matter_id === sourceId && item.status === 'ok');
        if (entry) { selectTab('cases'); void chooseMatter(entry); }
        else setError('来源案件当前未在工作区列表中找到。');
      }
      /** 把指定案件读成当前案件上下文（面板的案件指针只影响面板，不动 Agent 工作区）。 */
      async function loadContext(entry, ticket = gate.begin()) {
        setMatter(entry); setContext(null); setQuoteNotice('');
        setLoading(true); setError('');
        try {
          const data = unwrap(await remote.context({ sessionId: props.sessionId, matterPath: entry.path, matterId: entry.matter_id }));
          const display = await displayMatter(data);
          if (visible(ticket)) { setContext(data); setMatter({ ...display, matter_id: display.id }); }
        } catch (failure) { if (visible(ticket)) setError(errorLabel(failure)); }
        finally { if (visible(ticket)) setLoading(false); }
      }
      async function goContext(entry = matter) {
        setSub('issues'); selectTab('context'); setError(''); setQuoteNotice(''); setDetail(null);
        if (entry) await loadContext(entry);
        else await syncFollow();
      }
      function choose(value) {
        // 切标签即清掉上一个标签留下的提示：否则"请先选择案件"会一直挂在案件列表上方。
        gate.begin();
        setError(''); setDetail(null); setQuery(''); setQuoteNotice('');
        tabRef.current = value;
        sessionSelections.set(props.sessionId, { matter: manualRef.current, tab: value });
        if (value === 'context') { void goContext(); return; }
        selectTab(value);
        if (value === 'practice' && notes === null) void refresh('practice');
      }
      /**
       * 在上下文页里打开该案件的详情视图（渲染 MatterDetail）。
       * 详情由 detail 状态承载，它自己的「← 返回」把 detail 清空即回到上下文，
       * 于是"回案件列表"和"看案件详情"两个目的地都真实可达。
       */
      async function openContextMatter() {
        const path = context?.matter?.path || matter?.path;
        if (!path) { setError('未找到该案件的目录，无法打开详情。'); return; }
        await openMatter({ path });
      }
      /**
       * 选择案件：保持「案件」标签原有的案件详情，不自动切标签。
       * 顺带把案件上下文读好放在后台，用户切到「案件上下文」时即可直接用；
       * 只写面板的案件指针，不改变 Agent 的工作区或 Profile。
       */
      async function chooseMatter(entry) {
        const ticket = gate.begin(); remember(entry);
        setMatter(entry); setContext(null); setDetail(null); setQuoteNotice('');
        setMatterPage('main');
        await Promise.all([openMatter(entry, ticket), loadContext(entry, ticket)]);
      }
      /** 插入前重新核对身份与语义哈希；异步期间的草稿与会话变更同样受守卫。 */
      async function quoteIssue(issue) {
        setQuoteNotice('');
        const ticket = gate.begin();
        try {
          const actions = props.inputActions;
          if (!actions || typeof actions.insertText !== 'function' || typeof actions.captureInsertion !== 'function') {
            throw new Error('当前会话的输入框不可用，请先在会话中聚焦输入框后重试。');
          }
          if (!context) throw new Error('请先读取案件上下文。');
          const span = actions.captureInsertion();
          const snapshot = unwrap(await remote.quoteIssue({ sessionId: props.sessionId, matterPath: context.matter.path,
            matterId: context.matter.id, issueId: issue.issue_id, expectedHash: context.state_hash }));
          if (!visible(ticket)) return;
          const applied = actions.insertText(`${quoteText(snapshot, snapshot.issue)}\n`, span);
          if (!applied) throw new Error('输入框内容已改变或正在发送，未插入引用；请重试。');
          setQuoteNotice('已插入引用标识；补上你的要求后再发送。');
        } catch (failure) { if (visible(ticket)) setError(errorLabel(failure, '引用插入失败，请重试。')); }
      }
      /**
       * 待办状态写回：面板唯一的写动作。写完后重读上下文（计数、加粗、筛选一并刷新）；
       * 失败同样重读，让勾选态回到真实状态，再显示原因。
       */
      async function togglePending(item, done) {
        if (!context?.matter?.path || !item.item_id) { setError('待办编号缺失，无法写回状态。'); return; }
        setBusyPending(item.item_id); setError('');
        const ticket = gate.begin();
        try {
          unwrap(await remote.setPendingStatus({ sessionId: props.sessionId,
            matterPath: context.matter.path, itemId: item.item_id, status: done ? 'completed' : 'open' }));
          if (!visible(ticket)) return;
        } catch (failure) {
          if (visible(ticket)) setError(errorLabel(failure, '待办状态写回失败，请重试。'));
        } finally {
          if (visible(ticket)) { setBusyPending(''); await syncFollow(); }
        }
      }
      // 上下文拥有自己的对象列表。
      const listTab = tab === 'practice' ? 'practice' : 'cases';
      const items = listTab === 'cases' ? workspace?.matters || [] : notes?.notes || [];
      const filtered = items.filter((item) => [item.name, item.title, item.matter_name, item.search_text]
        .filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()));
      // 公共 Shell 底部 8px 接搜索；Search → 首行 12px（8px + 行外边距4px），水平轨不变。
      const list = jsxs('div', { className: 'cb-list', children: [
        jsx('input', { id: `cb-search-${props.sessionId}`, 'aria-label': listTab === 'cases' ? '搜索案件' : '搜索办案经验',
          placeholder: listTab === 'cases' ? '搜索案件' : '搜索办案经验', value: query,
          onChange: (event) => setQuery(event.target.value),
          style: { ...INPUT, marginBottom: 8 } }),
        filtered.map((item, index) => jsx(HoverRow, {
          disabled: item.status === 'error', kind: listTab === 'cases' ? 'case' : 'practice',
          selected: listTab === 'cases' && (matter?.path === item.path || detail?.data?.matter?.path === item.path),
          onClick: () => listTab === 'cases' ? chooseMatter(item) : openNote(item),
          children: jsxs('span', { children: [jsx('strong', { children: item.name || item.title }),
            // 案件列表的小字统一为两段：**案件类型 · 我方立场**（用户 2026-10-04）。
            // 不再逐案显示关联案件数／阶段／开庭日，也不显示最近成果——同一次扫描里每一行的这两个词
            // 含义完全一致，读者不必逐行判断这是什么信息。类型取 matter.type（诉讼/破产/非诉），
            // 立场取 engagement.role（原告/上诉人/管理人/债务人…），缺失时各自给中文提示，不留空段。
            // 读取失败的行改显示故障原因（那不是状态描述，去掉只剩一个点不动的死行）。
            listTab === 'cases'
              ? jsx('span', { style: { ...MUTED, display: 'block' },
                  children: item.status === 'error'
                    ? `状态异常：${errorLabel(item.error)}`
                    : `${caseTypeLabel(item.type)} · ${roleLabel(item.role, item.type)}` })
              : jsxs('span', { children: [
                  jsx('span', { style: { ...MUTED, display: 'block' }, children: `来源：${item.matter_name || '待核'}` }),
                  item.recent_artifact && jsx('span', { style: { ...MUTED, display: 'block' },
                    children: `最近：${item.recent_artifact.title || '成果'}` }),
                ] }),
          ] }),
        }, rowKey(listTab, item, index))),
        !filtered.length && empty(query ? '没有匹配结果' : '暂无内容'),
      ] }, listTab);
      /**
       * 上下文页的两个出口各司其职，文案与目标一致，且都不依赖"有没有详情可回"：
       *  入口一「← 案件列表」恒可用；入口二「案件详情 ›」由 ContextDetail 打开该案件的详情。
       * 旧的写法用 hasMatterDetail 决定文案与第二个入口是否存在——进入上下文时 detail 必为 null，
       * 于是恒显示「← 案件列表」、第二个入口恒不渲染，案件详情再也回不去（已实测复现）。
       */
      const backFromContext = () => choose('cases');
      const detailNode = detail?.kind === 'matter' ? jsx(MatterDetail, { data: detail.data, onBack: () => setDetail(null), openFile,
        // 二级页随 detail 一起做会话级记忆：面板重挂载时停在离开时的那一页。
        viewScope: `${props.sessionId}:${detail.data.matter.path}`,
        initialPage: matterPage, onPageChange: (page) => {
          setMatterPage(page);
          persistSelection({ detail: { kind: 'matter', path: detail.data.matter.path, page } });
        },
        // 案件详情里的上下文入口：以该案件为当前案件读上下文。
        onContext: () => { const entry = { path: detail.data.matter.path, matter_id: detail.data.matter.id }; remember(entry); void goContext(entry); } }, detail.data.matter.id)
        : detail?.kind === 'practice' ? jsx(PracticeDetail, { data: detail.data, onBack: () => setDetail(null), onSource: openSource }, detail.data.metadata.id)
          : tab === 'context' && context
            ? jsx(ContextDetail, { context, sub, onSub: setSub, onQuote: quoteIssue,
              // 上下文里也能打开案件详情：detail 一经设置，上面第一个分支即渲染 MatterDetail，
              // 它自己的「← 返回」清空 detail 就回到上下文。
              onBack: backFromContext, onOpenMatter: matter ? openContextMatter : null,
              quoteNotice, busyPending, onTogglePending: togglePending }, context.matter?.id || 'context')
            : null;
      const contextHint = tab === 'context' && !context
        ? empty(loading ? '正在读取案件上下文…' : follow.status === 'ambiguous' ? '会话关联多个案件，请选择。' : '当前会话未解析到案件，请先在「案件」中选择。')
        : null;
      // 上下文直接显示当前案件视图。
      const rightPane = detailNode || contextHint;
      return jsxs('div', { ref: holder, className: 'cb-panel cb-workspace', 'aria-busy': loading,
        style: { ...PANEL_STYLE, flex: '1 1 auto', minHeight: 0, height: '100%', overflow: 'hidden' }, children: [
        jsx(PanelStyles, {}),
        WorkspaceShell({ tab, onChoose: choose, onRefresh: () => refresh(tab === 'context' ? 'context' : listTab),
          loading, matter: detail?.kind === 'matter' ? detail.data.matter : tab === 'context' ? matter || context?.matter : matter,
          follow, manual: manualRef.current, error,
          onReset: () => { remember(null); setDetail(null); void syncFollow(true); },
          onPick: (entry) => { const selected = { path: entry.path, matter_id: entry.id }; remember(selected); void goContext(selected); } }),
        jsx('div', { className: 'cb-scroll-body', children: tab === 'context' ? rightPane : detailNode || list }),
      ] });
    }

    function SettingsSection({ remote }) {
      const holder = useRef(null);
      usePaneTheme(holder);
      const [status, setStatus] = useState(null);
      const [count, setCount] = useState(null);
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(true);
      async function refresh() {
        setError(''); setLoading(true);
        try {
          const [settings, workspace] = await Promise.all([remote.status(), remote.workspace()]);
          setStatus(unwrap(settings)); setCount(unwrap(workspace).matter_count);
        } catch (failure) { setError(errorLabel(failure)); } finally { setLoading(false); }
      }
      useEffect(() => { void refresh(); }, [remote]);
      return jsxs('div', { ref: holder, className: 'cb-panel', style: { ...PANEL_STYLE, paddingTop: 16 }, children: [
        jsx(PanelStyles, {}), heading('案件工作台'),
        loading && jsx('div', { role: 'status', style: NOTE, children: '正在读取设置…' }),
        jsxs('section', { className: 'cb-content', style: CONTENT, children: [
          labelled('工作区路径', status?.root), jsx('div', { style: DIVIDER }),
          labelled('核心版本', versionLabel(status?.coreVersion)), jsx('div', { style: DIVIDER }),
          labelled('已发现案件', count),
        ] }),
        jsx('div', { style: { ...NOTE, marginBottom: 8 }, children: '工作区路径可在当前配置方案的案件工作台插件配置中修改。' }),
        jsx('button', { type: 'button', style: QUIET, disabled: loading, onClick: refresh, children: '重新读取' }),
        error && jsx('div', { role: 'alert', style: NOTICE_BOX, children: error }),
      ] });
    }

    exports.apply = async function apply(ctx) {
      ctx.effect(async () => {
        const dispose = await ctx.remote.$mount(TYPERT_REMOTE);
        return () => dispose();
      }, 'casebench: mount Remote');
      ctx.inject(['remote.casebench'], (scoped) => {
        ctx.effect(() => ctx.sidebarRightTabs.register({ id: ID, kind: KIND,
          title: () => '案件工作台',
          guide: [{ order: 45, title: () => '案件工作台', description: () => '浏览案件与办案经验' }],
        }), 'casebench: tab type');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: ID, inject: () => ({ remote: scoped.remote.casebench }),
        }, guarded(CaseBenchBody))), 'casebench: tab body');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title', key: ID,
        }, () => jsx('span', { children: '案件工作台' }))), 'casebench: tab title');
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'casebench', order: 45, label: '案件工作台',
          inject: () => ({ remote: scoped.remote.casebench }),
        }, guarded(SettingsSection))), 'casebench: settings');
      });
    };
    /**
     * 选择案件后应当停留在哪个标签。**保持「案件」**：案件详情（关联案件、最近工作、
     * 已定稿/法条/案例入口）原本就挂在案件列表的点击上，自动切到「案件上下文」会把它整个吃掉。
     * 只读上下文在后台读好即可。抽成纯函数是为了让测试能钉住这条不变量。
     */
    function matterSelectionTab() {
      return 'cases';
    }

    exports.INVOCATIONS = INVOCATIONS;
    exports.uiHelpers = { fileAddress, stageLabel, roleLabel, statusLabel, kindLabel, authorityLabel, caseTypeLabel,
      verificationLabel, errorLabel, versionLabel, dateLabel, rowKey, matterSelectionTab,
      quoteText, createRequestGate, CaseBenchBody, MatterDetail, ContextDetail, factVerificationLabel, issueStatusLabel, confidenceLabel, factKindLabel, materialGradeLabel, pendingStatusLabel, subTabs,
      PracticeDetail, SettingsSection, HoverRow, PendingRow, FilterSelect, WorkspaceShell, PanelStyles, PANEL_STYLE, INPUT, SELECT, CONTENT, pageGutter,
      factVerificationGroup, factMatchesFilter, pendingMatchesFilter, isSettledPending,
      FACT_VERIFICATION_GROUPS, PENDING_FILTERS,
      outerTabs: [['cases', '案件'], ['practice', '办案经验'], ['context', '案件上下文']] };
    return module.exports;
  },
});

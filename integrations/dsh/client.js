// CaseBench 右侧栏：读取 Core Read Model；唯一的写通道是待办状态写回（pending.py）。
//
// 视觉遵循已冻结的《面板设计规范 v1.0》（dsh-bankruptcy-teamwork/docs/面板设计规范.md，
// CaseBench 侧差异见本仓库 docs/casebench-面板设计规范.md）：
// 五级字级、PAD_X/BOX_PAD_X 两条留白基准线、0.5px 边框、QUIET/BUTTON 分工、
// 吸顶页头用实测面板底色 + box-shadow 上延，禁止负 margin。
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

    // ── 样式：只用有出处的 DSH 主题变量（冻结规范 §一/§二）──────────────────

    // 字级：全部从两个有出处的产品字号派生（calc 跟随用户字号设置缩放）。
    const FONT = 'var(--dsh-content-font-size-secondary, 13px)';
    const NOTE_FONT = 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)';
    const H3_FONT = 'var(--dsh-content-font-size, 14px)';
    const H2_FONT = 'calc(var(--dsh-content-font-size, 14px) + 2px)';
    const H1_FONT = 'calc(var(--dsh-content-font-size, 14px) + 4px)';
    const TEXT_PRIMARY = 'var(--dsw-alias-label-primary, #17191c)';
    const TEXT_SECONDARY = 'var(--dsw-alias-label-secondary, #666b70)';
    const TEXT_TERTIARY = 'var(--dsw-alias-label-tertiary, #8a8f94)';
    const BORDER = 'var(--dsw-alias-border-l3, #0000001f)';
    const HOVER = 'var(--dsw-alias-interactive-bg-hover, #2631480f)';
    // 吸顶页头背景：面板底色没有公开变量，挂载时从 DOM 实测写进 --cb-pane-bg
    // （bg-overlay 是浮层色，只作实测完成前的兜底；同破产面板 --bt-pane-bg 手法）。
    const PANE_BG = 'var(--cb-pane-bg, var(--dsw-alias-bg-overlay, #fff))';

    const H1 = { fontSize: H1_FONT, fontWeight: 600, color: TEXT_PRIMARY, margin: 0 };
    const H2 = { fontSize: H2_FONT, fontWeight: 600, color: TEXT_PRIMARY, margin: 0 };
    const H3 = { fontSize: H3_FONT, fontWeight: 600, color: TEXT_PRIMARY, margin: 0 };
    const MUTED = { color: TEXT_SECONDARY, fontSize: FONT };
    const TINY = { color: TEXT_TERTIARY, fontSize: NOTE_FONT };

    /**
     * 留白两条基准线（冻结规范 §三，禁止第三种水平数字）：
     * ① 框外文字行（标题/备注/正文/清单行）→ 水平内边距 PAD_X；
     *    根容器留白 6px + 4px → 左边统一落在 10px。
     * ② 带边框组件（BOX/NOTICE_BOX）→ 水平内边距 BOX_PAD_X；框内行水平为 0。
     * QUIET 水平内边距 0（文字标签落容器基准线）；BUTTON/INPUT 的内边距是热区。
     */
    const PAD_X = '4px';
    const BOX_PAD_X = '8px';

    /**
     * 行样式。⚠ 不能无条件 `width: 100%`——会把页头标题挤成一字一行竖排；
     * 列表行需要整宽时用 `display: 'block'` 显式要。
     */
    const ROW = {
      display: 'flex', alignItems: 'center', gap: '6px', boxSizing: 'border-box',
      maxWidth: '100%', padding: `5px ${PAD_X}`, borderRadius: '10px',
      border: 'none', background: 'transparent', color: TEXT_PRIMARY,
      font: 'inherit', fontSize: FONT, textAlign: 'left', cursor: 'pointer',
    };
    /** BUTTON：真正的动作才用（规范 §四）。 */
    const BUTTON = { ...ROW, width: 'auto', border: `0.5px solid ${BORDER}`, padding: '4px 10px' };
    /** QUIET：返回/刷新类功能性标签——无边框、三级文字色、水平 padding 0。 */
    const QUIET = {
      border: 'none', background: 'transparent', color: TEXT_TERTIARY,
      font: 'inherit', fontSize: FONT, padding: '3px 0', borderRadius: '6px',
      cursor: 'pointer', textAlign: 'left',
    };
    const INPUT = {
      width: '100%', boxSizing: 'border-box', border: `0.5px solid ${BORDER}`,
      borderRadius: '8px', padding: '5px 10px', background: 'transparent',
      color: TEXT_PRIMARY, font: 'inherit', fontSize: FONT,
    };
    /** 筛选下拉：控件规格同 INPUT，但宽度随内容（不是通栏输入框）。 */
    const SELECT = { ...INPUT, width: 'auto' };
    /** 备注框：来源提示、警告这类备注性内容单独成框。 */
    const NOTICE_BOX = { ...TINY, padding: `6px ${BOX_PAD_X}`, margin: '4px 0 8px',
      borderRadius: '10px', border: `0.5px solid ${BORDER}` };
    /** 备注行：通栏纯文字行，水平内边距 PAD_X。 */
    const NOTE = { ...TINY, padding: `2px ${PAD_X}` };
    const DIVIDER = { height: '0.5px', background: BORDER, margin: '6px 0' };

    /**
     * 吸顶页头：sticky top 0 + 实测面板底色；同色 box-shadow 向上延伸盖住容器顶部
     * 透明条（只画背景、不影响布局与吸附位置）。禁止负 margin——sticky 吸附按
     * margin 边判定，负边距会让元素提前停住、头顶漏出透明窗（破产面板实测坑）。
     */
    const HEAD_STICKY = { position: 'sticky', top: 0, zIndex: 2, background: PANE_BG,
      boxShadow: `0 -10px 0 0 ${PANE_BG}` };

    /** hover 用内联 style 表达不了，靠 onMouseEnter/Leave 落两个态。 */
    function useHover() {
      const [hover, setHover] = useState(false);
      return [hover, { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }];
    }

    /** 可交互清单行：整宽 block，hover 出底色。 */
    function HoverRow({ onClick, disabled, children, strong }) {
      const [hover, hoverEvents] = useHover();
      return jsx('button', { type: 'button', onClick, disabled, ...hoverEvents,
        style: { ...ROW, display: 'block', width: '100%', fontWeight: strong ? 600 : 400,
          background: hover && !disabled ? HOVER : 'transparent', opacity: disabled ? 0.5 : 1 },
        children });
    }

    function unwrap(response) {
      if (response && response.ok === true) return response.value;
      if (response && response.ok === false) throw new Error(errorLabel(response.error?.message));
      if (response && typeof response === 'object') return response;
      throw new Error('未返回结果');
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
    const kindLabel = (value) => valueLabel('kind', value, '成果类型待确认');
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
      if (!value) return null;
      return jsxs('div', { style: { marginBottom: 9, padding: `0 ${PAD_X}` }, children: [caption(label), jsx('div', { children: String(value) })] });
    }
    function guarded(View) {
      return class Boundary extends Component {
        constructor(props) { super(props); this.state = { error: null }; }
        static getDerivedStateFromError(error) { return { error }; }
        render() {
          return this.state.error ? jsx('div', { style: { padding: 14, ...TINY },
            children: errorLabel(this.state.error, '案件工作台显示失败，请重新读取或刷新页面。') }) : jsx(View, this.props);
        }
      };
    }

    /**
     * 子页吸顶页头：QUIET 返回（左）+ H2 标题 + 可选右侧动作。整页下滑时页头吸附在
     * 滚动区顶端；底色用实测面板底色 + 同色 box-shadow 上延遮滚动穿透，禁止负 margin。
     */
    function PageHead({ onBack, backLabel, title, extra, children }) {
      return jsxs('div', { style: { ...HEAD_STICKY, paddingBottom: 6 }, children: [
        jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: `2px ${PAD_X} 4px` }, children: [
          onBack && jsx('button', { type: 'button', style: QUIET, onClick: onBack, children: `← ${backLabel || '返回'}` }),
          jsx('span', { style: { flex: 1, minWidth: 0, ...H2 }, children: title }),
          extra || null,
        ] }),
        children || null,
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
      return jsxs('div', { children: [
        jsxs('button', { type: 'button', 'aria-expanded': open, onClick: onToggle, ...hoverEvents,
          style: { ...ROW, display: 'flex', width: '100%', ...H3, background: hover ? HOVER : 'transparent' },
          children: [
            jsx('span', { style: { flex: 1, minWidth: 0 }, children: title }),
            jsx(ArrowSlot, { open }),
          ] }),
        open && jsx('div', { children }),
      ] });
    }

    /**
     * 去向行：标题（含计数）在左，› 在右缘箭头槽——与折叠段箭头同一列。
     * 与 Collapsible 段标题同层级：字号统一用 H3 字级（冻结规范 §一），
     * 只靠字重区分重要性（用户 2026-10-03 截图指出）。
     */
    function NavRow({ onClick, strong, children }) {
      return jsx(HoverRow, { onClick, children: jsxs('span', {
        style: { display: 'flex', alignItems: 'center', width: '100%',
          fontSize: H3_FONT, fontWeight: strong ? 600 : 400 }, children: [
        jsx('span', { style: { flex: 1, minWidth: 0 }, children }),
        jsx(ArrowSlot, {}),
      ] }) });
    }

    /** 段正文：左右留白已由行样式统一提供，这里不再重复加，保证与段标题左对齐。 */
    const sectionBody = { padding: 0 };

    /**
     * 成果条目：有 path 的整行单击直接打开文件，不再用独立的「打开」按钮行
     * （按钮独占一行太占空间，且与文字不对齐——用户截图指出）。无 path 保持只读行。
     */
    function ArtifactRow({ title, meta, note, path, onOpen }) {
      const inner = jsxs('span', { children: [
        jsx('span', { style: { display: 'block' }, children: title }),
        meta && jsx('span', { style: { ...MUTED, display: 'block', marginTop: 2 }, children: meta }),
        note && jsx('span', { style: { ...TINY, display: 'block', marginTop: 2 }, children: note }),
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
          meta: item.locator || item.proposition || item.path || '',
          note: item.verification?.status ? `核验：${verificationLabel(item.verification.status)}` : null,
          path: item.path, onOpen: openFile,
        }, item.artifact_id || item.authority_ref_id || index)),
        !(sublist || []).length && empty('暂无内容'),
      ] });
      const recent = data.recent_artifacts || [];
      const visibleRecent = showAllRecent ? recent : recent.slice(0, 5);
      return jsxs('div', { children: [
        jsxs(PageHead, { onBack, backLabel: '返回', title: matter.name || '案件', children: [
          jsx('div', { style: NOTE, children: `${stageLabel(matter.stage)} · ${roleLabel(matter.role, matter.type)}` }),
        ] }),
        procedures.length === 1 && jsxs('section', { style: { padding: '12px 0', borderTop: `0.5px solid ${BORDER}` }, children: [
          labelled('案件', procedures[0].name), labelled('案号', procedures[0].case_number),
          ...(procedures[0].parties || []).map((party, index) => labelled(roleLabel(party.role, matter.type), party.name)),
        ] }),
        data.next_event && jsxs('section', { style: { padding: '12px 0', borderTop: `0.5px solid ${BORDER}` }, children: [caption('下次开庭或程序节点'),
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
            jsx('span', { style: { ...MUTED, display: 'block', marginTop: 2 },
              children: `${item.case_number || '案号待核'} · ${stageLabel(item.stage)} · ${statusLabel(item.status)}` }),
          ] }, item.proceeding_id)) }) }),
        // 去向组：四条共用 NavRow（标题在左、› 在右缘箭头槽，与折叠段箭头同一列）。
        jsxs('section', { children: [
          onContext && jsx(NavRow, { strong: true, onClick: onContext, children: '案件上下文' }),
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
      const selected = (context.issues || []).find((issue) => issue.issue_id === selectedId) || null;
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
        jsx('div', { style: { padding: `0 ${PAD_X}`, marginBottom: 6 }, children: jsx('button', {
          type: 'button', style: BUTTON, onClick: onSource,
          children: `来源：${meta.origin?.matter_name || '待核'}` }) }),
        caption(`关联争点：${(meta.origin?.issue_refs || []).length} 项 · 关联成果：${(meta.origin?.artifact_refs || []).length} 项`),
        jsx('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.75, padding: `8px ${PAD_X}` }, children: data.body || '' }),
        jsxs('section', { style: { padding: '12px 0', borderTop: `0.5px solid ${BORDER}` }, children: [
          jsx('div', { style: { ...H3, padding: `0 ${PAD_X} 6px` }, children: '关联依据' }),
          ...(data.authorities || []).map((item) => jsx(HoverRow, { onClick: () => setSelected(item),
            children: jsxs('span', { children: [
              jsx('span', { style: { display: 'block' }, children: item.title || item.case_number || '关联依据' }),
              jsx('span', { style: { ...MUTED, display: 'block', marginTop: 2 }, children: item.locator || item.court || '' }),
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

    function Field({ label, value }) {
      if (value === null || value === undefined || value === '') return null;
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return jsxs('div', { style: { marginBottom: 6, padding: `0 ${PAD_X}` }, children: [
        jsx('span', { style: TINY, children: `${label}：` }), jsx('span', { children: text }) ] });
    }

    function ListField({ label, values }) {
      const items = (values || []).map((item) => (typeof item === 'object' ? item.text || item.summary || item.title || JSON.stringify(item) : String(item)))
        .filter((item) => item);
      if (!items.length) return null;
      return jsxs('div', { style: { marginBottom: 6, padding: `0 ${PAD_X}` }, children: [
        jsx('div', { style: TINY, children: label }),
        jsx('ul', { style: { margin: '4px 0 0', paddingLeft: 18 }, children: items.map((text, index) => jsx('li', { children: text }, index)) }) ] });
    }

    /** 待办状态复选框：面板唯一的写入口。勾选态由 isSettledPending 决定，与加粗、计数同口径。 */
    function PendingCheck({ item, busy, onTogglePending }) {
      const done = isSettledPending(item.status);
      return jsx('input', { type: 'checkbox', checked: done, disabled: busy === item.item_id || !item.item_id,
        'aria-label': done ? `把 ${item.item_id || '该待办'} 标记为未完成` : `把 ${item.item_id || '该待办'} 标记为已完成`,
        title: done ? '标记为未完成' : '标记为已完成',
        onChange: (event) => onTogglePending(item, event.target.checked),
        style: { margin: '4px 6px 0 0', flexShrink: 0 } });
    }

    /** 待办行：复选框 + 标题 + 小字元信息；已完成的标题加粗（"已了结"的记号）。 */
    function PendingRow({ item, busy, onTogglePending, showIssueRef }) {
      return jsxs('div', { style: { ...ROW, display: 'flex', alignItems: 'flex-start', cursor: 'default' }, children: [
        jsx(PendingCheck, { item, busy, onTogglePending }),
        jsxs('span', { style: { minWidth: 0 }, children: [
          jsx('span', { style: { display: 'block', fontWeight: isSettledPending(item.status) ? 600 : 400 },
            children: item.title || '内容待核' }),
          jsx('span', { style: { ...TINY, display: 'block', marginTop: 2 },
            children: `${item.item_id || '编号待补'} · ${pendingStatusLabel(item.status)}${item.due ? ` · 截止 ${item.due}` : ''}${showIssueRef && item.issue_ref ? ` · 关联争点 ${item.issue_ref}` : ''}` }),
        ] }),
      ] });
    }

    function IssueDetail({ context, issue, onQuote, quoteNotice, busyPending, onTogglePending }) {
      const facts = (context.facts || []).filter((fact) => (issue.fact_refs || []).includes(fact.fact_id));
      const pending = (context.pending_items || []).filter((item) => item.issue_ref === issue.issue_id);
      return jsxs('div', { children: [
        jsx('div', { style: { ...H3, padding: `0 ${PAD_X}`, marginBottom: 4 }, children: issue.title || '争点标题待确认' }),
        jsx('div', { style: NOTE, children: `${issue.issue_id}${issue.display_id ? ` · 展示编号 ${issue.display_id}` : ''} · 状态：${issueStatusLabel(issue.status)}` }),
        jsx('div', { style: { padding: `6px ${PAD_X}` }, children: [
          jsx('button', { type: 'button', style: BUTTON, onClick: () => onQuote(issue), children: '引用到对话' }),
        ] }),
        quoteNotice && jsx('div', { role: 'status', style: { ...NOTE, marginBottom: 8 }, children: quoteNotice }),
        // 立场、反对意见、证据缺口、下一步按用户要求整块删去；有内容时改由「办案备注」承载。
        // 办案备注是独立字段，不与立场混同：实测真实案件的办案记录写在这里，而 current_position 为空。
        issue.note && jsxs('section', { style: { padding: '12px 0', borderTop: `0.5px solid ${BORDER}` }, children: [
          jsx('div', { style: NOTE, children: '办案备注' }),
          jsx('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.7, padding: `0 ${PAD_X}` }, children: issue.note }),
        ] }),
        jsxs('section', { style: { padding: '12px 0', borderTop: `0.5px solid ${BORDER}` }, children: [
          jsx('div', { style: NOTE, children: `关联事实 · ${facts.length}` }),
          facts.length ? facts.map((fact) => jsxs('div', { style: { ...ROW, display: 'block', cursor: 'default' }, children: [
            jsx('span', { style: { display: 'block' }, children: fact.text || '内容待核' }),
            jsx('span', { style: { ...TINY, display: 'block', marginTop: 2 }, title: `原编码：${fact.kind || '—'} / ${fact.material_grade || '—'}`,
              children: `${fact.fact_id || '编号待补'} · ${factKindLabel(fact.kind)} · 材料性质：${materialGradeLabel(fact.material_grade)} · ${factVerificationLabel(fact.verification)}` }),
          ] }, fact.fact_id)) : empty('本案未登记与该争点关联的事实')] }),
        jsxs('section', { style: { padding: '12px 0', borderTop: `0.5px solid ${BORDER}` }, children: [
          jsx('div', { style: NOTE, children: `关联待办 · ${pending.length}` }),
          pending.length ? pending.map((item) => jsx(PendingRow, { item, busy: busyPending,
            onTogglePending, showIssueRef: false }, item.item_id)) : empty('无关联待办')] }),
      ] });
    }

    /**
     * 案件上下文：宽栏时两栏（左列表｜右详情），窄栏时单列。
     * 页头（导航行 + 案件名 + 读取时间 + 小标签 + 筛选行）合并为一个吸顶块：
     * 往下滑条目时"当前在看哪一案、哪一类、筛了什么"始终可见；一个吸顶块也避免了
     * 两个 sticky 叠同一个 top 互相遮挡的问题。
     */
    function ContextDetail({ context, sub, onSub, onQuote, onBack, onOpenMatter,
      quoteNotice, wide, busyPending, onTogglePending }) {
      const [selectedId, setSelectedId] = useState(null);
      // 筛选状态是本组件的本地态：组件按 matter.id 挂了 key，切案件自动重置；
      // 切小标签时在 onClick 里显式重置。
      const [factFilter, setFactFilter] = useState({ verification: 'all', kind: 'all' });
      const [pendingFilter, setPendingFilter] = useState('all');
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
          ? (context.issues || []).map((issue) => ({ key: issue.issue_id, title: issue.title || '标题待确认',
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
      const head = jsxs('div', { style: HEAD_STICKY, children: [
        // 两个出口各司其职、且都真实可达：回案件列表 / 打开该案件的详情视图。
        // 文案不能由"有没有详情可回"决定：进入上下文时 detail 必为 null（choose 与 goContext 都清），
        // 那样两个入口会退化成一个——只剩回列表，案件详情再也回不去（已实测到过）。
        // 「重新读取」全面板只有标题行右上角那一个：它在上下文页同样重读上下文（refresh('context')），
        // 这里不再放第二个（用户要求，2026-10-03）。
        jsxs('div', { style: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
          padding: `2px ${PAD_X} 0` }, children: [
          jsx('button', { type: 'button', style: QUIET, onClick: onBack, children: '← 案件列表' }),
          onOpenMatter && jsx('button', { type: 'button', style: QUIET, onClick: onOpenMatter, children: '案件详情 ›' }),
        ] }),
        jsx('div', { style: { ...H2, padding: `2px ${PAD_X} 0` }, children: context.matter?.name || '案件' }),
        jsx('div', { style: NOTE, children: `读取时间：${dateLabel(context.read_at)}` }),
        !context.issues?.length && !context.facts?.length && !context.pending_items?.length
          && empty('本案尚未登记事实、争点或待办。'),
        // 小标签行在吸顶块内：往下滑事实/争点/待办时，"当前在看哪一类"始终可见。
        jsxs('div', { style: { display: 'flex', gap: 14, borderBottom: `0.5px solid ${BORDER}`,
          margin: `4px ${PAD_X} 0` }, children: [
          ...subTabs.map(([id, title]) => jsx('button', { type: 'button',
            style: { ...QUIET, color: sub === id ? TEXT_PRIMARY : TEXT_TERTIARY,
              fontWeight: sub === id ? 600 : 400,
              borderBottom: sub === id ? `2px solid ${TEXT_PRIMARY}` : '2px solid transparent',
              borderRadius: 0, padding: '3px 0' },
            // 切小标签必须清掉已选争点：否则窄栏下会留在上一条争点的详情里，
            // 出现"标签显示事实、正文却是争点详情"的错位（实测复现）。筛选一并重置。
            onClick: () => { setSelectedId(null); setFactFilter({ verification: 'all', kind: 'all' }); setPendingFilter('all'); onSub(id); },
            children: id === 'pending' && unfinished !== undefined ? `${title} ${unfinished}/${totals[id]}` : `${title} ${totals[id]}` }, id)),
        ] }),
        // 筛选行：事实按核验状态+类别，待办按状态；与标签行同在吸顶块内，筛选条件始终可见。
        sub === 'facts' && jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          padding: `6px ${PAD_X} 6px`, borderBottom: `0.5px solid ${BORDER}` }, children: [
          jsxs('select', { 'aria-label': '按核验状态筛选', value: factFilter.verification, style: SELECT,
            onChange: (event) => setFactFilter((current) => ({ ...current, verification: event.target.value })),
            children: FACT_VERIFICATION_GROUPS.map(([value, label]) => jsx('option', { value, children: label }, value)) }),
          jsxs('select', { 'aria-label': '按事实类别筛选', value: factFilter.kind, style: SELECT,
            onChange: (event) => setFactFilter((current) => ({ ...current, kind: event.target.value })),
            children: [jsx('option', { value: 'all', children: '全部类别' }, 'all'),
              ...factKinds.map((kind) => jsx('option', { value: kind,
                children: kind === 'unknown' ? '类别待确认' : factKindLabel(kind) }, kind))] }),
          filterNote ? jsx('span', { style: TINY, children: filterNote }) : null,
        ] }),
        sub === 'pending' && jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          padding: `6px ${PAD_X} 6px`, borderBottom: `0.5px solid ${BORDER}` }, children: [
          jsxs('select', { 'aria-label': '按状态筛选', value: pendingFilter, style: SELECT,
            onChange: (event) => setPendingFilter(event.target.value),
            children: PENDING_FILTERS.map(([value, label]) => jsx('option', { value, children: label }, value)) }),
          filterNote ? jsx('span', { style: TINY, children: filterNote }) : null,
        ] }),
      ] });
      // 只有争点行可点开详情；事实行是只读浏览；待办行带复选框（写回状态），行本身不展开详情。
      const list = jsxs('div', { style: { paddingTop: 4 }, children: [
        rows.map((row) => (row.issue
          ? jsx(HoverRow, { onClick: () => setSelectedId(row.issue.issue_id),
            children: jsxs('span', { children: [jsx('strong', { children: row.title }),
              jsx('span', { style: { ...MUTED, display: 'block' }, children: row.meta })] }) }, row.key)
          : row.item
            ? jsx(PendingRow, { item: row.item, busy: busyPending, onTogglePending, showIssueRef: true }, row.key)
            : jsx('div', { style: { ...ROW, display: 'block', cursor: 'default' },
              children: jsxs('span', { children: [jsx('span', { children: row.title }),
                jsx('span', { style: { ...TINY, display: 'block', marginTop: 2 }, children: row.meta })] }) }, row.key))),
        !rows.length && empty((sub === 'facts' ? '暂无事实' : sub === 'issues' ? '暂无争点' : '暂无待办')
          + (filterNote ? '（当前筛选条件下）' : '')),
        (context.warnings || []).length > 0 && jsx('div', { style: NOTICE_BOX,
          children: context.warnings.map((warning) => errorLabel(warning, '案件存在待核事项。')).join('；') }),
      ] });
      // 窄栏：进详情要能返回列表；宽栏：左列表常驻，右侧直接显示详情，不需要返回键。
      const detail = selected
        ? jsxs('div', { children: [
          !wide && jsx('div', { style: { padding: `2px ${PAD_X}` }, children: jsx('button', {
            type: 'button', style: QUIET, onClick: () => setSelectedId(null), children: '← 争点列表' }) }),
          jsx(IssueDetail, { context, issue: selected, onQuote, quoteNotice, busyPending, onTogglePending }),
        ] })
        : empty(wide ? '选择一项查看详情' : (sub === 'issues' ? '选择一条争点查看详情与引用入口' : '事实与待办为只读浏览'));
      if (!wide) return jsxs('div', { children: [head, selected ? detail : list] });
      return jsxs('div', { children: [
        head,
        jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(320px, 1.4fr)', gap: 16 }, children: [
          list,
          jsx('div', { style: { borderLeft: `0.5px solid ${BORDER}`, paddingLeft: 12 }, children: detail }),
        ] }),
      ] });
    }

    function CaseBenchBody(props) {
      const remote = props.remote;
      const { tab: currentTab } = props.useTabInfo();
      const holder = useRef(null);
      const [wide, setWide] = useState(false);
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

      useEffect(() => {
        if (!holder.current || typeof ResizeObserver === 'undefined') return;
        // 760px 以下一律单列：面板多在窄栏里使用，两列会把每列压到读不下内容。
        const observer = new ResizeObserver((entries) => setWide((entries[0]?.contentRect?.width || 0) >= 760));
        observer.observe(holder.current);
        return () => observer.disconnect();
      }, []);
      useEffect(() => {
        // 实测侧栏面板底色：主题没有公开"侧栏表面"变量（bg-overlay 是浮层色，
        // 直接用在吸顶页头上是一块不搭的灰板——破产面板实测）。挂载后向上找第一个
        // 非透明背景的祖先，写进 --cb-pane-bg 供吸顶页头引用；两个主题都正确。
        // 已知限制：只在挂载时实测一次，主题切换后需重新打开面板才更新。
        let node = holder.current;
        while (node) {
          const bg = globalThis.getComputedStyle ? globalThis.getComputedStyle(node).backgroundColor : null;
          if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
            holder.current.style.setProperty('--cb-pane-bg', bg);
            break;
          }
          node = node.parentElement;
        }
        return undefined;
      }, []);
      async function syncFollow(initial = false, ticket = gate.begin()) {
        setLoading(true); setError('');
        try {
          const manual = manualRef.current;
          const association = unwrap(await remote.followSession({ sessionId: props.sessionId,
            ...(manual ? { matterPath: manual.path, matterId: manual.matter_id } : {}) }));
          if (!visible(ticket)) return;
          setFollow(association);
          const nextContext = association.context;
          if (!visible(ticket)) return;
          const entry = nextContext ? { path: nextContext.matter.path, matter_id: nextContext.matter.id, name: nextContext.matter.name } : null;
          setMatter(entry); setContext(nextContext || null); setQuoteNotice('');
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
      useEffect(() => {
        if (!initialized.current || summary?.running) return;
        const timer = setTimeout(() => void syncFollow(), 250);
        return () => clearTimeout(timer);
      }, [summary]);
      useEffect(() => {
        const focus = () => { if (initialized.current) void syncFollow(); };
        window.addEventListener?.('focus', focus);
        return () => window.removeEventListener?.('focus', focus);
      }, [remote, props.sessionId, matter?.path]);
      async function openMatter(entry, ticket = gate.begin()) {
        setLoading(true); setError('');
        try {
          const data = unwrap(await remote.matter({ path: entry.path, sessionId: props.sessionId }));
          if (visible(ticket)) { setMatterPage(entry.page || 'main'); setDetail({ kind: 'matter', data }, entry.page || 'main'); }
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
          if (visible(ticket)) setContext(data);
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
      // 上下文标签不显示案件/经验列表：它不是这两个列表的第三种取值。
      const listTab = tab === 'practice' ? 'practice' : 'cases';
      const items = listTab === 'cases' ? workspace?.matters || [] : notes?.notes || [];
      const filtered = items.filter((item) => [item.name, item.title, item.matter_name, item.search_text]
        .filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()));
      const list = jsxs('div', { children: [
        jsx('input', { 'aria-label': listTab === 'cases' ? '搜索案件' : '搜索办案经验',
          placeholder: listTab === 'cases' ? '搜索案件' : '搜索办案经验', value: query,
          onChange: (event) => setQuery(event.target.value),
          style: INPUT }),
        filtered.map((item, index) => jsx(HoverRow, {
          disabled: item.status === 'error',
          onClick: () => listTab === 'cases' ? chooseMatter(item) : openNote(item),
          children: jsxs('span', { children: [jsx('strong', { children: item.name || item.title }),
            jsx('span', { style: { ...MUTED, display: 'block' }, children: item.status === 'error' ? `状态异常：${errorLabel(item.error)}`
              // 阶段未知时省略该段：本工作区 5 案的 stage 全为 unknown，逐行重复"阶段待确认"没有信息量。
              : tab === 'cases' ? [
                item.proceeding_count > 1 ? `${item.proceeding_count} 个关联案件` : '',
                item.stage && item.stage !== 'unknown' ? stageLabel(item.stage) : '',
                item.next_event ? dateLabel(item.next_event.at).slice(0, 16) : '']
                .filter(Boolean).join(' · ')
                : `来源：${item.matter_name || '待核'}` }),
            item.recent_artifact && jsx('span', { style: { ...MUTED, display: 'block' }, children: `最近：${item.recent_artifact.title || '成果'}` }),
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
              quoteNotice, wide, busyPending, onTogglePending: togglePending }, context.matter?.id || 'context')
            : null;
      const contextHint = tab === 'context' && !context
        ? empty(loading ? '正在读取案件上下文…' : follow.status === 'ambiguous' ? '会话关联多个案件，请选择。' : '当前会话未解析到案件，请先在「案件」中选择。')
        : null;
      // 上下文标签自己排两栏（列表｜详情），所以这里不再套一层列表；其它标签沿用原有分栏。
      const leftPane = tab === 'context' ? null : list;
      const rightPane = tab === 'context' ? (detailNode || contextHint) : (detailNode || empty('选择一项查看详情'));
      // 根容器留白 6px（冻结规范 §三：框外文字行再叠 PAD_X 4px，文字左边统一落在 10px）。
      // 上边距**不能**给滚动容器：吸顶页头以滚动容器内容盒顶为吸附线，容器带上边距时
      // 页头会停在距顶 12px 处，顶上那条会漏出滚动内容。改由第一个内容块给上边距。
      return jsxs('div', { ref: holder, style: { color: TEXT_PRIMARY, font: 'inherit', fontSize: FONT,
        lineHeight: '20px', padding: '0 6px 12px', height: '100%', boxSizing: 'border-box', overflowY: 'auto' }, children: [
        // 下方吸顶头块有 10px 向上延伸的遮罩：预留 12px 不可折叠的底部内边距，
        // 避免正常文档流中遮住「切换案件 / 恢复跟随会话」按钮底边。
        jsxs('div', { style: { paddingTop: 12, paddingBottom: 12 }, children: [
          jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: `0 ${PAD_X}` }, children: [
            jsx('h3', { style: H1, children: '案件工作台' }),
            // 「重新读取」全面板只有这一个（右上角固定）：在上下文页同样重读上下文
            // （refresh('context') → syncFollow），子页内不再放第二个（用户要求，2026-10-03）。
            jsx('button', { type: 'button', style: QUIET,
              onClick: () => refresh(tab === 'context' ? 'context' : listTab), children: '重新读取' }),
          ] }),
          jsxs('div', { style: { display: 'flex', gap: 14, borderBottom: `0.5px solid ${BORDER}`,
            margin: `4px ${PAD_X} 8px` }, children: [
            ...[['cases', '案件'], ['practice', '办案经验'], ['context', '案件上下文']].map(([id, title]) => jsx('button', { type: 'button',
              style: { ...QUIET, color: tab === id ? TEXT_PRIMARY : TEXT_TERTIARY,
                fontWeight: tab === id ? 600 : 400,
                borderBottom: tab === id ? `2px solid ${TEXT_PRIMARY}` : '2px solid transparent',
                borderRadius: 0 },
              onClick: () => choose(id), children: title }, id)),
          ] }),
          // 工作区信息：两行备注小字 + 独立的按钮行。按钮不再用 marginLeft 跟在文字后面
          // （那样与上下文字都不对齐——用户截图指出），间隔由容器 gap 承担。
          jsxs('div', { style: { marginBottom: 8 }, children: [
            jsx('div', { style: NOTE, children: `Agent 工作区：${follow.cwd || '未登记'}` }),
            jsx('div', { style: NOTE, children: `选择来源：${manualRef.current ? '手动选择（仅当前会话）' : follow.source === 'reference' ? '最近已发送引用' : '跟随会话工作区'}` }),
            jsxs('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: `4px ${PAD_X} 0` }, children: [
              jsx('button', { type: 'button', style: BUTTON, onClick: () => choose('cases'), children: '切换案件' }),
              manualRef.current && jsx('button', { type: 'button', style: BUTTON,
                onClick: () => { remember(null); setDetail(null); void syncFollow(true); }, children: '恢复跟随会话' }),
              !manualRef.current && follow.status === 'ambiguous' && (follow.candidates || []).map((entry) => jsx('button', {
                type: 'button', style: BUTTON, onClick: () => { const selected = { path: entry.path, matter_id: entry.id }; remember(selected); void goContext(selected); },
                children: entry.name }, entry.id)),
            ] }),
          ] }),
          error && jsx('div', { role: 'alert', style: NOTICE_BOX, children: error }),
          loading && empty('正在读取…'),
        ] }),
        // 上下文标签自己排栏（ContextDetail 内按 wide 决定），这里给它整幅宽度；
        // 其它标签沿用原有的两栏/单列。
        tab === 'context'
          ? jsx('div', { children: rightPane })
          : wide
            ? jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(320px, 1.5fr)', gap: 16 }, children: [
              jsx('div', { children: leftPane }),
              jsx('div', { style: { borderLeft: `0.5px solid ${BORDER}`, paddingLeft: 12 }, children: rightPane })] })
            : jsx('div', { children: detailNode || list }),
      ] });
    }

    function SettingsSection({ remote }) {
      const [status, setStatus] = useState(null);
      const [count, setCount] = useState(null);
      const [error, setError] = useState('');
      async function refresh() {
        setError('');
        try {
          const [settings, workspace] = await Promise.all([remote.status(), remote.workspace()]);
          setStatus(unwrap(settings)); setCount(unwrap(workspace).matter_count);
        } catch (failure) { setError(errorLabel(failure)); }
      }
      useEffect(() => { void refresh(); }, [remote]);
      return jsxs('div', { style: { color: TEXT_PRIMARY, fontSize: FONT, lineHeight: '20px',
        maxWidth: 640, padding: 12 }, children: [
        heading('案件工作台'), labelled('工作区路径', status?.root),
        labelled('核心版本', versionLabel(status?.coreVersion)), labelled('已发现案件', count),
        jsx('div', { style: { ...NOTE, marginBottom: 8 }, children: '工作区路径可在当前配置方案的案件工作台插件配置中修改。' }),
        jsx('button', { type: 'button', style: BUTTON, onClick: refresh, children: '重新读取' }),
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
    exports.uiHelpers = { fileAddress, stageLabel, roleLabel, statusLabel, kindLabel, authorityLabel,
      verificationLabel, errorLabel, versionLabel, dateLabel, rowKey, matterSelectionTab,
      quoteText, createRequestGate, CaseBenchBody, MatterDetail, ContextDetail, factVerificationLabel, issueStatusLabel, confidenceLabel, factKindLabel, materialGradeLabel, pendingStatusLabel, subTabs,
      factVerificationGroup, factMatchesFilter, pendingMatchesFilter, isSettledPending,
      FACT_VERIFICATION_GROUPS, PENDING_FILTERS,
      outerTabs: [['cases', '案件'], ['practice', '办案经验'], ['context', '案件上下文']] };
    return module.exports;
  },
});

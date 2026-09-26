// CaseBench 右侧栏：只读取 Core Read Model，不保存第二份案件状态。
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
      { method: 'practiceList', implementation: 'remotePracticeList', parameters: [] },
      { method: 'practiceShow', implementation: 'remotePracticeShow', parameters: [{ name: 'args' }] },
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

    const colors = {
      text: 'var(--dsw-alias-label-primary, #17191c)',
      muted: 'var(--dsw-alias-label-secondary, #666b70)',
      border: 'var(--dsw-alias-border-l3, #0000001f)',
      hover: 'var(--dsw-alias-interactive-bg-hover, #2631480f)',
      surface: 'var(--dsw-alias-bg-layer-1, #fff)',
    };
    const base = { color: colors.text, font: 'inherit', fontSize: 13 };
    const button = { ...base, border: `1px solid ${colors.border}`, background: colors.surface,
      borderRadius: 6, padding: '5px 9px', cursor: 'pointer' };
    const row = { display: 'block', width: '100%', border: 0, borderBottom: `1px solid ${colors.border}`,
      background: 'transparent', textAlign: 'left', padding: '12px 2px', color: colors.text,
      font: 'inherit', cursor: 'pointer' };
    const section = { padding: '12px 0', borderTop: `1px solid ${colors.border}` };
    const small = { color: colors.muted, fontSize: 12, lineHeight: 1.6 };

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
      verification: { unverified: '未核验', partially_verified: '部分核验', verified: '已核验' },
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
    const verificationLabel = (value) => valueLabel('verification', value, '核验状态待确认');
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
    function caption(text) { return jsx('div', { style: { ...small, marginBottom: 6 }, children: text }); }
    function empty(text) { return jsx('div', { style: { ...small, padding: '12px 0' }, children: text }); }
    function heading(text) { return jsx('h3', { style: { margin: '4px 0 12px', fontSize: 16, fontWeight: 600 }, children: text }); }
    function labelled(label, value) {
      if (!value) return null;
      return jsxs('div', { style: { marginBottom: 9 }, children: [caption(label), jsx('div', { children: String(value) })] });
    }
    function guarded(View) {
      return class Boundary extends Component {
        constructor(props) { super(props); this.state = { error: null }; }
        static getDerivedStateFromError(error) { return { error }; }
        render() {
          return this.state.error ? jsx('div', { style: { padding: 14, ...small },
            children: errorLabel(this.state.error, '案件工作台显示失败，请重新读取或刷新页面。') }) : jsx(View, this.props);
        }
      };
    }

    function MatterDetail({ data, onBack, openFile }) {
      const matter = data.matter || {};
      const procedures = data.proceedings || [];
      const [page, setPage] = useState('main');
      const back = jsx('button', { type: 'button', style: button, onClick: page === 'main' ? onBack : () => setPage('main'), children: '← 返回' });
      const sublist = page === 'final' ? data.final_artifacts : page === 'statute'
        ? data.authority_refs.filter((x) => x.type === 'statute')
        : data.authority_refs.filter((x) => x.type === 'case');
      if (page !== 'main') return jsxs('div', { children: [back, heading(page === 'final' ? '已定稿' : page === 'statute' ? '本案法条' : '参考案例'),
        ...(sublist || []).map((item, index) => jsxs('div', { style: row, children: [
          jsx('div', { children: item.title || item.case_number || item.path || '未命名' }),
          jsx('div', { style: small, children: item.locator || item.proposition || item.path || '' }),
          item.verification?.status && jsx('div', { style: small, children: `核验：${verificationLabel(item.verification.status)}` }),
          item.path && jsx('button', { type: 'button', style: button, onClick: () => openFile(item.path), children: '打开文件' }),
        ] }, item.artifact_id || item.authority_ref_id || index))] });
      return jsxs('div', { children: [back, heading(matter.name || '案件'),
        jsx('div', { style: small, children: `${stageLabel(matter.stage)} · ${roleLabel(matter.role, matter.type)}` }),
        procedures.length > 1 && jsxs('section', { style: section, children: [heading(`关联案件 · ${procedures.length}`),
          ...procedures.map((item) => jsxs('div', { style: { padding: '8px 0' }, children: [
            jsx('strong', { children: item.name }), jsx('div', { style: small, children: `${item.case_number || '案号待核'} · ${stageLabel(item.stage)} · ${statusLabel(item.status)}` }),
          ] }, item.proceeding_id))] }),
        procedures.length === 1 && jsxs('section', { style: section, children: [
          labelled('案件', procedures[0].name), labelled('案号', procedures[0].case_number),
          ...(procedures[0].parties || []).map((party, index) => labelled(roleLabel(party.role, matter.type), party.name)),
        ] }),
        data.next_event && jsxs('section', { style: section, children: [caption('下次开庭或程序节点'),
          jsx('div', { children: dateLabel(data.next_event.at) }),
          data.next_event.location && jsx('div', { style: small, children: data.next_event.location }),
        ] }),
        jsxs('section', { style: section, children: [heading('最近工作'),
          ...(data.recent_artifacts || []).slice(0, 6).map((item, index) => jsxs('div', { style: { padding: '6px 0' }, children: [
            jsx('div', { children: item.title || '成果' }),
            jsx('div', { style: small, children: `${kindLabel(item.kind)} · ${String(item.at || '').slice(0, 10)}` }),
            item.path && jsx('button', { type: 'button', style: button, onClick: () => openFile(item.path), children: '打开' }),
          ] }, item.artifact_id || index)),
          !(data.recent_artifacts || []).length && empty('暂无登记成果'),
        ] }),
        jsxs('section', { style: section, children: [
          jsx('button', { type: 'button', style: row, onClick: () => setPage('final'), children: `已定稿　${data.final_artifact_count || 0} ›` }),
          jsx('button', { type: 'button', style: row, onClick: () => setPage('statute'), children: `本案法条　${(data.authority_refs || []).filter((x) => x.type === 'statute').length} ›` }),
          jsx('button', { type: 'button', style: row, onClick: () => setPage('case'), children: `参考案例　${(data.authority_refs || []).filter((x) => x.type === 'case').length} ›` }),
        ] }),
        (data.warnings || []).length > 0 && jsx('div', { style: small, children: data.warnings.map((warning) => errorLabel(warning, '案件信息存在待核事项，请检查案件登记。')).join('；') }),
      ] });
    }

    function PracticeDetail({ data, onBack, onSource }) {
      const meta = data.metadata || {};
      const [selected, setSelected] = useState(null);
      if (selected) return jsxs('div', { children: [
        jsx('button', { type: 'button', style: button, onClick: () => setSelected(null), children: '← 办案经验' }),
        heading(selected.title || selected.case_number || '关联依据'),
        labelled('类型', authorityLabel(selected.type)), labelled('案号', selected.case_number),
        labelled('法院', selected.court), labelled('裁判日期', selected.decision_date),
        labelled('条文定位', selected.locator),
        selected.source?.url && /^https?:\/\//.test(selected.source.url) && jsx('a', {
          href: selected.source.url, target: '_blank', rel: 'noreferrer', children: '查看来源' }),
        labelled('历史核验时间', dateLabel(selected.source?.verified_at)),
        jsx('div', { style: small, children: '历史依据用于新案件前须重新联网核验。' }),
      ] });
      return jsxs('div', { children: [jsx('button', { type: 'button', style: button, onClick: onBack, children: '← 办案经验' }),
        heading(meta.title || '办案经验'),
        jsx('button', { type: 'button', style: { ...button, marginBottom: 6 }, onClick: onSource,
          children: `来源：${meta.origin?.matter_name || '待核'}` }),
        caption(`关联争点：${(meta.origin?.issue_refs || []).length} 项 · 关联成果：${(meta.origin?.artifact_refs || []).length} 项`),
        jsx('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.75, padding: '8px 0' }, children: data.body || '' }),
        jsxs('section', { style: section, children: [heading('关联依据'),
          ...(data.authorities || []).map((item) => jsxs('button', { type: 'button', style: row, onClick: () => setSelected(item), children: [
            jsx('div', { children: item.title || item.case_number || '关联依据' }),
            jsx('div', { style: small, children: item.locator || item.court || '' }),
          ] }, item.id))] }),
        jsx('div', { style: { ...small, borderTop: `1px solid ${colors.border}`, paddingTop: 10 },
          children: '历史经验仅用于研究起点，在新案件使用法条或案例前须重新联网核验。' }),
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
      const [detail, setDetail] = useState(null);
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(false);
      useEffect(() => {
        if (!holder.current || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => setWide((entries[0]?.contentRect?.width || 0) >= 640));
        observer.observe(holder.current);
        return () => observer.disconnect();
      }, []);
      async function refresh(which = tab) {
        setLoading(true); setError('');
        try {
          if (which === 'cases') setWorkspace(unwrap(await remote.workspace()));
          else setNotes(unwrap(await remote.practiceList()));
        } catch (failure) { setError(errorLabel(failure)); }
        finally { setLoading(false); }
      }
      useEffect(() => { void refresh('cases'); }, [remote]);
      async function openMatter(entry) {
        setLoading(true); setError('');
        try { setDetail({ kind: 'matter', data: unwrap(await remote.matter({ path: entry.path })) }); }
        catch (failure) { setError(errorLabel(failure)); }
        finally { setLoading(false); }
      }
      async function openNote(entry) {
        setLoading(true); setError('');
        try { setDetail({ kind: 'practice', data: unwrap(await remote.practiceShow({ id: entry.id })) }); }
        catch (failure) { setError(errorLabel(failure)); }
        finally { setLoading(false); }
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
        if (entry) { setTab('cases'); void openMatter(entry); }
        else setError('来源案件当前未在工作区列表中找到。');
      }
      function choose(value) {
        setTab(value); setDetail(null); setQuery('');
        if (value === 'practice' && notes === null) void refresh('practice');
      }
      const items = tab === 'cases' ? workspace?.matters || [] : notes?.notes || [];
      const filtered = items.filter((item) => [item.name, item.title, item.matter_name, item.search_text]
        .filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()));
      const list = jsxs('div', { children: [
        jsx('input', { 'aria-label': tab === 'cases' ? '搜索案件' : '搜索办案经验',
          placeholder: tab === 'cases' ? '搜索案件' : '搜索办案经验', value: query,
          onChange: (event) => setQuery(event.target.value),
          style: { ...base, width: '100%', boxSizing: 'border-box', border: `1px solid ${colors.border}`,
            borderRadius: 6, padding: '7px 9px', background: colors.surface } }),
        filtered.map((item, index) => jsx('button', { type: 'button', style: row,
          disabled: item.status === 'error',
          onClick: () => tab === 'cases' ? openMatter(item) : openNote(item),
          children: jsxs('span', { children: [jsx('strong', { children: item.name || item.title }),
            jsx('span', { style: { ...small, display: 'block' }, children: item.status === 'error' ? `状态异常：${errorLabel(item.error)}`
              : tab === 'cases' ? `${item.proceeding_count > 1 ? `${item.proceeding_count} 个关联案件 · ` : ''}${stageLabel(item.stage)}${item.next_event ? ` · ${dateLabel(item.next_event.at).slice(0, 16)}` : ''}`
                : `来源：${item.matter_name || '待核'}` }),
            item.recent_artifact && jsx('span', { style: { ...small, display: 'block' }, children: `最近：${item.recent_artifact.title || '成果'}` }),
          ] }),
        }, rowKey(tab, item, index))),
        !filtered.length && empty(query ? '没有匹配结果' : '暂无内容'),
      ] }, tab);
      const detailNode = detail?.kind === 'matter' ? jsx(MatterDetail, { data: detail.data, onBack: () => setDetail(null), openFile }, detail.data.matter.id)
        : detail?.kind === 'practice' ? jsx(PracticeDetail, { data: detail.data, onBack: () => setDetail(null), onSource: openSource }, detail.data.metadata.id) : null;
      return jsxs('div', { ref: holder, style: { ...base, padding: '12px 14px', height: '100%', boxSizing: 'border-box', overflowY: 'auto' }, children: [
        jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          heading('案件工作台'), jsx('button', { type: 'button', style: button, onClick: () => refresh(), children: '重新读取' }),
        ] }),
        jsxs('div', { style: { display: 'flex', gap: 14, borderBottom: `1px solid ${colors.border}`, marginBottom: 12 }, children: [
          ...[['cases', '案件'], ['practice', '办案经验']].map(([id, title]) => jsx('button', { type: 'button',
            style: { ...button, border: 0, borderBottom: tab === id ? `2px solid ${colors.text}` : '2px solid transparent', borderRadius: 0 },
            onClick: () => choose(id), children: title }, id)),
        ] }),
        error && jsx('div', { role: 'alert', style: { ...small, marginBottom: 10 }, children: error }),
        loading && empty('正在读取…'),
        wide ? jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(320px, 1.5fr)', gap: 22 },
          children: [list, jsx('div', { style: { borderLeft: `1px solid ${colors.border}`, paddingLeft: 20 }, children: detailNode || empty('选择一项查看详情') })] })
          : detailNode || list,
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
      return jsxs('div', { style: { ...base, maxWidth: 640, padding: 12 }, children: [
        heading('案件工作台'), labelled('工作区路径', status?.root),
        labelled('核心版本', versionLabel(status?.coreVersion)), labelled('已发现案件', count),
        jsx('div', { style: { ...small, marginBottom: 8 }, children: '工作区路径可在当前配置方案的案件工作台插件配置中修改。' }),
        jsx('button', { type: 'button', style: button, onClick: refresh, children: '重新读取' }),
        error && jsx('div', { role: 'alert', style: { ...small, marginTop: 8 }, children: error }),
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
    exports.INVOCATIONS = INVOCATIONS;
    exports.uiHelpers = { fileAddress, stageLabel, roleLabel, statusLabel, kindLabel, authorityLabel,
      verificationLabel, errorLabel, versionLabel, dateLabel, rowKey };
    return module.exports;
  },
});

/**
 * 引用展开：面板插入的标识如何变成模型可见的材料快照。
 *
 * 这些用例不启动 Agent，而是直接驱动 `installReferenceExpansion` 注册的 pre-step
 * 监听器：用一个假的 ctx 收下监听器，再用假的 agent/session 提供已持久化日志。
 * 重点锁三件事：展开内容带身份与定位、**幂等**（重复 pre-step 不重复注入）、
 * 展开失败不阻断用户消息。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installReferenceExpansion, uiText } from '../src/host/index.js';

const ROOT = '/virtual/workspace';
const REFERENCE = '【案件引用：示例案件 · ISS-0001 · 某争点】';

function snapshot(overrides = {}) {
  return {
    view_version: 2,
    matter: { id: 'matter-1', name: '示例案件', path: `${ROOT}/示例案件` },
    issue: {
      issue_id: 'ISS-0001', display_id: 'I-001', title: '某争点', status: 'open', category: 'priority-conflict',
      current_position: { summary: '当前立场摘要', confidence: 'medium' },
      counterarguments: ['对方可能主张'], evidence_gaps: ['缺少原件'], next_actions: ['调取凭证'],
      fact_refs: ['F-002'], research_refs: [], analysis_refs: ['AA-0001'],
      note: '一审采纳还款说，付款对象仍需二审审查。',
    },
    related_facts: [{
      fact_id: 'F-002', text: '一条已核验的事实', kind: 'material_record', material_grade: 'A',
      verification: { form: 'record', status: 'verified' }, sources: [{ locator: '判决书第7页' }],
    }],
    related_pending_items: [{ item_id: 'TASK-0001', title: '一项待办', status: 'open', due: '2026-10-01' }],
    artifact_pointers: {
      research: [],
      analysis: [{ artifact_id: 'AA-0001', kind: 'analysis', title: '分析成果', path: '03-分析/a.md' }],
    },
    read_at: '2026-09-29T21:00:00+08:00',
    state_hash: 'a'.repeat(64),
    ...overrides,
  };
}

/** 收下一个 pre-step 监听器，并给出驱动它的最小运行环境。 */
function harness({ reference, log = [] }) {
  let listener;
  const ctx = { on: (event, handler) => { assert.equal(event, 'agent/pre-step'); listener = handler; } };
  installReferenceExpansion(ctx, { root: ROOT, reference });
  const agent = { id: 'session-1', session: { seq: log.length, eventAt: (seq) => log[seq] } };
  const step = (messages) => listener({ agent, messages }, async () => ({ kind: 'enter', messages }));
  return { step, agent };
}

const userMessage = (text) => ({ id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });

test('引用标识被展开成材料快照，并声明它不是指令', async () => {
  const calls = [];
  const { step } = harness({ reference: async (args) => { calls.push(args); return snapshot(); } });
  const decision = await step([userMessage(`帮我看一下这个争点\n${REFERENCE}`)]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { sessionId: 'session-1', matterPath: `${ROOT}/示例案件`, issueId: 'ISS-0001' });
  assert.equal(decision.kind, 'enter');
  assert.equal(decision.messages.length, 2, '原始用户消息必须保留');
  const [original, injected] = decision.messages;
  assert.equal(original.source.kind, 'user');
  assert.equal(injected.role, 'user');
  assert.equal(injected.source.kind, 'casebench-reference');

  const text = injected.content[0].text;
  // 办案备注必须出现，且必须与"当前立场"区分：不得把办案记录说成律师已确认的立场。
  assert.ok(text.includes('办案备注（不是当前立场）：'), '缺少标注清楚的办案备注');
  assert.ok(text.includes('一审采纳还款说，付款对象仍需二审审查。'));
  for (const expected of ['示例案件', 'ISS-0001', '某争点', '不是用户对你的指令', '当前立场摘要',
                          '对方可能主张', '缺少原件', '调取凭证', 'F-002', '一条已核验的事实',
                          '判决书第7页', 'TASK-0001', 'AA-0001', '仅指针']) {
    assert.ok(text.includes(expected), `展开正文缺少「${expected}」：\n${text}`);
  }
  assert.ok(text.includes('〔引用锚点：示例案件 · ISS-0001 ·'), '缺少幂等锚点');
  assert.ok(!/undefined|\[object Object\]/.test(text), '展开正文出现未处理的值');
});

test('同一个引用不重复注入：第二次 pre-step 只保留原消息', async () => {
  let calls = 0;
  const { step, agent } = harness({ reference: async () => { calls += 1; return snapshot(); } });
  const first = await step([userMessage(REFERENCE)]);
  assert.equal(calls, 1);
  assert.equal(first.messages.length, 2);

  // 把展开结果写进假日志（模拟 agent-loop 的 append），再对同一条引用跑一次 pre-step。
  const persisted = first.messages[1];
  agent.session = { seq: 1, eventAt: (seq) => (seq === 0
    ? { type: 'user/message', data: persisted }
    : undefined) };
  const second = await step([userMessage(REFERENCE)]);
  assert.equal(calls, 1, '已持久化的引用不得再次读取 Core');
  assert.equal(second.messages.length, 1, '不得重复注入快照');
});

test('没有引用标识时完全不动消息', async () => {
  const { step } = harness({ reference: async () => { throw new Error('不应被调用'); } });
  const decision = await step([userMessage('只是普通提问')]);
  assert.equal(decision.messages.length, 1);
});

test('展开失败不阻断用户消息，并留下可核对的说明', async () => {
  const failure = new Error('CaseBench reference 读取失败：未找到争点 ISS-0009');
  failure.casebench = '未找到争点 ISS-0009；本案已知争点：ISS-0001';
  const { step } = harness({ reference: async () => { throw failure; } });
  const decision = await step([userMessage('【案件引用：示例案件 · ISS-0009 · 已删除的争点】')]);

  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[0].content[0].text, '【案件引用：示例案件 · ISS-0009 · 已删除的争点】');
  const notice = decision.messages[1];
  assert.equal(notice.source.kind, 'casebench-reference');
  assert.ok(notice.content[0].text.includes('引用快照未能展开'));
  assert.ok(notice.content[0].text.includes('未找到争点 ISS-0009'), '应带出 Core 给出的原因');
  assert.ok(!notice.content[0].text.includes('示例案件 · ISS-0009 ·'), '失败的展开不得带锚点，否则会被误判为已展开');
});

test('一条消息里的多个引用各自展开，且互不影响', async () => {
  const seen = [];
  const { step } = harness({ reference: async (args) => { seen.push(args.issueId); return snapshot(); } });
  const decision = await step([userMessage('【案件引用：甲案 · ISS-0001 · 争点一】\n【案件引用：乙案 · ISS-0002 · 争点二】')]);
  assert.deepEqual(seen, ['ISS-0001', 'ISS-0002']);
  assert.equal(decision.messages.length, 3);
  assert.ok(decision.messages[1].content[0].text.includes('甲案'));
  assert.ok(decision.messages[2].content[0].text.includes('乙案'));
});

test('超长快照按固定顺序截断并说明省略了什么', async () => {
  const many = Array.from({ length: 400 }, (_, index) => ({
    fact_id: `FACT-${String(index).padStart(4, '0')}`, text: '很长的'.repeat(20), kind: 'material_record',
    material_grade: 'A', verification: { form: 'record', status: 'verified' }, sources: [],
  }));
  const { step } = harness({ reference: async () => snapshot({ related_facts: many }) });
  const decision = await step([userMessage(REFERENCE)]);
  const text = decision.messages[1].content[0].text;
  assert.ok(text.length < 20000, `展开正文应被截断，实际 ${text.length} 字`);
  assert.ok(text.includes('快照已限长：省略'), '截断时必须说明省略了什么');
  for (const expected of ['当前立场摘要', '缺少原件', '对方可能主张', 'AA-0001']) assert.ok(text.includes(expected), `限长不得丢失 ${expected}`);
  assert.ok(text.includes('ISS-0001') && text.includes('某争点'), '截断后仍须保留案件与争点身份');
  assert.ok(text.includes('〔引用锚点：'), '截断后仍须保留幂等锚点');
});

test('未登记立场时不报确信度，办案备注照常带出', async () => {
  // 真实情形（2026-09-29 实测）：17 条争点的 current_position.summary 全为空、note 全有内容。
  // 此时输出「确信度：unknown」会被读成"有立场但把握不明"，必须省略。
  const { step } = harness({ reference: async () => snapshot({ issue: {
    ...snapshot().issue, current_position: { summary: '', confidence: 'unknown' },
  } }) });
  const text = (await step([userMessage(REFERENCE)])).messages[1].content[0].text;
  assert.ok(!text.includes('当前立场：'), '未登记立场时不应输出当前立场');
  assert.ok(!text.includes('确信度：'), '未登记立场时不应输出确信度');
  assert.ok(text.includes('办案备注（不是当前立场）：'), '备注与立场是两回事，必须仍然带出');
});

test('展开正文里的字段值也是中文（与界面同一套词表）', () => {
  const { factKindText, materialGradeText, pendingStatusText, verificationText } = uiText;
  assert.equal(factKindText('material_record'), '材料记载');
  assert.equal(factKindText('party_statement'), '当事人陈述');
  assert.equal(factKindText('legacy_unclassified'), '未分类旧条目');
  assert.equal(factKindText('never-seen'), '类别待确认');
  assert.equal(materialGradeText('A'), 'A 级');
  assert.equal(materialGradeText(null), '未登记');
  assert.equal(pendingStatusText('open'), '待处理');
  assert.equal(pendingStatusText('进行中'), '进行中');
  assert.equal(pendingStatusText('never-seen'), '状态待确认');
  // 组合编码：给出中文 + 原编码；任何取值都不得把英文原样甩出来。
  for (const status of ['verified', 'pending', 'verified_as_party_statement',
                        'verified_as_judgment_record; original_not_seen_in_current_read',
                        'never_seen_before']) {
    const text = verificationText({ form: 'record', status });
    assert.ok(!/[a-z]/.test(text.replace(/编码：[^）]*/g, '')), `核验状态泄露英文：${text}`);
  }
  assert.equal(verificationText({ form: 'record', status: 'verified' }), '核验：已核验');
  assert.equal(verificationText({ form: 'legacy_string', status: 'verified' }), '核验：已核验（旧格式）');
  assert.equal(verificationText(null), '核验状态待确认');
});

test('v2 引用使用真实身份；同消息重放幂等，新消息可以再次引用', async () => {
  const calls = [];
  const payload = { matterId: 'matter-1', matterPath: `${ROOT}/真实目录`, issueId: 'ISS-0001', expectedHash: 'a'.repeat(64) };
  const token = `【案件引用：展示别名 · ISS-0001 · 某争点 · v2:${encodeURIComponent(JSON.stringify(payload))}】`;
  const { step, agent } = harness({ reference: async (args) => { calls.push(args); return snapshot(); } });
  const first = await step([userMessage(token)]);
  assert.deepEqual(calls[0], { sessionId: 'session-1', ...payload });
  assert.ok(first.messages[1].content[0].text.includes('〔引用身份：'));
  agent.session = { seq: 1, eventAt: () => ({ type: 'user/message', data: first.messages[1] }) };
  assert.equal((await step([userMessage(token)])).messages.length, 1);
  const next = await step([{ ...userMessage(token), id: 'm2' }]);
  assert.equal(next.messages.length, 2);
  assert.notEqual(next.messages[1].id, first.messages[1].id);
  assert.equal(calls.length, 2);
});

test('v2 同名案件同争点分别展开；过期引用说明失败且保留原消息', async () => {
  const tokens = ['a', 'b'].map((id) => `【案件引用：同名案件 · ISS-0001 · 某争点 · v2:${encodeURIComponent(JSON.stringify({ matterId: id, matterPath: `${ROOT}/${id}`, issueId: 'ISS-0001', expectedHash: 'a'.repeat(64) }))}】`);
  const { step } = harness({ reference: async (args) => {
    if (args.matterId === 'b') throw new Error('状态已变化，请重新读取');
    return snapshot();
  } });
  const result = await step([userMessage(tokens.join('\n'))]);
  assert.equal(result.messages.length, 3);
  assert.ok(result.messages[1].content[0].text.includes('〔引用身份：'));
  assert.ok(result.messages[2].content[0].text.includes('状态已变化'));
  assert.ok(!result.messages[2].content[0].text.includes('〔引用身份：'));
});

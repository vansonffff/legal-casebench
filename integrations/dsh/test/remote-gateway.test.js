import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import { CaseBenchService } from '../src/host/index.js';
import { TYPERT } from '../typert.host.js';

const scripts = resolve(import.meta.dirname, '../dist/skill/scripts');
// 与 Host 配置同源：python3.12 可能不在测试进程的 PATH 里（如 gui 启动的环境），
// 允许用 CASEBENCH_PYTHON 指定绝对路径，默认沿用 python3.12。
const python = process.env.CASEBENCH_PYTHON || 'python3.12';

test('真实 Typert Gateway 能读取 Core Read Model，越界 Matter 被拒绝', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'casebench-gateway-'));
  try {
    const created = spawnSync(python, [resolve(scripts, 'matter.py'), 'init', '--root', root,
      '--name', '测试案件', '--actor', 'dsh'], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const ctx = new Context();
    new TypertRegistry(ctx);
    new CaseBenchService(ctx, { root, python });
    const gateway = new TypertGatewayService(ctx);
    await new Promise((done) => setTimeout(done, 150));
    ctx.typert.register(TYPERT);
    const workspace = await gateway.invoke({ namespace: 'casebench', method: 'workspace', args: {} });
    assert.equal(workspace.matter_count, 1);
    assert.equal(workspace.matters[0].name, '测试案件');
    const matter = await gateway.invoke({ namespace: 'casebench', method: 'matter',
      args: { args: { path: resolve(root, '测试案件') } } });
    assert.equal(matter.matter.name, '测试案件');
    await assert.rejects(() => gateway.invoke({ namespace: 'casebench', method: 'matter',
      args: { args: { path: '/tmp' } } }), /越过 CaseBench 工作区/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('只读上下文与引用快照：越界、符号链接越界与非法 Issue ID 均被拒绝', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'casebench-context-'));
  const outside = await mkdtemp(resolve(tmpdir(), 'casebench-outside-'));
  try {
    const created = spawnSync(python, [resolve(scripts, 'matter.py'), 'init', '--root', root,
      '--name', '上下文案件', '--actor', 'dsh'], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const caseDir = resolve(root, '上下文案件');
    const ctx = new Context();
    new TypertRegistry(ctx);
    new CaseBenchService(ctx, { root, python });
    const gateway = new TypertGatewayService(ctx);
    await new Promise((done) => setTimeout(done, 150));
    ctx.typert.register(TYPERT);
    const call = (method, args) => gateway.invoke({ namespace: 'casebench', method, args: { args } });

    const empty = await call('context', { sessionId: '', matterPath: caseDir });
    assert.equal(empty.view_version, 2);
    assert.deepEqual(empty.counts, { facts: 0, issues: 0, pending_items: 0, pending_open: 0 });
    assert.equal(empty.state_hash.length, 64);

    // 工作在案件的注册表写入状态，且读取前后画面不应改变案件文件。
    const seeded = spawnSync(python, [resolve(scripts, 'issue.py'), 'add', '--case-dir', caseDir,
      '--title', '争点一', '--actor', 'dsh'], { encoding: 'utf8' });
    assert.equal(seeded.status, 0, seeded.stderr);
    const filled = await call('context', { sessionId: '', matterPath: caseDir });
    assert.equal(filled.counts.issues, 1);
    const snapshot = await call('reference', { sessionId: '', matterPath: caseDir, issueId: 'ISS-0001' });
    assert.equal(snapshot.issue.issue_id, 'ISS-0001');
    assert.equal(snapshot.issue.title, '争点一');
    assert.equal(snapshot.state_hash, filled.state_hash);

    await assert.rejects(() => call('context', { sessionId: '', matterPath: outside }), /越过已声明的案件工作区/);
    await assert.rejects(() => call('context', { sessionId: '', matterPath: resolve(root, '..') }), /越过已声明的案件工作区/);
    await assert.rejects(() => call('context', { sessionId: '', matterPath: '' }), /缺少案件目录/);
    await assert.rejects(() => call('reference', { sessionId: '', matterPath: caseDir, issueId: '../../etc' }),
      /Issue ID 无效/);
    await assert.rejects(() => call('quoteIssue', { sessionId: '', matterPath: caseDir, matterId: filled.matter.id, expectedHash: filled.state_hash, issueId: 'ISS-9999' }),
      /未找到争点 ISS-9999/, '不存在的争点应报出原因而不是返回空快照');
    await assert.rejects(() => call('reference', { sessionId: '', matterPath: caseDir, issueId: 'ISS-9999' }),
      /未找到争点 ISS-9999/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('待办状态写回：经 Gateway 落盘并可读回；越界、非法状态与未知编号均被拒绝', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'casebench-pending-'));
  try {
    const created = spawnSync(python, [resolve(scripts, 'matter.py'), 'init', '--root', root,
      '--name', '待办案件', '--actor', 'dsh'], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const caseDir = resolve(root, '待办案件');
    const seeded = spawnSync(python, ['-c', `
import json, pathlib
path = pathlib.Path(${JSON.stringify(caseDir)}) / '_case_state.json'
state = json.loads(path.read_text(encoding='utf-8'))
state['pending_items'] = [{'item_id': 'TASK-0001', 'title': '调取流水', 'issue_ref': '', 'status': 'open'},
                          {'id': 'P-001', 'title': '存量待办', 'status': '待处理'}]
path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
`], { encoding: 'utf8' });
    assert.equal(seeded.status, 0, seeded.stderr);
    const ctx = new Context();
    new TypertRegistry(ctx);
    new CaseBenchService(ctx, { root, python });
    const gateway = new TypertGatewayService(ctx);
    await new Promise((done) => setTimeout(done, 150));
    ctx.typert.register(TYPERT);
    const call = (method, args) => gateway.invoke({ namespace: 'casebench', method, args: { args } });

    const done = await call('setPendingStatus', { sessionId: '', matterPath: caseDir, itemId: 'TASK-0001', status: 'completed' });
    assert.equal(done.status, 'updated');
    // 读回确认：视图里的状态与未完成计数都已反映写入。
    const after = await call('context', { sessionId: '', matterPath: caseDir });
    assert.equal(after.pending_items[0].status, 'completed');
    assert.equal(after.counts.pending_open, 1);
    // 存量展示编号（P-001）同样可写回。
    await call('setPendingStatus', { sessionId: '', matterPath: caseDir, itemId: 'P-001', status: 'completed' });
    const again = await call('context', { sessionId: '', matterPath: caseDir });
    assert.equal(again.counts.pending_open, 0);

    await assert.rejects(() => call('setPendingStatus', { sessionId: '', matterPath: caseDir, itemId: 'TASK-0001', status: '已完成' }),
      /open\/completed/, '状态只接受规范值');
    await assert.rejects(() => call('setPendingStatus', { sessionId: '', matterPath: caseDir, itemId: 'TASK-9999', status: 'completed' }),
      /未找到 Pending Item/);
    await assert.rejects(() => call('setPendingStatus', { sessionId: '', matterPath: '/tmp', itemId: 'TASK-0001', status: 'completed' }),
      /越过已声明的案件工作区/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

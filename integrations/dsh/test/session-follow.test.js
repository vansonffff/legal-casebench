import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rename, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import { CaseBenchService, uiText } from '../src/host/index.js';
import { latestReferences, parseReferences } from '../src/host/references.js';

const python = process.env.CASEBENCH_PYTHON || 'python3.12';
const scripts = resolve(import.meta.dirname, '../dist/skill/scripts');
const token = (context, issueId = 'ISS-0001') => `【案件引用：显示名称 · ${issueId} · 争点 · v2:${encodeURIComponent(JSON.stringify({
  matterId: context.matter.id, matterPath: context.matter.path, issueId, expectedHash: context.state_hash,
}))}】`;
const sent = (text) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } });

test('会话跟随、附加目录、歧义、身份与引用哈希保护均走真实 Core', async () => {
  const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'casebench-follow-')));
  const root = resolve(temp, '主工作区'), shared = resolve(temp, '附加目录'), outside = resolve(temp, '越界目录');
  await Promise.all([mkdir(root), mkdir(shared), mkdir(outside)]);
  try {
    const run = (...args) => {
      const result = spawnSync(python, args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr); return result;
    };
    run(resolve(scripts, 'matter.py'), 'init', '--root', shared, '--name', '展示名称', '--actor', 'dsh');
    await rename(resolve(shared, '展示名称'), resolve(shared, '实际目录'));
    const casePath = resolve(shared, '实际目录');
    run(resolve(scripts, 'issue.py'), 'add', '--case-dir', casePath, '--title', '争点一', '--actor', 'dsh');
    const sessions = {
      s1: { header: { cwd: root }, snapshotEvents: () => [] },
      s2: { header: { cwd: outside }, snapshotEvents: () => [] },
    };
    const ctx = new Context(); new TypertRegistry(ctx);
    ctx.provide('sessions', { get: (id) => sessions[id] });
    ctx.provide('workspaceRegistry', { list: () => [{ id: 'w1', path: root, sessionIds: ['s1'] }] });
    let additional = [casePath];
    ctx.provide('workspaceDirs', { dirsFor: () => ({ dirs: additional, missingDirs: [] }) });
    const service = new CaseBenchService(ctx, { root, python });
    const first = await service.remoteFollowSession({ sessionId: 's1' });
    assert.equal(first.status, 'ready'); assert.equal(first.context.matter.path, casePath);
    assert.equal(first.context.matter.name, '展示名称');
    const args = { sessionId: 's1', matterPath: casePath, matterId: first.context.matter.id,
      expectedHash: first.context.state_hash, issueId: 'ISS-0001' };
    const quote = await service.remoteQuoteIssue(args);
    assert.equal(quote.issue.title, '争点一');
    await assert.rejects(() => service.remoteQuoteIssue({ ...args, matterId: 'wrong' }), /案件身份已变化/);
    await assert.rejects(() => service.remoteQuoteIssue({ ...args, expectedHash: '0'.repeat(64) }), /案件材料已变化/);
    await assert.rejects(() => service.remoteContext({ sessionId: 's2', matterPath: casePath }), /越过/);
    await symlink(outside, resolve(root, '逃逸'));
    await assert.rejects(() => service.remoteContext({ sessionId: 's1', matterPath: resolve(root, '逃逸') }), /越过/);
    sessions.s1.snapshotEvents = () => [sent(token(first.context))];
    additional = [casePath];
    const fromReference = await service.remoteFollowSession({ sessionId: 's1' });
    assert.equal(fromReference.source, 'reference'); assert.equal(fromReference.context.matter.path, casePath);
    // 第二个案件只通过明确附加根识别；多候选不得取第一项。
    run(resolve(scripts, 'matter.py'), 'init', '--root', shared, '--name', '另案', '--actor', 'dsh');
    additional = [casePath, resolve(shared, '另案')];
    sessions.s1.snapshotEvents = () => [];
    const ambiguous = await service.remoteFollowSession({ sessionId: 's1' });
    assert.equal(ambiguous.status, 'ambiguous'); assert.equal(ambiguous.candidates.length, 2);
    const manual = await service.remoteFollowSession({ sessionId: 's1', matterPath: casePath, matterId: args.matterId });
    assert.equal(manual.source, 'manual'); assert.equal(manual.context.matter.id, args.matterId);
    additional = [];
    const missing = await service.remoteFollowSession({ sessionId: 's1' });
    assert.equal(missing.status, 'missing');
    // 插入后材料改变，发送时也必须拒绝读取与原面板不一致的材料。
    run(resolve(scripts, 'issue.py'), 'add', '--case-dir', casePath, '--title', '新争点', '--actor', 'dsh');
    additional = [casePath];
    await assert.rejects(() => service.remoteReference(args), /案件材料已变化/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('组合核验限定语不丢失，未知限定保留原文', () => {
  const text = uiText.verificationText({ status: 'verified_as_judgment_record; original_not_seen_in_current_read; 范围待核' });
  assert.match(text, /本次读取未见原件/); assert.match(text, /范围待核/);
});

test('只取最近有效已发送引用，多案保留歧义，格式失效不猜测', () => {
  const context = { matter: { id: 'm', path: '/tmp/案件' }, state_hash: 'a'.repeat(64) };
  const valid = token(context);
  assert.equal(parseReferences(valid)[0].matterId, 'm');
  assert.deepEqual(parseReferences(valid.replace('v2:', 'v2:!')), []);
  assert.equal(latestReferences([sent('【案件引用：旧案 · ISS-0001 · 旧争点】'), sent(valid)])[0].matterId, 'm');
  assert.equal(latestReferences([sent(`${valid}\n【案件引用：另案 · ISS-0002 · 另一争点】`)]).length, 2);
  assert.deepEqual(latestReferences([{ type: 'user/message', data: { source: { kind: 'casebench-reference' }, content: [{ type: 'text', text: valid }] } }]), []);
});

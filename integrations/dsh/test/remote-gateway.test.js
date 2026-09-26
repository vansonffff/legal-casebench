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

test('真实 Typert Gateway 能读取 Core Read Model，越界 Matter 被拒绝', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'casebench-gateway-'));
  try {
    const created = spawnSync('python3.12', [resolve(scripts, 'matter.py'), 'init', '--root', root,
      '--name', '测试案件', '--actor', 'dsh'], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const ctx = new Context();
    new TypertRegistry(ctx);
    new CaseBenchService(ctx, { root, python: 'python3.12' });
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

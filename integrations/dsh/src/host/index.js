"";
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

export const name = 'legal-casebench';
export const inject = ['typert'];
export const Config = Schema.object({
  root: Schema.string().default('~/Documents/My Legal-agents'),
  python: Schema.string().default('python3.12'),
});

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const skillRoot = resolve(packageRoot, 'dist/skill');
const viewScript = resolve(skillRoot, 'scripts/casebench_view.py');
const expand = (value) => value === '~' ? homedir() : value.startsWith('~/') ? resolve(homedir(), value.slice(2)) : resolve(value);
const within = (root, path) => path === root || (!relative(root, path).startsWith('..') && !isAbsolute(relative(root, path)));

function invoke(python, command, values, signal) {
  return new Promise((done, fail) => {
    const child = spawn(python, [viewScript, command, ...values], {
      stdio: ['ignore', 'pipe', 'pipe'], signal,
    });
    let stdout = '';
    let stderr = '';
    const limit = 8 * 1024 * 1024;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > limit) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > limit) child.kill('SIGKILL');
    });
    child.on('error', (error) => { clearTimeout(timeout); fail(error); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return fail(new Error(`CaseBench ${command} 读取失败：${stderr.trim() || stdout.trim() || `exit ${code}`}`));
      try { done(JSON.parse(stdout)); } catch (error) { fail(new Error(`CaseBench ${command} JSON 无效：${error.message}`)); }
    });
  });
}

export class CaseBenchService extends TypertRemoteService {
  constructor(ctx, config = {}) {
    super(ctx, 'casebench');
    const root = expand(config.root || '~/Documents/My Legal-agents');
    const python = config.python || 'python3.12';
    this.remoteStatus = async function remoteStatus() {
      const manifest = JSON.parse(await readFile(resolve(skillRoot, 'skill.yaml'), 'utf8').catch(() => '{}'));
      return { root, coreVersion: manifest.version || '4.0.0', skillRoot };
    };
    this.remoteWorkspace = function remoteWorkspace() {
      return invoke(python, 'workspace', ['--root', root]);
    };
    this.remoteMatter = function remoteMatter(args) {
      const path = resolve(String(args?.path || ''));
      if (!args || typeof args.path !== 'string' || !within(root, path)) throw new Error('Matter 路径越过 CaseBench 工作区');
      return Promise.all([realpath(root), realpath(path)]).then(([realRoot, realPath]) => {
        if (!within(realRoot, realPath)) throw new Error('Matter 路径越过 CaseBench 工作区');
        return invoke(python, 'matter', ['--case-dir', realPath]);
      });
    };
    this.remotePracticeList = function remotePracticeList() {
      return invoke(python, 'practice-list', ['--root', root]);
    };
    this.remotePracticeShow = function remotePracticeShow(args) {
      if (!args || typeof args.id !== 'string' || !/^PN-\d{6,}$/.test(args.id)) throw new Error('Practice Note ID 无效');
      return invoke(python, 'practice-show', ['--root', root, '--id', args.id]);
    };
  }
}

export function apply(ctx, config = {}) {
  new CaseBenchService(ctx, config);
  // 4.0 Bundle 将唯一 common Skill 的组装结果注册到现有 DSH Skill Registry。
  ctx.inject(['skills'], (scoped) => {
    scoped.effect(async () => {
      const file = resolve(skillRoot, 'SKILL.md');
      const raw = await readFile(file, 'utf8');
      const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
      return scoped.skills.register({ name: 'legal-case-bench',
        description: '管理具体法律案件的共同工作台、材料、争点、成果与办案经验。',
        source: 'bundled', path: file, resourceBase: { kind: 'directory', path: skillRoot }, content: body });
    }, 'casebench: register bundled skill');
  });
}

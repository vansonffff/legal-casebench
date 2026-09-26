/** 从唯一 common 源组装 Bundle 内的 Skill 资源，不手工维护第二份。 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const target = resolve(packageRoot, 'dist/skill');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const filter = (path) => !path.split('/').some((part) => part === '__pycache__' || part === '.DS_Store') && !path.endsWith('.pyc');
await cp(resolve(repoRoot, 'skills/legal-case-bench/common'), target, { recursive: true, filter });
await cp(resolve(repoRoot, 'skills/legal-case-bench/skill.yaml'), resolve(target, 'skill.yaml'));
await cp(resolve(repoRoot, 'skills/legal-case-bench/LICENSE'), resolve(target, 'LICENSE'));
await cp(resolve(repoRoot, 'scripts/vendor/yaml'), resolve(target, 'scripts/vendor/yaml'), { recursive: true, filter });
await cp(resolve(repoRoot, 'shared/references/research-artifacts.md'),
  resolve(target, 'references/research-artifacts.md'));
await cp(resolve(repoRoot, 'scripts/vendor/PyYAML-LICENSE'), resolve(target, 'scripts/vendor/PyYAML-LICENSE'));

# Legacy Migration（Matter 迁移）

本文件面向 **Agent / 开发者**，说明迁移的状态机、事务顺序、身份生命周期与失败规则。
给人看的操作手册见仓库根目录的 `docs/MIGRATION-3.0.md`。

## 什么时候需要迁移

```text
案件目录里没有 matter.yaml，_case_state.json 是 schema_version: 3
→ 这是 legacy case，需要迁移
```

判据以**结构化数据**为准，不看目录名、不看案件叙述。完整分类见下节。

## 分类（`inspect`）

| 判定 | 含义 | 处置 |
|---|---|---|
| `LEGACY_V3` | 无 `matter.yaml`、state v3 | 正常迁移 |
| `MATTER_V4` | `matter.yaml` + state v4 且 ID 匹配 + registry v2 有条目 | 无需迁移（no-op） |
| `PARTIAL_MATTER_V3` | `matter.yaml` 已存在但 state 仍 v3 | **resume**，复用既有 ID |
| `PARTIAL_REGISTRY_V1` | Matter 与 State 已一致，registry 仍 v1 | 仅补 registry |
| `REGISTRY_ENTRY_MISSING` | Matter 与 State 已一致，registry v2 缺条目 | 仅补登记 |
| `INCOMPLETE_TRANSACTION` | journal 显示上次事务未结清 | **resume**，从断点续跑 |
| `CORRUPTED_MATTER` | `matter.id` 与 `state.matter_id` 不一致 | `MatterIdConflict` hard stop |
| `SUSPICIOUS_V4_WITHOUT_MATTER` | 无 `matter.yaml` 但 state 已是 v4 | hard stop，不自动认领 |
| `UNSUPPORTED_STATE` | state 版本不在支持范围（如 v5、v2） | `MatterSchemaUnsupported`，禁止降级 |
| `STATE_MISSING` | 有案件笔记但无 `_case_state.json` | `MatterStateMissing`，不自动创建 |
| `SOURCE_INVALID` | 不是案件目录 | hard stop |

**优先级**：只要存在**属于本案件**的未结清事务（journal），其身份校验就先做，
再谈文件层面是什么状态。顺序不能颠倒。

## 事务顺序

```text
lock(root) → lock(case)        锁顺序固定，全仓不存在反向获取
      ↓
hash preflight                 源文件是否在 plan 之后被改动（§39）
      ↓
backup（快照 + manifest）       必须先于任何写入；失败则迁移不开始
      ↓
再次确认 source hash            通过才把快照标为 valid
      ↓
resolve_plan_identity()        只解析一次
stamp_plan_time()              只盖章一次
      ↓
matter.yaml → state v4 → registry v2 → index
      ↓
post_validate(mode, 磁盘快照)   与 dry-run 同一函数
      ↓
mark complete
```

`matter.yaml` 最先写：Matter ID 的权威身份首先建立，后续所有对象围绕它收敛。

**这不是 ACID 事务**，而是**可恢复的 staged migration transaction**——
多文件写入无法做到文件系统级原子，因此靠顺序 + journal + 幂等比对保证可恢复。

## Matter ID 生命周期

```text
一个 legacy case 只能有一个 Matter ID。
```

| 阶段 | 规则 |
|---|---|
| 生成 | 只在 `--apply`；dry-run 显示 `<will-generate-on-apply>` |
| 注入 | `backfill_plan_identity()` 写入 matter.yaml / state / registry 的 matters 与 cases 镜像 / index，**四处必须同一个** |
| 落盘后 | `matter.yaml` 是唯一权威来源（§44）；resume 一律以它为准 |
| 未落盘时崩 | 复用 **journal 中已生成但未持久化的 ID** |
| 禁止 | 用旧名称/路径构造 deterministic ID（`uuid5(name)`、`hash(path)` 一律禁止） |

## journal 语义

位置：`<root>/.migration/journal-<case_dir 指纹>.json`，**每案一份**。

```json
{
  "journal_version": 1,
  "case_path": "<规范化的案件目录>",
  "matter_id": "<本次事务的 ID>",
  "started_at": "<首次事务时间戳，续跑沿用>",
  "status": "in_progress | complete",
  "legacy_identity": {"state_sha256": "...", "note_sha256": "...", "registry_entry": {...}},
  "snapshot_dir": "...",
  "snapshot_status": "valid | invalid",
  "source_hashes": {"<路径>": "<sha256>"},
  "steps": [{"name": "backup|matter_yaml|state|registry|index", "status": "pending|done|failed"}]
}
```

规则：

- **复用前必须验证身份**（`verify_journal_identity`）：`matter.yaml` 存在则以 `matter.id` 为锚；
  否则要求 state 仍是未改写的原件（sha256 匹配）；笔记哈希也参与校验。
  不匹配 → `MigrationSourceInvalid`，**绝不把旧 UUID 发给新案件**。
- **失败时保持 `in_progress`**，不写 `failed`。否则下次运行会被当作全新迁移，
  生成新 UUID 并再开一份快照。
- **`complete` 只是历史记录**，不参与普通 Matter 分类。
- **续跑沿用 `started_at`**：否则各步骤目标内容在重试间不一致，"比对磁盘现状"会永远不相等。

## 崩溃窗口与幂等比对

最经典的窗口是「写入成功、journal 尚未落盘」：

```text
atomic_write(target)   ← 磁盘已经成功
      ↓  崩溃
save_journal(done)     ← 尚未执行
```

续跑**不盲信 journal**：每步先跑 `step_matches()` 把磁盘现状与目标内容比对，
相等则补记 journal（标 `recovered: true`）并跳过；只有确实不一致才写。

## snapshot 语义

位置：`<root>/.migration/matter-v1-<stamp>-<case 指纹>/`。

`<stamp>` 自 3.2.2 起为 **UTC**（`<YYYY-MM-DDTHHMMSSZ>`）；3.2.1 及更早为本地偏移。
旧缺陷曾把 UTC+08:00 错写成 UTC−08:00（相差 16 小时）。两种命名**允许并存**：
旧快照不改名（journal 按绝对路径引用）。因此**不要按目录名解析或排序时间**，
一律读 manifest 的 `created_at`。

> 3.2.1 及更早用 `.replace("+", "-")` 把 `+0800` 写成了 `-0800`，而 `-0800` 在 ISO-8601 里
> 表示 UTC−8，与真实偏移差 16 小时。快照时间是系统事务 metadata，改用 UTC 后
> 跨时区稳定、排序稳定、无转义歧义。权威时间始终是 `manifest.created_at` 与 journal 的 `started_at`。

manifest 记录**全部 mutation target**（含迁移前不存在的 `matter.yaml`、`_INDEX.md`）：

```json
{"role": "matter.yaml", "original_path": "...", "preexisting": false,
 "backup_path": null, "sha256": null}
```

- `snapshot_status` 初始为 `invalid`；只有备份完成**且**二次 hash 通过才升为 `valid`。
  备份窗口内源文件发生变化 → 标 `invalid`，**不得**作为可信恢复点。
- **快照不是灾备**：它与案件工作区同处一个存储介质，只防迁移失败，不防磁盘损坏。

## Registry 权威性

```text
Registry v2
  ├── matters[]    ← authoritative
  └── cases[]      ← legacy compatibility projection，由 matters 派生
```

读取方在 v2 下一律只信 `matters[]`；写入方只有一条逻辑：更新 `matters[]` → 派生 `cases[]`。
v2 下带 `matter_id` 的镜像条目**不参与条目匹配**（否则同一案件会被匹配两次而误判歧义）。

## 失败规则

| 情形 | 行为 |
|---|---|
| 身份冲突 / 可疑 v4 / 版本越界 / 缺 state | hard stop，零写入 |
| `plan` 之后源文件变化（含备份窗口内） | `MigrationSourceChanged`，零写入 |
| 备份失败 | `MigrationBackupFailed`，迁移不开始，不留 journal |
| 某步骤写失败 | 停下、报告精确 partial 状态、**不自动回滚**、可续跑 |
| 凭据样式字段 | `MatterCredentialLeak`，原样抛出（不包装成可续跑中断） |

**不是"尽量继续"**：任何一步失败都停下来，并把"停在哪、备份在哪、如何恢复"说清楚。

## 数据保留底线

- `facts`：零重写（不重编号、不重分类、不清洗、不补 `matter_id`）；
- `research_artifacts` / `analysis_artifacts`：零重写（Matter-aware 排在 3.3 / 3.4）；
- `00-案件笔记.md`、`01-过程稿/`、`02-定稿/`：**字节级不变**；
- 未知字段（顶层与 Issue 内）一律保留；
- Issue 按**原数组顺序**分配 `ISS-NNNN`，已有合法 ID 不动，非法值移入 `legacy_issue_id`；
- `sequences` 取历史最大值，**只增不减**（序号是 monotonic sequence，不是 compact index）。

## 分类不推断

迁移**不猜**案件类型、正式角色、程序阶段与 Module：

```yaml
matter: {type: unclassified}
engagement: {role: unknown}
procedure: {kind: unknown, stage: unknown}
modules: []
jurisdiction: {country: null, province: null, city: null, court: null}
```

`null` 就是 unknown。不因为"目前主要做中国法律工作"就把未知写成 `CN`。

## 测试与审计脚本

> **这些命令只在开发仓中可用。** 已安装副本（各 harness 的 `skills/legal-case-bench/`）
> 与公开脱敏镜像**都不包含 `tests/` 目录**——下面列出它们是为了说明迁移行为由哪些测试锁定，
> 不是让使用者去运行。跑之前请先确认所在目录是开发仓。

```bash
python3.12 -m unittest tests.test_state_migration            # 纯函数契约（33 项）
python3.12 -m unittest tests.test_matter_migration           # 计划与分类（49 项）
python3.12 -m unittest tests.test_migration_transaction      # 事务与故障注入（27 项）
python3.12 tests/audit-matter-migration-boundary.py          # 对抗矩阵（14 场景）
python3.12 tests/audit-matter-migration-rehearsal.py         # 真实案件 fixture 演练
```

真实案件 fixture 演练使用**私有案件数据**，不在任何公开镜像中；公开镜像亦不含测试套件。
本节描述的行为保证来自开发仓的完整测试，使用者无需（也无法）自行复现。

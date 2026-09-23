# CaseBench 3.0 — 旧案迁移操作手册（MIGRATION-3.0）

> 面向**使用者**。技术细节（状态机、journal、快照语义）见
> `skills/legal-case-bench/common/references/matter-migration.md`。

## 这份文档解决什么

CaseBench 3.0 引入了 Matter Architecture：每个案件有一个稳定的 Matter ID，
写在 `matter.yaml` 里，并与 `_case_state.json`、`_registry.json` 一一对应。

**2.x 时代的旧案件不会失效**，也不需要立刻迁移。迁移只做一件事：

> 让旧案件安全地获得一个 Matter ID。

它**不会**改动案件笔记、事实、成果登记与原始材料。

## 什么时候需要迁移

| 情况 | 需要迁移吗 |
|---|---|
| 案件目录里没有 `matter.yaml`，state 还是 `schema_version: 3` | 需要 |
| 已经有 `matter.yaml`，state 是 v4 | 不需要（再跑会提示 `not needed`） |
| 不确定 | 先跑一次 dry-run，它会告诉你 |

## 迁移五步

### 第〇步：先备份（独立介质）

> ⚠️ **正式 `--apply` 之前，把整个案件工作区根目录复制到另一块磁盘或可靠的云端。**

迁移事务会自动建快照（见下文"快照在哪里"），但快照与案件工作区在
**同一存储介质**上，只防迁移失败，不防磁盘损坏、误删除等事故——**快照不是灾备**。
迁移流程在作者环境已通过完整测试（含中断恢复与幂等演练），但你的案件数据只有一份，
备份这一分钟值得花。

```bash
cp -R ~/办案工作区 /path/to/另一块磁盘/办案工作区-backup-$(date +%Y%m%d)
```

### 第一步：dry-run（只预览，不写任何东西）

```bash
python3.12 skills/legal-case-bench/common/scripts/matter.py migrate \
  --case-dir "/path/to/case" --actor dsh
```

**不带 `--apply` 时永远是 dry-run**，这是默认行为。

输出会分成几块，请重点看后两块：

```text
Matter name candidates:      三个来源（state / registry / 目录名）与最终采用值
Matter ID:   <will-generate-on-apply>
  intent: generate-on-apply（--apply 时生成一次）
State:       v3 → v4

WILL CREATE:     将新建哪些文件
WILL MODIFY:     将改动哪些文件
WILL PRESERVE:   将原样保留多少 facts / issues / 成果登记
WILL NOT TOUCH:  明确不会碰的东西
WARNING:         需要你判断的提示
ERROR:           有错就不会继续
```

### 第二步：怎么看 WARNING

WARNING 不阻止迁移，但每一类都值得看一眼：

| WARNING | 含义 | 要不要处理 |
|---|---|---|
| `matter.type → unclassified` 等四条 | 迁移**不猜**类型、角色、程序阶段、Module | 需要时迁移后在 `matter.yaml` 里补 |
| `legacy name sources disagree` | 三个来源的案件名不一致，已按优先级选择 | 看一眼 `SELECTED:` 是否接受，不接受就迁移后改名 |
| `Registry 仍为 v1 → will upgrade to v2` | 登记表将升级 | 正常 |
| `issues[n] 缺少 title，且 question/issue 均为空` | 该争点没有任何可用的标题来源 | 迁移后手工补 |
| `issues[n].issue_id 格式非法（'I-001'）…` | 旧编号不合法，将另分配 `ISS-NNNN`，**原值保留在 `legacy_issue_id`** | 正常，lineage 不丢 |
| `Registry entry missing → will create Registry v2` | 登记表里找不到该案 | 正常，会新建条目 |

### 第三步：正式迁移

```bash
python3.12 skills/legal-case-bench/common/scripts/matter.py migrate \
  --case-dir "/path/to/case" --apply --actor dsh
```

**`--apply` 是唯一的写入口。** 执行时：

1. 取工作区锁与案件锁；
2. 再次确认源文件没有被别人改过（改过就停下，让你重新 dry-run）；
3. 建立快照（先于任何写入）；
4. 按固定顺序写入：`matter.yaml` → `_case_state.json` → `_registry.json` → `_INDEX.md`；
5. 用磁盘上的真实结果做一次完整校验；
6. 写一份迁移审计报告。

### 第四步：校验

```bash
python3.12 skills/legal-case-bench/common/scripts/matter.py validate \
  --path "/path/to/case"
```

期望 `"status": "valid"`，`warnings` 为空。

### 第五步：确认幂等

```bash
python3.12 skills/legal-case-bench/common/scripts/matter.py migrate \
  --case-dir "/path/to/case" --actor dsh
```

应当输出 `Migration not needed`，**且 Matter ID 与第一次完全相同**。
这一条很重要：它证明没有生成第二个身份。

## 怎么读迁移报告

每次 `--apply` 都会自动写一份报告到：

```text
<案件工作区根>/.migration/reports/matter-migration-report-<案件名>-<日期>.md
```

它属于**系统迁移 metadata**，不是律师工作成果，所以**不放进 `02-定稿/`**。

用 `--report <路径>` 可以改落点（`.json` 结尾则输出 JSON）。

报告内容：

```text
Matter ID               本次确立的稳定身份
State v3 → v4           状态版本变化
Name: 旧名 → Matter 名   以及名称来源是否冲突
Registry schema v2      是否已登记、matters/cases 计数
Backup: <快照路径>       迁移前的 metadata 快照
数据计数                 facts / issues / pending / 成果登记 / reviews
校验                     validate 结果
Warnings                 与 dry-run 一致的提示
```

## 遇到 incomplete transaction 怎么办

如果迁移中途失败（例如磁盘满、权限问题），你会看到：

```text
迁移在步骤 registry 失败，事务已停在可恢复状态（未回滚）。
Matter ID: <...>（已确立的身份不会被丢弃，续跑时复用）
失败步骤：registry
原因：...
快照目录：...
完整恢复步骤（逐项执行）：...
```

**处理方式：修掉原因，然后原样重跑同一条命令。** 事务会从断点续跑，不会重新生成 ID，
也不会再建第二份快照。已经成功的步骤会被识别为"已应用"并跳过。

再次运行若提示 `MigrationSourceInvalid` 且说"未结清的迁移日志与当前案件不匹配"，
说明这个目录已被换成另一个案件。此时**不要**强行复用旧 ID，请联系维护者人工处理。

## 快照在哪里、怎么人工恢复

快照在 `<案件工作区根>/.migration/matter-v1-<时间戳>-<案件指纹>/`，
里面的 `manifest.json` 记录了本次事务会动到的**每一个文件**：

```json
{"role": "_case_state.json", "original_path": "...", "preexisting": true,
 "backup_path": "...", "sha256": "..."}
```

> **时间戳的两种写法都正常，不用管它。** 3.2.2 起新快照用 UTC（`<YYYY-MM-DDTHHMMSSZ>`），
> 更早的是本地偏移。旧快照按原样保留、不改名。
> **想知道快照的真实时间，看 `manifest.json` 里的 `created_at`**——
> 那是权威时间；目录名只是标签（3.2.1 及更早的目录名里那个偏移是错的，差 16 小时）。

人工恢复步骤（`restore_guidance()` 也会打印）：

```text
preexisting = true   → 用 backup_path 的文件覆盖回 original_path
preexisting = false  → 删除 original_path（迁移前它不存在）
```

**第二行是关键**：`matter.yaml` 与 `_INDEX.md` 在迁移前通常不存在，
恢复时必须**删除**，否则"回到迁移前"并没有真正做到。

注意事项：

- 系统**不提供** `matter.py migrate --rollback`。迁移完成后 Matter ID 已经确立，
  回滚会丢弃可能已被笔记、成果或其它 harness 引用的身份。
- 快照的 `snapshot_status` 必须是 `valid` 才可作为可信恢复点。
  若显示 `invalid`，说明备份窗口内源文件被改过，该快照不是一致视图，**不要用它恢复**。
- **快照不是灾备**：它与案件工作区在同一存储介质上，只防迁移失败，
  不防磁盘损坏。真正的灾备需要独立介质（见"第〇步"）。

## 常见问题

**Q：迁移会不会改我的案件笔记和材料？**
不会。笔记、`01-过程稿/`、`02-定稿/` 保持**字节级不变**；`facts` 与成果登记原样保留。

**Q：旧的事实和争点编号会被重排吗？**
不会。`facts` 零重写；Issue 只在**没有合法 ID** 时才分配 `ISS-NNNN`，且按原数组顺序，
已有合法 ID 一律不动。

**Q：迁移会不会顺手把旧案整理一遍？**
不会。迁移只建立身份和升级结构，不做数据清洗、不重命名目录、不推断案件类型。

**Q：可以一次迁移多个案件吗？**
不建议。逐案迁移：`备份 → dry-run → 看 Plan → --apply → validate → 再跑一次确认 not needed`。
多案并发时，后提交的那次会因为共享的 `_registry.json` 已变化而停止，
需要重新 dry-run——这是有意的保护，不是故障。

**Q：迁移后能用旧版本的 CaseBench 打开吗？**
不能保证。Matter Architecture 是 3.0 的架构基线，请使用 3.0 及以上版本。

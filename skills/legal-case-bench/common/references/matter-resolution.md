# Matter Root Resolution

## 规则

从给定目录或当前工作目录开始，逐级向父目录查找 `matter.yaml`：

1. 如果输入是文件，先从其父目录开始；输入为 `matter.yaml` 时直接使用其父目录。
2. 当前目录存在 `matter.yaml` 时停止；它必须是普通文件，不能是符号链接。
3. 没有找到时向父目录移动，直到配置的 workspace root 或文件系统根目录。
4. workspace root 不是当前目录祖先时，直接报错，不跨越边界猜测。
5. 找到最近的候选后立即校验 Matter Contract；文件存在但无效时报告 `MatterInvalid`，不得跳过它继续使用更高层目录。
6. 不根据案件目录名、`case_name`、Registry 名称或 Harness Workspace ID 推断 Matter。

## 身份预检

解析出 Matter Root 后，调用方应读取并校验 `matter.yaml`。如果 `_case_state.json` 已经有 `matter_id`，它必须与 `matter.id` 相同；不一致是 `MatterIdConflict`，必须停止而不是选择其中一个。

schema v3 的存量旧案没有 `matter_id`，这是**正常的 legacy 状态，不是损坏**：读取侧只记兼容性提示，写入侧报 `LegacyMatterNeedsMigration`。要把它纳入 Matter 托管，用 `matter.py migrate` 升级为 v4；迁移完成前它不参与 Matter 解析。不得用目录名、`case_name` 或 Registry 名称替它补一个 `matter_id`。

> 注意区分三种“没有 `matter_id`”：**schema v3** = 未迁移的旧案（正常）；
> **schema ≥ 4 但缺 `matter_id`** = 损坏的 Matter 状态，拒绝处理；
> **有 `matter_id` 但无 `schema_version`** = 版本无法确认，拒绝处理。

## API

公共实现位于：

```text
common/scripts/matter_io.py
```

典型调用：

```python
root = resolve_matter_root(Path.cwd(), workspace_root=workspace_root)
matter = load_matter(root)
warnings = validate_matter(root)
```

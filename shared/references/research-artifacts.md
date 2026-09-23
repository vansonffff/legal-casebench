# 案件检索成果共享协议

本协议适用于与具体案件有关的全部法律检索和类案检索。无论从 WorkBuddy、myagents 还是 Codex 发起，只要检索与已登记案件有关，就必须落入该案件共同工作区；对话中的检索结论不能替代落盘成果。

## 目录

```text
<案件>/01-过程稿/<法律检索或类案检索-NNN>/
  00-执行说明.md
  research-manifest.json
  10-中间转换/raw/{ima,yuandian,official-web,paid-db}/
  20-过程稿/{检索报告.md,law-results.json,case-results.json}
  30-复核/
```

使用 `legal-case-bench/scripts/research_artifact.py init` 建立目录；检索编号包含类型、日期和序号，避免法律检索与类案检索撞号。检索完成后使用同一脚本 `finalize` 校验并登记。不要自行发明平行目录。

## 检索顺序与来源性质

1. 先检索 IMA 中的个人知识材料，提取关键词、既有研究和内部线索。
2. 再使用元典统一 MCP 与官方来源核验规范、案例身份和裁判全文。
3. 用户点名或公开来源不足时，可使用具备健康能力的 WebBridge 查询付费数据库；该来源只作补充，不能替代现行法效力或案例原文核验。
4. IMA 或付费数据库未接通时，在 `sources_used` 中记录 `status: not_available`，继续核验其他权威来源；不得声称已查询该来源。
5. 同时寻找支持、反对和边界材料；未发现只能表述为“本次检索条件下未发现”。

## 必备文件

### `research-manifest.json`

至少包含：`research_id`、`case_name`、`question`、`research_type`、`applicable_date`、`cutoff_date`、`queries`、`sources_used`、`artifact_paths`、`created_at`、`harness`、`model_profile`、`verification_status`、`sha256`。`sources_used` 可使用 `ima`、`yuandian`、`official-web` 和 `paid-db`；付费库记录 `provider`、`database_name`、`status`、`retrieved_at` 等元数据。

### `law-results.json`

每条规范至少记录：名称、制定机关、文号、条款、效力状态、适用日期、检索日期、来源层级、原文位置、官方链接或元典记录 ID、核验状态和支持/反对/边界方向。没有结果时保存空数组，不删除文件。

### `case-results.json`

每个案例至少记录：案例名称、案号、法院、裁判日期、案例身份、全文核验状态、相关事实、法院说理、裁判结果、支持/反对/边界方向、来源链接或元典记录 ID。未读裁判全文时必须标注 `fulltext_verified: false`，不得根据摘要补写事实或说理。

### 原始响应

- 保存检索条件、时间和去凭据后的原始响应。
- 禁止保存 Authorization、API Key、Cookie、Token、Secret 或其他凭据。
- 使用 `research_artifact.py save-raw` 保存 JSON 响应；官方网页快照可保存为 Markdown，但同样必须去除敏感信息。`paid-db` 由脚本强制裁剪为脱敏的库名、页面标题、URL、检索式、检索日期、短摘要和核验状态，并同步更新 `sources_used` 元数据，不保存整页内容。WebBridge 不可用且没有原始响应时，使用 `research_artifact.py record-source --source paid-db --status not_available` 留痕。`finalize` 会复检整个 `raw/`，发现未脱敏认证片段时拒绝登记。

## 复用与时效

其他 harness 复用前核对检索问题、案件适用时点、检索截止日、核验状态和文件哈希。历史结果只作线索；现行法、程序期限和其他动态信息在正式引用前重新核验。检索成果发生变化后，引用旧哈希的分析自动视为需要复核。

## 案件笔记与状态

完整材料留在任务目录；`00-案件笔记.md` 只追加检索结论摘要、主要风险和成果相对路径。`_case_state.json.research_artifacts[]` 只保存指针，不复制大段检索内容。

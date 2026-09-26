# 共同案件工作台协议

共享根为 `~/Documents/My Legal-agents`。各 harness 读写同一案件事实层，但不共享完整聊天、临时上下文、模型缓存或凭据。

## 案件结构

```text
<工作区根>/
  _registry.json          # 全部 Matter 的登记：matters[] 权威，cases[] 派生镜像
  _INDEX.md               # 总索引
  _practice/               # 用户确认后沉淀的跨案办案经验；仅供 Recall

<案件名>/                  # = Matter Root（含 matter.yaml 的目录）
  matter.yaml             # Matter Contract v1：身份与稳定属性（matter.id / type / role / stage）
  _case_state.json        # 结构化事实与成果索引（State v4，含 matter_id）
  00-案件笔记.md           # 按日期追加的叙事层
  01-过程稿/
    <任务名-NNN>/
      00-执行说明.md
      10-中间转换/
      20-过程稿/
      30-复核/
  02-定稿/
```

`matter.yaml` 是案件的身份锚点；`00-案件笔记.md` 是按日期追加的叙事层，记录案情脉络、策略取舍、用户指示、阶段结论、待办及成果路径；`_case_state.json` 是结构化事实和成果索引。三者互补，任何结构化数据都不得替代案件笔记。

## 开工流程（Matter-first）

任何任务开始前按此顺序解析，**不得跳步，也不得根据目录名、`case_name` 或 Registry 名称推断 Matter**：

```text
Resolve Matter      从当前目录逐级向上查找 matter.yaml（规则见 references/matter-resolution.md）
      ↓
load matter.yaml    校验 Matter Contract，取得 matter.id 与 type / role / stage
      ↓
validate matter_id  `_case_state.json`.`matter_id` 必须等于 `matter.id`；不一致是 MatterIdConflict，停止
      ↓
load state          facts / issues / pending_items / 成果索引
      ↓
load notes          00-案件笔记.md 末尾
      ↓
执行任务            优先复用已有产物
```

- **没有 `matter.yaml` 的目录**：可能是未迁移的存量旧案（State v3），也可能根本不是案件目录。
  旧案按 v3 读写，需要纳入 Matter 托管时用 `matter.py migrate`；**不得新建一个 `matter.yaml` 伪造身份**。
- **`matter.yaml` 存在但无效，或与 state 身份冲突**：停止并报告，不继续执行任务。

## 共同行为

1. 先按上方 **开工流程** 完成 Matter 解析，再读取案件笔记末尾、结构化状态和现有成果索引，优先复用已有产物。
2. 原始材料目录只读；过程稿、OCR、抽取表、检索响应和专项分析只写共同工作区。
3. 新事实必须标明材料性质、来源文件与页码或条款；模型推断不得伪装成材料记载。
4. 已授权范围内的读取、转换、检索、初稿和共同工作区写入可自主执行；回写缓存、上云、发布或其他对外动作前列出目标并核验授权。
5. 用户删除的文字不恢复；已交付或可能被手工修改的文件默认另存新版本，明确授权才覆盖。
6. 案号、法条状态、金额、日期和主体名称必须回源；未核验写明“未核验到”或“本次条件下未发现”。
7. 与案件有关的法律或类案检索必须遵守 `references/research-artifacts.md`。
8. 普通案件问答产生新事实线索、用户口径、策略结论、风险或待办时，按 `references/case-notes.md` 在最终回复前追加案件笔记；不把完整回答复制进笔记。
9. 4.0 可选的 Proceeding、Authority Reference、Final Artifact 仍写入同一个 State v4；经验沉淀须用户明确确认，历史经验进入新案前重新联网核验。详见各专项 reference。

## 案件强度

`case_tier` 仅由用户指定：`routine`、`complex`、`critical`。不根据 harness、模型、材料数量自动判断，也不限制 WorkBuddy 使用 K3 独立办结。

- `routine`：来源核验、事实自查、交付一致性检查。
- `complex`：在 routine 基础上加强主办自查和完整结构化状态；独立复核仍须用户明确指令。
- `critical`：加强论证、事实一致性和终审自查；反锚对抗复核仍须用户明确指令。

所有档位的外部写入均须授权。

## 材料与版本

- A 级实质材料：将被引用的合同、证据卷、聊天记录、对账单、判决书等；提取或 OCR 后保留完整溯源件。
- B 级程序材料：身份证、委托书、送达确认等；只提取所需字段并标低置信项。
- C 级临时件：不保留。
- 表格密集的银行流水、对账单和明细表使用高精度表格 OCR；关键金额须异引擎或原图复核。

## 状态写入

共享状态只能通过 `scripts/state_update.py` 的 `snapshot` 与 `commit` 更新。各 harness 使用同一锁和哈希预检；哈希变化即停止，不强制覆盖。详细字段见 `references/state-contract.md`。

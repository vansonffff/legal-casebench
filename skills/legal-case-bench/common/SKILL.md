---
name: legal-case-bench
description: 管理具体法律案件的共同工作台，负责建案、案件笔记、材料读取、检索成果落盘、事实与争点状态、复核、版本和定稿。用户提到某案材料、案件简介、材料通读、法律或类案检索、起草本案文书、复核或定稿时使用。
---

# 法律案件工作台

本技能在 WorkBuddy、myagents、Codex、DSH 使用同一套入口、法律规则、目录协议和状态脚本，不根据平台或模型自动改变案件强度与质量标准。

每次先读取：

1. `references/core-workflow.md`
2. `references/runtime.md`
3. `references/state-contract.md`

按任务渐进读取：

- 建案或首次了解案件：`references/case-init.md`、`references/material-reading.md`。
- 设置或核对案件分类属性（`type` / `role` 等）：`references/matter-vocabulary.md`。
- 具体案件问答、用户指示或策略讨论：`references/case-notes.md`。
- 法律或类案检索：`references/legal-research-ladder.md`、`references/yuandian-mcp.md`、`references/research-artifacts.md`。
- Word、PDF 或正式文件交付：`references/doc-generation-workflow.md`。
- 多程序案件、开庭节点：`references/proceedings.md`。
- 登记本案法条、案例：`references/authority-references.md`。
- 登记 `02-定稿/` 的正式文件：`references/final-artifacts.md`。
- 重要检索/分析后的经验建议、用户确认保存或在当前案件复用历史经验：`references/practice-library.md`。
- 破产资产负债、清偿或财务测算：`references/bankruptcy-data-rules.md`。
- 用户明确要求独立复核，或需要定稿自查：`references/quality-gates.md`、`references/finalize.md`。
- 重要结论交付前完整自查：`references/standing-questions.md`。

平台聊天、任务记录和模型缓存不是共同事实源。需要跨平台复用的内容必须写入共同案件工作区。

明确属于某个已登记案件且本轮产生可复用信息时，必须在最终回答前追加案件笔记；案件不明确或没有新增价值时不写。

独立复核完全由用户手动触发。不得因为案件复杂、`case_tier`、质量门、存在其他代理产物或准备定稿而自动派遣复核代理；起草、自查和独立复核必须分开标识。

CaseBench 4.0 的 `proceedings`、`authority_refs`、`final_artifacts` 和 `_practice/` 均为增量能力。旧 Matter 不因读取而迁移。办案经验仅供回忆；当前案件使用历史法条或案例前必须重新联网核验。Agent 可建议沉淀，只有用户明确确认该项经验后才能运行 `practice.py promote --confirmed-by-user`。用户已明确要求保存该项经验时直接执行，无须重复询问；仅提出建议或用户未答复时不写经验库。

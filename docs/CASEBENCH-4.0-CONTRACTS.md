# CaseBench 4.0 Phase 0 契约冻结

> **状态：设计契约冻结；实现待后续阶段验收。** 本文约束 4.0 首版的数据语义和范围，不宣称 schema、validator、CLI、Practice 工具或 DSH UI 已完成。
> 现有兼容基线维持 Matter Contract v1、State v4、Registry v2。4.0 新字段以可选方式加入 State v4；旧 Matter 不要求批量迁移。

## 1. Proceedings Contract v1

### 定义

Proceeding 是 Matter 下具有独立程序身份、案号或诉讼位置的具体案件。Matter 仍是律师持续处理的一项完整法律事务；Proceeding 不拥有独立 Matter ID，也不在 Registry 单独登记。

一个 Matter 可以有零个、一个或多个 Proceeding。没有 `proceedings` 字段的 3.2.8 Matter 仍然合法。普通单案（零个或一个）在 UI 中不暴露 Proceeding 技术术语；多个 Proceeding 以系列案件形式展示。

### 数据形状

State v4 可选字段：

```json
{
  "proceedings": [
    {
      "proceeding_id": "PROC-0001",
      "name": "某合同纠纷一审",
      "case_number": "（2026）沪01民初123号",
      "kind": "litigation",
      "stage": "first_instance",
      "status": "active",
      "court": "某人民法院",
      "parties": [
        { "name": "甲方", "role": "plaintiff" },
        { "name": "乙方", "role": "defendant" }
      ],
      "events": [
        {
          "event_id": "EVT-0001",
          "type": "hearing",
          "at": "2026-10-12T09:30:00+08:00",
          "location": null,
          "status": "scheduled"
        }
      ]
    }
  ]
}
```

- `proceeding_id` 在 Matter 内稳定，形式为 `PROC-0001`；`event_id` 形式为 `EVT-0001`。由 State sequence 高水位分配，删除后不回收。
- `case_number`、`court`、`parties`、`events` 可以因资料尚未取得而为空或缺省，不根据文件名猜补。
- `kind`、`stage`、`status`、party `role`、event `type` 与 event `status` 为字符串；示例 token 不构成完整封闭枚举。读取方保留未识别值，不静默改写。
- `events[].at` 使用带时区偏移的 ISO 8601 日期时间；没有可靠具体时间时不得虚构。
- 4.0 首版不定义 Proceeding 关系字段，包括 `appeal_of`、`related_to`、`enforcement_of`，不绘制关系图。

### 写入与职责

新增或修改 Proceeding 时仍须校验 `matter.yaml.matter.id` 与 State `matter_id` 一致；所有 State 写入经统一 identity precheck、mutation/commit、stale 检查和原子写入路径。新字段增量写入必须保留未知字段。旧 Matter 不自动补写 `proceedings: []`。

Proceeding Event 表示程序事件（如开庭），不等于 Pending Item，也不连接 Calendar 或 To Do。Proceeding 不代替 Matter 身份、State 的 facts/issues/artifacts 或 `00-案件笔记.md` 的叙事历史。

## 2. Authority Reference Contract v1

### 定义

`authority_refs[]` 记录当前 Matter 使用或评估的法条或案例，以及与该 Matter 有关的核验信息。它回答“本案引用了什么、核验到了什么”，不替代 Research Artifact，也不承载通用办案经验。

State v4 可选字段。缺省的旧 Matter 继续合法，不批量迁移。标识在 Matter 内稳定，采用 `AREF-0001` 形式，由对应 sequence 高水位分配且删除后不回收。

### 法律规范记录

```json
{
  "authority_ref_id": "AREF-0001",
  "type": "statute",
  "title": "中华人民共和国民法典",
  "locator": "第八百零七条",
  "verification": {
    "status": "verified",
    "verified_at": "2026-09-25T18:00:00+08:00",
    "source": "可回查的正式来源"
  }
}
```

### 案例记录

```json
{
  "authority_ref_id": "AREF-0002",
  "type": "case",
  "case_number": "（2025）沪01民终123号",
  "court": "某人民法院",
  "decision_date": null,
  "proposition": "本案引用时关注的裁判要点",
  "verification": {
    "status": "unverified",
    "verified_at": null,
    "source": null
  }
}
```

- `type` 区分 `statute` 与 `case`。前者记录规范名称和条文定位；后者记录案号、法院、可得的裁判日期及本案关注的 `proposition`。
- `verification` 必须能区分已核验与未核验状态。只有有可回查来源和核验时间时，才可写 `verified`；具体状态枚举由实现阶段的 schema 固化。
- 不确定的案号、法院、日期、法条定位或来源应留空或标为未核验，不得根据模型记忆补成已核验信息。

### 核验与跨 Matter 边界

`verified` 仅表示相应来源信息已核验，不自动证明其对当前 Matter 有利、可比或适用。正式使用前仍须分析效力、裁判内容、事实差异与具体适用性。历史核验时间不替代新 Matter 中的重新核验。

`authority_refs[]` 是 Matter 局部引用；跨 Matter 复用的外部依据属于 `_practice/authorities/` 下的 Practice Authority。两类数据不得仅凭名称自动合并。`proposition` 只记录本案使用该案例时关注的裁判要点；一般化认识进入经用户确认的 Practice Note。

## 3. Practice Library Contract v1

### 定义与目录

Practice Library 是跨 Matter 的、经用户确认的个人办案经验库。它只承担 Recall（提示过去研究过什么），不承担当前法律依据的 Validation。

```text
<CaseBench Root>/
└── _practice/
    ├── _index.json
    ├── authorities/
    │   └── AUTH-000001.yaml
    └── notes/
        └── PN-000001.md
```

CaseBench Root 继续由工作区 Registry 确定。`_practice` 不改变既有 Matter 身份或 State，不建立第二套案件数据库。

### Practice Authority

Practice Authority 登记外部法律依据，回答“依据是什么”，使用 YAML 文件及稳定 `AUTH-000001` 标识。案例以标准化案号识别；法律规范以规范名称和条文定位识别，并记录可核验来源及核验时间。首版只做明确的精确规范化，不做 AI 模糊合并；无法确定是否重复时允许并存，不擅自合并。

Practice Authority 是工作区级外部依据登记，与 Matter 的 `authority_refs[]` 不同。重复依据可以被 Matter 引用，不会自动把跨案经验写进 Matter。

### Practice Note

Practice Note 用 Markdown 正文承载可读的办案认识，并在 metadata 中保留稳定 `PN-000001` 标识、标题、来源 Matter ID、相关 Issue/Artifact 引用、关联 Practice Authority ID、创建时间和更新时间。正文可以说明办案认识、形成理由、适用边界和来源；不要求全部结构化。metadata 的精确 schema 在 Phase 1/4 实现时固化。

### 用户决定与复用

- Agent 只在正常 Research/Analysis 工作节点发现可能有长期价值时提出建议；不得后台监听聊天或自动写库。
- 只有用户明确确认后才执行 promote，生成 Practice Note 和必要的 Practice Authority。
- 本案独有事实、未核验推断、临时检索、未形成结论的讨论、普通常识或明显重复内容通常不建议沉淀。
- 已保存 Note 独立于聊天记录；删除聊天不删除正式保存的 Note。
- 在新 Matter 中正式使用历史法条或案例前，重新核验规范/案例真实性、当前效力、来源、事实可比性与适用性。无法联网核验时只作为历史线索，不得标成当前已核验依据。
- 4.0 首版 UI 只读。Note 修改通过用户自然语言要求 Agent 更新，不提供富文本编辑器。

### 索引与排除项

`_index.json` 是 Practice 文件的索引，不取代 Authority 或 Note 原件。索引损坏或数据无法解析时，后续实现应明确报告，不得凭索引重建并覆盖原件。

首版不加入向量数据库、Embedding、RAG、知识图谱、自动经验抽取、AI 模糊合并或跨 Matter 自动关系。

## 4. 共同写入与兼容不变量

以上三个新契约不改变 Matter Contract v1、State v4、Registry v2 的身份与权威边界。新字段采用可选增量演进；不对旧 Matter 批量迁移，不因工作台读取而写回 State。

任何新 State 写入都必须经过 Matter ID 一致性 hard stop、统一 mutation/commit、并发 stale 保护和原子写入，并保留所有未知字段。目录名、DSH Workspace ID、Registry 展示名称均不能替代 Matter ID。

## 5. Core / DSH 边界

- **CaseBench Core：** 定义并写入 Proceeding、Authority Reference、Final Artifact、Practice 数据，计算统一 Read Model，保持跨 Agent 独立可用。
- **DSH Integration：** 配置工作区，注册“案件工作台”，调用 Core Read Model 展示数据；只写入 UI 配置，不拥有案件数据库。
- **不做：** 工作台直接编辑 Matter、后台 watcher、Calendar/To Do、自动案件识别、向量/RAG、案件健康评分、Proceeding 关系图、自建文档预览器。

## 6. 实现状态边界

本文件是 Phase 0 的设计冻结记录，不作为任何代码、schema、测试、发布包、插件安装或运行时能力已完成的证据。各项功能只有在对应阶段实现并通过验收后，才能更新为已交付。

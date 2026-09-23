# Matter 词汇表（canonical vocabulary）

本文件是 `matter.yaml` 中**分类字段的规范 token 登记表**。它回答一个问题：
「这个字段允许写什么值」。

为什么需要它：这些字段不只是给人看的标签，下游（DSH Profile / Perspective Match）要
**按 token 精确匹配**。同一个概念如果写成 `administrator` / `admin` / `管理人` / `manager`
四种样子，匹配就会失效——而且失效是静默的，插件只会"匹配不上"，不会报错。

因此规则是：

> **展示层可以翻译，Contract 层只写规范 token。**
> 给人看时可以把 `administrator` 显示成"管理人"；
> 写进 `matter.yaml` 的只能是 `administrator`。

## `matter.type`

已在 `matter.schema.json` 与 `matter_io.py` 中冻结为死枚举：

```text
litigation        诉讼
bankruptcy        破产
non-litigation    非诉
other             其他
unclassified      未分类（默认值；表示尚未判断，不是"其它"）
```

## `engagement.role`

表示**我们代表谁**。自 3.2.4 起冻结。

任何 type 都允许的兜底值：

```text
unknown           未知
other             其他（明确不属于下列任何一类）
```

### type = `litigation`

```text
plaintiff                  原告
defendant                  被告
third-party                第三人
appellant                  上诉人
respondent                 被上诉人
applicant                  申请人
respondent-to-application  被申请人
```

### type = `bankruptcy`

```text
administrator              管理人
debtor                     债务人
creditor                   债权人
investor                   投资人
restructuring-advisor      重整顾问
```

### type = `non-litigation`

```text
debtor                     债务人
creditor                   债权人
investor                   投资人
restructuring-advisor      重组顾问
```

非诉沿用破产的**经济地位**角色，但**不含 `administrator`**：
管理人是法院指定的职务，只在正式破产程序中有意义，非诉场景下没有这个身份。

> 这一组是依据真实案件补上的：在一宗非诉债务重组案件中我方是债务人，
> 原先"只允许 `unknown` / `other`"的设定无法表达，属于词汇表过窄。

### type = `other` / `unclassified`

只允许 `unknown` 与 `other`。

`unclassified` 表示**尚未判断**，不是"其它"。新建 Matter 默认处于该状态，
应由使用者补齐分类，而不是让它长期停在未分类。

## 约束关系

`role` 与 `type` **受约束**，不是两个独立字段：

```text
type = litigation      →  role ∈ { plaintiff, defendant, … , unknown, other }
type = bankruptcy      →  role ∈ { administrator, debtor, … , unknown, other }
type = non-litigation  →  role ∈ { debtor, creditor, investor, restructuring-advisor, unknown, other }
```

所以 `type: litigation` + `role: administrator` **不合法**，会被 `matter.py validate`
以 Error 拦下。这样做的原因：下游 Perspective 来自 role，而 role 的合理取值取决于
案件类型；两者不匹配时匹配结果没有意义。

`type: unclassified` + `role: unknown` 是新建 Matter 的默认状态，合法。

## 如何扩充

新增 token 属于 **Contract 变更**，不是随手加个字符串：

1. 明确新 token 的语义，以及它与既有 token 的边界（避免同义并存）；
2. 同步三处：本文件、`matter.schema.json`、`matter_io.py` 的 `CANONICAL_ROLES`；
3. 若下游（DSH）要匹配它，Perspective 侧必须同步登记；
4. 已落盘的旧值不会自动改写——需要改的 Matter 由人工决定。

## 尚未冻结的字段

以下字段当前是自由字符串，**尚未**冻结；DSH 不应依赖它们的取值：

```text
procedure.kind
procedure.stage
matter.subtypes
modules[]
```

`procedure.stage` 的取值很可能会像 `role` 一样**按 type 分域**
（诉讼的 `first-instance` 与破产的 `claim-review` 几乎不重叠），
因此冻结前需要先确定分域方案。这属于 3.3 Matter Module enrichment 的范围。

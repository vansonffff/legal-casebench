# Practice Library Contract v1

`<CaseBench Root>/_practice/` 保存经过律师明确确认的个人办案经验：`_index.json`、`authorities/AUTH-*.yaml` 和 `notes/PN-*.md`。Authority 表示外部依据；Practice Note 表示办案认识、形成原因、适用边界及来源。Note metadata 追溯来源 Matter ID、Issue 和 Artifact。AI 可在重要 Research / Analysis 完成后提示可能的沉淀价值，但**不得自行写入**。

## 建议与保存

Research / Analysis 完成后，只有已形成可追溯的跨案认识才建议沉淀。向用户展示拟保存的标题、认识、形成理由、适用边界和来源案件/争点/成果/依据；用户未答复或拒绝时，不写 `_practice/`。普通交付与“建议沉淀”本身均不算确认。

用户明确要求保存该项经验即具有确认效力，无须重复询问；该确认不扩展到其他经验。运行：

```bash
python scripts/practice.py promote --root "<工作区>" --case-dir "<来源案件>" \
  --title "<已确认标题>" --body-file "<已确认正文.md>" \
  --issue-ref ISS-0001 --artifact-ref AA-0001 --authority-ref AREF-0001 \
  --confirmed-by-user
```

三个来源引用参数均可省略或重复。`--artifact-ref` 支持检索、分析和定稿成果；`--authority-ref` 从来源案件登记项提取外部依据和历史核验信息，保留来源编号，不复制本案判断为通用认识。必要时可用 `--authorities-json` 提供已回源核对的外部依据数组。脚本核验引用存在，案例按标准化案号、法条按规范标题与条文定位做精确去重；不做模糊合并。

保存后运行 `practice.py show --root "<工作区>" --id <返回的经验编号>`，核对标题、正文、来源和关联依据，再向用户报告编号与文件路径。`--confirmed-by-user` 只是执行参数，不能证明用户确实确认；Agent 不得自行添加它绕过用户决定。

## 检索与复用

历史经验仅用于研究起点。按下列顺序复用：

1. `practice.py list --root "<工作区>" --query "<关键词>"` 同时检索标题、来源案件、正文和关联依据；再用 `show` 回读原经验与依据。没命中就继续本案正常检索，不凭缓存编造经验。
2. 结合本案证据判断历史认识的事实条件与边界是否匹配；不将历史结论直接作为本案结论。
3. 对需要使用的关联依据生成只读问题卡：`practice.py prepare-reuse --root "<工作区>" --id <经验编号> --authority-id <关联依据编号> --case-dir "<当前案件>"`。问题卡保留历史来源，候选依据固定为未核验，不修改当前案件。
4. 按 `legal-research-ladder.md` 使用当前可用的元典和官方来源重新联网核验真实性、当前效力、修订情况、条文或案号/法院/日期，并比较两案事实与适用性。将本次来源、核验时间、结果和限制落入当前案件的检索成果；历史时间不能替代本次核验。
5. 本次核验后，通过 `authority.py add` 在当前案件另行登记，再用 `verify` 记录实际核验状态和可回查来源，并 `list` 回读。只有本次核验完成的项目才能标已核验；部分核验如实标部分核验。

无法联网、未取得原文或来源不足时，明确说明该依据**未完成当前核验**。保留问题卡作为历史线索，不复制历史已核验标记，也不运行 `verify --status verified`。问题卡本身不是核验结果。

共同只读视图仍为 `casebench_view.py practice-list|practice-show`；它与 CLI 使用同一经验检索字段。历史经验每次作为当前依据使用时都须检查是否需要重新核验，不能因为仍在同一个案件就沿用失效或不完整的来源。

# Authority Reference Contract v1

`_case_state.json.authority_refs[]` 是**本 Matter 当前使用**的法条和案例引用，不承载跨案件办案经验。旧 State 无该字段仍合法。编号 `AREF-0001` 起，不回收。

- 法条：`type=statute`，记录规范标题和具体条文定位。
- 案例：`type=case`，记录案号、法院、裁判日期及本案关注的 `proposition`；未知信息保持空值。
- `verification` 至少区分 `unverified`、`partially_verified`、`verified`，并记录核验时点和可回溯来源。CLI 的 `verify` 是登记已完成核验的结果，不能代替查阅官方原文或现行效力核对。

命令：`scripts/authority.py add|list|verify --case-dir <Matter Root>`。写操作须 `--actor`，经统一 `state_update.mutate()` 保存。历史 Practice Authority 不自动成为当前 Matter 的已核验依据；必须重新联网核验后才可在本案登记。

复用历史依据时先按 `practice-library.md` 检索并生成只读问题卡，再完成本次核验。`add` 默认未核验；随后 `verify --authority-ref-id <编号> --status <实际状态> --source "<本次可回查来源>" --actor <当前平台>` 记录实际结果，最后 `list` 回读。来源应指向本次报告或官方页面；不能仅填历史经验编号便宣称核验完成。

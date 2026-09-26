# Proceedings Contract v1

Matter 表示完整法律事务，`proceedings[]` 表示其中有独立程序身份的案件。State v4 保持不变；没有 `proceedings` 的旧 Matter 合法，不自动创建默认程序。

每项至少有 `proceeding_id`（`PROC-0001` 起）、`name`、`kind`、`stage`、`status`、`parties[]`、`events[]`；案号与法院尚未核验时保持空值，不编造。Event 至少有 `event_id`（`EVT-0001` 起）、`type`、带时区的 `at`、`status`。第一版不记录程序之间的关系字段。所有编号由 State `sequences` 高水位分配，不回收。

用 `scripts/proceeding.py add|list|show|update|add-event|update-event --case-dir <Matter Root>` 维护；写操作需 `--actor`，由 `state_update.mutate()` 执行 Matter ID 预检、哈希比对和原子写入。程序事实仍应有可追溯来源；用户口述尚未回源的案号或庭期不得标成已核验。

单个或没有 Proceeding 时，展示端用 Matter 的原有名称和角色，不向用户暴露技术编号；多个 Proceeding 时才显示“关联案件”。

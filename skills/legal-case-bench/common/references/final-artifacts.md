# Final Artifact Contract v1

正式文件仍放在 Matter 的 `02-定稿/`。State v4 可选 `final_artifacts[]` 记录 `artifact_id`、标题、相对路径、类型、定稿时间和文件 SHA256。编号 `FINAL-0001` 起，不回收；登记不表示案件已结案。

把文件先按既有定稿流程另存新版本并完成主办自查，再用 `scripts/final_artifact.py register --case-dir <Matter Root> --path '02-定稿/<文件>' --actor <harness>` 登记。脚本拒绝越界路径、符号链接及相同路径和哈希的重复登记。文件改变后应以新版本再次登记，不静默覆盖旧指针。

Read Model 对旧 State：只有字段**不存在**时才只读扫描 `02-定稿/` 兼容展示；不会反写 State。该扫描产生的条目不具有正式 `artifact_id`。

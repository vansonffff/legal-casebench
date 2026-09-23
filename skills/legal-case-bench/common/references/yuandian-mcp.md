# 元典统一 MCP

唯一服务：`yuandian-open-platform`，URL https://open.chineselaw.com/mcp。凭证由当前平台的安全配置管理，技能不读取、复制或打印密钥；DSH 使用其已配置的同名 MCP。服务不可用时明确说明；不恢复旧 API 或查询脚本。其他官方网页来源可独立检索，但不得声称完成了元典验证。

调用前读取实际工具 schema；下表只用于路由，不预设参数或返回字段。仅使用工具实际返回的 ID、分页游标和全文。不要编造函数命名空间。

| 目标 | 工具 |
|---|---|
| 法条语义检索 | yuandian_law_vector_search |
| 法规与法条关键词 | yuandian_rh_fg_search / yuandian_rh_ft_search |
| 法规与法条详情 | yuandian_rh_fg_detail / yuandian_rh_ft_detail |
| 类案语义与普通案例 | yuandian_case_vector_search / yuandian_rh_ptal_search |
| 权威案例与全文 | yuandian_rh_qwal_search / yuandian_rh_case_details |
| 企业名称检索与基本信息 | yuandian_rh_enterpriseSearch / yuandian_rh_enterpriseBaseInfo |
| 企业专题信息 | 服务中相应 enterprise* 工具，按实际 schema 选择 |

引用应记录检索日期、工具、查询条件、来源身份、原文位置与可复核链接。搜索摘要不能替代全文。公开记录未检索到，写明本次范围与条件，不推定不存在。
原始响应保存到当前任务的 raw/chineselaw 或案件工作台的 10-中间转换。缓存只作线索，记录日期；现行法效力、动态企业状态与正式引用须重新核验。

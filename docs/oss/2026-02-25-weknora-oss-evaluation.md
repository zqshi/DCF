# OSS Introduction Evaluation - Tencent/WeKnora (2026-02-25)

## Requirement
- 当前数字员工知识沉淀主要依赖本地持久化对象，缺少可治理、可检索、可多租户隔离的知识库能力。
- 目标是让人类用户与数字员工都能沉淀高质量信息，并在任务执行中可检索复用。

## Candidate
1. `Tencent/WeKnora`
- Source: https://github.com/Tencent/WeKnora
- Latest pushed time: `2026-02-25T01:41:42Z` (GitHub API)
- Latest release: `v0.2.0` (`2025-11-23T13:50:10Z`, GitHub Releases API)
- Repository `VERSION`: `0.3.0` (main branch)
- License: MIT (with third-party notices)

## Evaluation Dimensions (DCF `oss_evaluation_result.v1`)
- `technicalMaturity`
- `communityActivity`
- `codeQuality`
- `documentation`
- `licenseCompliance`
- `security`
- `performance`
- `maintainability`

Scoring scale: 1-5 (5 best).  
Final score formula: `weighted_score = average(8 dimensions) * 20`.

| Dimension | Score | Rationale |
|---|---:|---|
| technicalMaturity | 4 | 已具备 API Key、多租户、知识库/FAQ/Agent/MCP、异步任务等完整能力。 |
| communityActivity | 5 | `stargazers_count=16531`，活跃度与采用信号强。 |
| codeQuality | 4 | Go 模块化结构清晰，路由/handler/service 分层明确，Swagger 文档齐全。 |
| documentation | 5 | README + API 文档 + MCP 指南 + CHANGELOG + SECURITY 说明完整。 |
| licenseCompliance | 4 | 主体 MIT，附第三方许可证清单；需做企业法务复核。 |
| security | 3 | 有安全公告流程与若干安全修复记录；仍需本地 SCA/SBOM/镜像扫描确认。 |
| performance | 4 | 支持异步任务队列、可切换检索引擎（pgvector/ES/Qdrant）与并发配置。 |
| maintainability | 4 | 最近提交活跃（2026-02-11），CHANGELOG 连续更新；但 release/tag 规范需持续观察。 |

**Total: 82.5 / 100**

## Hard Gates (Aligned to DCF policy)
- Allowed license: pass (`MIT`)
- Critical vulnerabilities: unknown (not proven clean, must run SCA in PoC)
- Stale maintenance: pass (recent updates within threshold)
- Community threshold (infra): pass (stars far above minimum)

Hard gate result: **PASS (conditional)**  
Condition: 完成企业侧安全与合规扫描后再进入生产。

## Feasibility Conclusion
- **可行，建议引入。**
- 推荐以“外部知识服务（HTTP API）”方式集成，不直接把 WeKnora 代码内嵌进 DCF。
- 理由：最大限度保持 DCF 的 DDD-lite 分层与契约稳定，便于后续替换知识引擎。

## Recommended Integration Mode

### Mode A (Recommended): Sidecar/Service Integration via REST
- 在 DCF 中新增基础设施适配器：`WeKnoraGateway`（`infrastructure`）
- 由 `application` 用例编排知识沉淀与检索，不让 `interfaces` 直连第三方 API
- DCF 仅保存“知识引用元数据”和审计轨迹，正文/向量索引留在 WeKnora

Core API mapping (WeKnora `/api/v1`):
- Create KB: `POST /knowledge-bases`
- Ingest: `POST /knowledge-bases/:id/knowledge/file|url|manual`
- Search: `POST /knowledge-search`
- QA (optional): `POST /knowledge-chat/:session_id`

### Mode B (Optional): Tool-based integration via WeKnora MCP server
- 让数字员工通过 MCP 调用知识检索能力
- 优势：更快打通 Agent toolchain
- 代价：运维面与安全面更复杂，建议在 Mode A 稳定后引入

## DCF Integration Blueprint (DDD-lite)

1. `domain`
- 新增知识资产实体（示例）: `KnowledgeAsset`, `KnowledgeCitation`
- 约束沉淀质量字段：`qualityScore`, `sourceType`, `curatedBy`, `reviewedAt`

2. `application`
- 新增用例：
  - `KnowledgeIngestUseCase`（人类/数字员工沉淀）
  - `KnowledgeSearchUseCase`（任务检索）
  - `KnowledgeCurateUseCase`（质量审核与晋级）
- 与现有 `TaskUseCases`、`RetrievalPolicyService` 联动：在 `platform_context` 决策阶段优先检索知识库

3. `infrastructure`
- 新增 `WeKnoraGateway`（HTTP adapter，封装 API Key、超时、重试、熔断）
- 新增 `KnowledgeRepository`（仅本地保存映射与审计，不重复存全文）
- 映射字段必须包含：`trace_id`, `task_id`, `employee_id`

4. `interfaces`
- 新增 API 组（建议 versioned）：
  - `POST /api/front/knowledge/ingest`
  - `POST /api/front/knowledge/search`
  - `GET /api/admin/knowledge-assets`
  - `POST /api/admin/knowledge-assets/:id/review`
- 前台允许人类用户和数字员工提交沉淀；后台提供审核、追踪和回滚治理

## Contract and Compatibility Notes
- DCF 对外 contract 保持 v1，新增能力通过新路由扩展，不破坏旧接口。
- 外部服务故障降级策略：
  - 检索失败 -> 回落到现有本地 `employee.knowledge` + 外部 OSS 搜索
  - 写入失败 -> 记录待重试任务，不阻塞主任务执行

## Risks
1. 运维复杂度上升（Postgres/Redis/Docreader/对象存储等依赖）
2. 跨服务鉴权与租户映射需要严格设计（DCF tenant/account -> WeKnora tenant/api key）
3. 语义检索质量与成本需按部门/场景调参（chunk/rerank/model）
4. 安全合规需要额外门禁（镜像、依赖、密钥、网络隔离）

## PoC Plan (2 weeks)
1. Week 1
- 起 WeKnora 最小部署（仅核心服务）
- 完成 DCF `WeKnoraGateway` + 两个用例（ingest/search）
- 打通 1 条任务闭环：任务产出 -> 知识沉淀 -> 下次任务检索命中

2. Week 2
- 增加治理：质量评分、人工审核、审计字段完整性校验
- 压测与回归：QPS、延迟、失败重试、降级路径
- 输出 go/no-go 报告

## Decision
- **Proceed with controlled PoC**, then production rollout by tenant.
- 初始范围：单部门、低风险任务、只开放文档型知识库沉淀。

## Evidence (captured 2026-02-25)
- Repo: https://github.com/Tencent/WeKnora
- Repo API: https://api.github.com/repos/Tencent/WeKnora
- Releases API: https://api.github.com/repos/Tencent/WeKnora/releases/latest
- README: https://github.com/Tencent/WeKnora/blob/main/README.md
- Security policy: https://github.com/Tencent/WeKnora/blob/main/SECURITY.md
- API docs entry: https://github.com/Tencent/WeKnora/blob/main/docs/api/README.md
- Knowledge search API: https://github.com/Tencent/WeKnora/blob/main/docs/api/knowledge-search.md

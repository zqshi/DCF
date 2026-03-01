# 子Agent实体化升级方案（提案）

## 1. 背景与目标

当前系统中，子Agent通过父员工对象内嵌字段 `childAgents` 维护，已能表达基础父子协同，但尚未成为可独立治理实体。

本方案目标是将子Agent升级为独立实体，满足以下能力：

1. 独立生命周期管理（创建/暂停/恢复/下线）。
2. 独立权限与运行配置（tool scope、runtime profile、审批边界）。
3. 任务归属与审计可追溯（executor/delegation 链路清晰）。
4. 与现有前后端接口兼容迁移，不中断当前使用体验。

## 2. 现状基线

1. 同一 `creator` 只能创建一个父员工（parent employee）。
2. 子Agent目前挂在 `employee.childAgents`，不是独立实体。
3. 任务链路已包含 `childAgentPlan`、`childAgentId`、`agent.route.decided` 等事件。
4. 架构采用 DDD-lite，适合增量演进。

## 3. 范围定义

### 3.1 In Scope

1. 子Agent领域实体建模与持久化。
2. 父子关系实体化与关系查询。
3. 任务执行归属切换到实体级Agent。
4. 管理后台增加子Agent视图与基础操作接口。
5. 向后兼容旧字段 `employee.childAgents`（只读投影）。

### 3.2 Out of Scope

1. 大规模自动编排策略优化（仅保留现有策略语义）。
2. 多租户跨组织联邦Agent网络（非当前阶段目标）。
3. 新模型/新引擎能力扩展（保持OpenClaw对齐基线）。

## 4. 目标架构（DDD-lite）

### 4.1 Domain 层

新增聚合：

1. `Agent`（统一父/子实体）
2. `AgentRelation`（父子关系）

关键字段建议：

1. `Agent`
   - `id`
   - `agentType`：`parent|child`
   - `parentEmployeeId`（child必填）
   - `ownerEmployeeId`
   - `tenantId/accountId`
   - `name/status`
   - `runtimeProfile`
   - `toolScope`
   - `approvalPolicyRef`
   - `createdAt/updatedAt`
2. `AgentRelation`
   - `parentAgentId`
   - `childAgentId`
   - `relationType`（`delegates_to|monitors`）
   - `createdAt`

### 4.2 Application 层

新增 `AgentUseCases`：

1. 创建子Agent
2. 状态流转（pause/resume/disable）
3. 查询父子拓扑
4. 更新Agent运行配置

改造 `TaskUseCases`：

1. `routeSubAgents` 输出路由后，不再直接写入 `employee.childAgents`。
2. 任务执行写入 `executorAgentId/delegatedByAgentId/parentTaskId`。
3. 子Agent创建与委派事件统一从 `AgentUseCases` 发出。

### 4.3 Infrastructure 层

新增仓储接口：

1. `AgentRepository`
2. `AgentRelationRepository`

初期实现：

1. `InMemoryStore` 增加 `agents`、`agentRelations`。
2. SQLite/Postgres 驱动后续同步补齐（迁移脚本阶段引入）。

### 4.4 Interfaces 层

新增管理接口（建议 `v2`）：

1. `GET /api/admin/agents`
2. `GET /api/admin/agents/:id`
3. `POST /api/admin/agents/:id/pause`
4. `POST /api/admin/agents/:id/resume`
5. `GET /api/admin/agent-relations?parentAgentId=...`

兼容接口策略：

1. 保留 `employee.childAgents` 返回，但改为新实体投影生成。
2. 旧接口不再直接写内嵌数组。

## 5. 数据与迁移方案

### M1：影子建模（无行为变更）

1. 新增数据结构（`agents`, `agentRelations`）。
2. 写空实现与查询能力，先不接主流程。

### M2：双写阶段

1. 创建子Agent时，同时写：
   - 新实体（`agents/relations`）
   - 旧字段（`employee.childAgents`）
2. 增加双写对账日志。

### M3：历史回填

1. 将历史 `employee.childAgents` 批量回填到 `agents`。
2. 建立 `AgentRelation` 与索引。
3. 生成回填报告（成功/失败/重复/冲突）。

### M4：读切换

1. 查询子Agent统一从新实体读。
2. `employee.childAgents` 变为兼容投影。

### M5：去双写

1. 移除旧字段写路径。
2. 保留短期只读兼容窗口。
3. 最终清理旧结构与迁移脚本归档。

## 6. OpenClaw 对齐要求

1. 每个子Agent可绑定独立 `runtimeProfile.agentId`。
2. 任务执行必须可关联：
   - `trace_id`
   - `task_id`
   - `employee_id`
   - `agent_id`
3. 子Agent权限不得突破父员工所属租户与账号边界。
4. 保持现有 runtime readiness 门禁语义不降低。

## 7. 风险与控制

1. 关系错配导致任务归属错误。
   - 控制：上线前执行“task->agent->relation”一致性校验。
2. 双写漂移。
   - 控制：每日对账任务 + 差异告警。
3. 查询性能回退。
   - 控制：索引 `parentEmployeeId`, `executorAgentId`, `parentAgentId`。
4. 权限越权。
   - 控制：Agent级ACL，严格复用现有 tenant/account 作用域匹配逻辑。

## 8. 测试与质量门禁

遵循 `docs/standards/02-tdd-workflow.md` 与 `03-quality-gates.md`：

1. Domain：
   - Agent状态机
   - 父子关系合法性
2. Application：
   - 委派/回退/失败重试
   - 双写一致性
3. Contract：
   - 新旧接口兼容
4. System：
   - OpenClaw真实链路下子Agent执行与审计闭环

发布前门禁建议：

1. `npm test`
2. `npm run verify:openclaw-alignment`
3. 新增 `verify:agent-entity-migration`（后续实现）

## 9. 里程碑与交付

### 迭代1（低风险）

1. 新增实体与仓储
2. 新增只读接口
3. 不影响现有写流程

### 迭代2（中风险）

1. 接入任务编排实体化
2. 开启双写与对账

### 迭代3（中高风险）

1. 历史回填
2. 读切换

### 迭代4（收敛）

1. 去双写
2. 清理旧写路径
3. 完成迁移验收报告

## 10. 验收标准（DoD）

1. 子Agent可独立创建、暂停、恢复、下线。
2. 任务能明确归属 `executorAgentId`，并可追溯父任务/委派来源。
3. 审计字段完整，含 `trace_id/task_id/employee_id/agent_id`。
4. 旧前端读取 `employee.childAgents` 不报错，且数据来自实体投影。
5. OpenClaw链路与现有启动门禁保持通过。

## 11. 例外说明

本提案当前仅做方案沉淀，不包含代码实现与迁移执行；后续实施需按标准流程逐迭代落地并通过质量门禁。

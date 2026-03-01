# OpenClaw接入接口契约（v1）

## 0. 关联文档
1. 实施计划：`4周实施计划与验收标准.md`
2. 迁移清单：`迁移任务清单（可勾选）.md`
3. 现有规范入口：`standards/README.md`

## 1. 目标与边界
1. OpenClaw作为执行运行时（Runtime），负责任务执行与事件产出。
2. DCF作为企业控制层（Control Layer），负责身份权限、组织治理、技能治理、审计追踪。
3. 本契约只定义`DCF -> OpenClaw Adapter`与`前后台 -> DCF API`边界，不约束OpenClaw内部实现。

## 2. 统一对象模型
### 2.1 TaskCommand
```json
{
  "taskId": "uuid",
  "employeeId": "uuid",
  "employeeCode": "DE-0001",
  "agentId": "finance-agent",
  "sessionKey": "agent:finance-agent:thread-001",
  "conversationId": "thread-xxx",
  "goal": "完成今日客服工单分类并输出摘要",
  "riskLevel": "L2",
  "policyId": "policy-ops-l2",
  "extraSystemPrompt": "你是财务数字员工，优先保证账务准确并输出可执行步骤。",
  "toolScope": ["bash", "write", "http"],
  "metadata": {
    "department": "OPS",
    "role": "Operator"
  }
}
```

### 2.2 RuntimeEvent
```json
{
  "id": "event-uuid",
  "type": "task.running",
  "taskId": "uuid",
  "employeeId": "uuid",
  "conversationId": "thread-xxx",
  "payload": {},
  "at": "2026-02-15T10:00:00.000Z",
  "source": "openclaw"
}
```

### 2.3 SkillProposal
```json
{
  "proposalId": "sp-uuid",
  "taskId": "uuid",
  "employeeId": "uuid",
  "skill": {
    "name": "finance-task-handler",
    "type": "domain",
    "domain": "finance",
    "source": "github",
    "repo": "org/repo",
    "version": "v1.2.0"
  },
  "evaluation": {
    "fitScore": 82,
    "riskScore": 31,
    "license": "MIT"
  },
  "status": "pending"
}
```

## 3. Runtime适配接口（DCF内部端口）
### 3.1 提交任务
- `POST /runtime/tasks`
- 请求体：`TaskCommand`
- 响应：
```json
{
  "accepted": true,
  "runtimeTaskId": "rt-uuid",
  "queuedAt": "2026-02-15T10:00:00.000Z"
}
```

### 3.2 查询任务状态
- `GET /runtime/tasks/:taskId`
- 响应：
```json
{
  "taskId": "uuid",
  "status": "queued|running|succeeded|failed|aborted",
  "iteration": 1,
  "result": "...",
  "lastError": null,
  "updatedAt": "2026-02-15T10:01:00.000Z"
}
```

### 3.3 拉取任务事件
- `GET /runtime/tasks/:taskId/events`
- 响应：`RuntimeEvent[]`

### 3.4 中止任务
- `POST /runtime/tasks/:taskId/abort`
- 响应：
```json
{ "ok": true, "status": "aborted" }
```

## 4. 前后台对外接口（DCF API）
### 4.1 Front
1. `POST /api/front/employees` 创建父数字员工。
2. `GET /api/front/employees` 获取执行者列表。
3. `POST /api/front/tasks` 下发会话任务（必须包含`conversationId`）。
4. `GET /api/front/tasks` 获取任务列表（支持会话聚合）。

### 4.2 Admin
1. `GET /api/admin/employees`
2. `GET /api/admin/employees/:id`
3. `GET /api/admin/tasks`
4. `GET /api/admin/tasks/:id`
5. `GET /api/admin/logs`
6. `GET /api/admin/skills`
7. `GET /api/admin/oss-findings`
8. `GET /api/admin/runtime-status`

## 5. 事件字典（最小集合）
1. 任务：`task.created` `task.running` `task.corrected` `task.succeeded` `task.failed` `task.aborted`
2. 子Agent：`child.agent.created`
3. 技能：`skill.auto.created` `skill.auto.linked`
4. 开源检索：`oss.research.queued` `oss.research.completed` `oss.research.failed`

## 6. 错误码规范
1. `EMPLOYEE_NOT_FOUND`
2. `PARENT_EMPLOYEE_REQUIRED`
3. `CREATOR_LIMIT_EXCEEDED`
4. `POLICY_DENIED`
5. `RUNTIME_UNAVAILABLE`
6. `SKILL_GOVERNANCE_REJECTED`

返回格式：
```json
{
  "error": {
    "code": "POLICY_DENIED",
    "message": "risk level exceeds role boundary",
    "requestId": "req-uuid"
  }
}
```

## 7. 安全与审计要求
1. 每次任务执行必须写入`requestId`、`actor`（人类/数字员工）、`policyId`。
2. 所有高风险动作（L3/L4）必须产生可回放审计事件。
3. Adapter不得绕过组织权限校验；权限判定在DCF控制层完成。

## 8. 版本策略
1. 契约版本：`v1`，通过`X-Contract-Version: v1`传递。
2. 新增字段只增不删；删改必须升`v2`。
3. Runtime与DCF版本解耦，适配层负责字段兼容。

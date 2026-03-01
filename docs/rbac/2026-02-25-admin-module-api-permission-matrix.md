# 管理后台模块/页面 API 权限矩阵（角色管理粒度）

## 目标

- 面向“创建角色/编辑角色”，提供可直接选配的权限粒度。
- 粒度统一为：`权限键 -> 模块 -> 页面 -> API -> 高风险动作`。
- 数据源：
  - `app/src/shared/adminAcl.js`
  - `app/public/admin/*.html` (`data-required-permission`)
  - `app/public/admin/*.js`（实际调用 `/api/admin/*`）

## 模块清单（页面 + API 权限）

### 1) 运行管理（Runtime）

- 页面权限：`admin.runtime.read`
  - 页面：`/admin/index.html`、`/admin/runtime.html`、`/admin/runtime-health.html`、`/admin/runtime-cycles.html`、`/admin/runtime-advanced.html`
  - API（GET）：
    - `/api/admin/runtime-status`
    - `/api/admin/overview`
    - `/api/admin/runtime/retrieval-policy`
    - `/api/admin/runtime/skill-sedimentation-policy`
    - `/api/admin/bootstrap-status`
- 写权限：`admin.runtime.write`
  - API（POST）：
    - `/api/admin/runtime/retrieval-policy`
    - `/api/admin/runtime/skill-sedimentation-policy`
    - `/api/admin/bootstrap/run-cycle`

### 2) 任务管理（Tasks）

- 页面权限：`admin.tasks.read`
  - 页面：`/admin/tasks.html`、`/admin/tasks-runtime.html`、`/admin/tasks-governance.html`
  - API：
    - `GET /api/admin/tasks`
    - `GET /api/admin/tasks/*`
- 写权限：`admin.tasks.write`
  - API：
    - `POST /api/admin/tasks/approve`
    - `POST /api/admin/tasks/rollback`
    - `POST /api/admin/tasks/*`（含补偿重试等）

### 3) 员工管理（Employees）

- 页面权限：`admin.employees.read`
  - 页面：`/admin/employees.html`、`/admin/employees-contracts.html`、`/admin/employees-growth.html`
  - API：
    - `GET /api/admin/employees`
    - `GET /api/admin/employees/*`
- 写权限：`admin.employees.write`
  - API：
    - `POST /api/admin/employees/retrieval-policy/rollout`
    - `POST /api/admin/employees/retrieval-policy/rollback`
    - `POST /api/admin/employees/*`（员工资料/策略/审批策略更新）

### 4) 技能管理（Skills）

- 页面权限：`admin.skills.read`
  - 页面：`/admin/skills.html`
  - API：
    - `GET /api/admin/skills`
    - `GET /api/admin/skills/*`
- 写权限：`admin.skills.write`
  - API：
    - `POST /api/admin/skills/import`
    - `POST /api/admin/skills/*`（提案、关联等）
- 删除按钮权限：`admin.skills.action.delete`
  - API：
    - `DELETE /api/admin/skills/*`
  - 动作：
    - `admin.skills.delete-skill`（删除未关联技能）
- 解绑按钮权限：`admin.skills.action.unlink-employee`
  - API：
    - `POST /api/admin/skills/{skillId}/unlink`
  - 动作：
    - `admin.skills.unlink-employee`（技能解绑数字员工）
- 调试动作权限：`admin.skills.action.debug-toggle`
  - 动作：
    - `admin.skills.debug-toggle`

### 5) 工具管理（Tools）

- 资产查看：`admin.tools.assets.read`
  - 页面：`/admin/tools.html`
  - API：
    - `GET /api/admin/tools`
    - `GET /api/admin/tools/mcp-services*`
- 资产变更：`admin.tools.assets.write`
- 资产写入兼容权限：`admin.tools.assets.write`
  - API：
    - `POST /api/admin/tools/mcp-services`（兼容）
    - `POST /api/admin/tools/mcp-services/{serviceId}`（兼容）
    - `POST /api/admin/tools/mcp-services/{serviceId}/delete`（兼容）
    - `POST /api/admin/tools/mcp-services/{serviceId}/check-health`（兼容）
- 审批查看：`admin.tools.approval.read`
  - 页面：`/admin/tools-approvals.html`
  - API：
    - `GET /api/admin/tools/pending`
- 审批操作：`admin.tools.approval.write`
  - API：
    - `POST /api/admin/tools/mcp-services/{serviceId}/approve`（兼容）
    - `POST /api/admin/tools/mcp-services/{serviceId}/reject`（兼容）
    - `POST /api/admin/tools/mcp-services/{serviceId}/rollback`（兼容）
    - `POST /api/admin/tools/mcp-services/{serviceId}/resubmit`（兼容）
- 按钮级权限（推荐新配置）
  - `admin.tools.action.create-service`
  - `admin.tools.action.update-service`
  - `admin.tools.action.delete-service`
  - `admin.tools.action.check-health`
  - `admin.tools.action.approve-service`
  - `admin.tools.action.reject-service`
  - `admin.tools.action.rollback-service`
  - `admin.tools.action.resubmit-service`
- 策略查看：`admin.tools.policy.read`
  - 页面：`/admin/tools-policy.html`
  - API：
    - `GET /api/admin/tools/retrieval-policy`
    - `GET /api/admin/tools/retrieval-metrics`
- 策略更新：`admin.tools.policy.write`
  - API：
    - `POST /api/admin/tools/retrieval-policy`

### 6) 日志审计（Logs）

- 页面权限：`admin.logs.read`
  - 页面：`/admin/logs.html`、`/admin/logs-agent.html`、`/admin/logs-admin.html`
  - API：
    - `GET /api/admin/logs`
    - `GET /api/admin/audit-status`
- 写权限：`admin.logs.write`
  - API：
    - `POST /api/admin/audit-anchor`

### 7) 开源治理（OSS）

- 页面权限：`admin.oss.read`
  - 页面：`/admin/oss.html`
  - API：
    - `GET /api/admin/oss-findings`
    - `GET /api/admin/knowledge-assets`
    - `GET /api/admin/oss-cases`
    - `GET /api/admin/oss-governance-policy`
    - `GET /api/admin/oss-cases/*`
- 写权限：`admin.oss.write`
  - API：
    - `POST /api/admin/knowledge-assets/*`
    - `POST /api/admin/oss-governance-policy`
    - `POST /api/admin/oss-cases/*`（兼容）
- 按钮级权限（推荐新配置）
  - `admin.oss.action.approve-case`
  - `admin.oss.action.deploy`
  - `admin.oss.action.verify`
  - `admin.oss.action.rollback`

### 8) 账号权限（Auth）

- 页面权限：`admin.auth.read`
  - 页面：`/admin/auth-users.html`、`/admin/auth-roles.html`、`/admin/auth-members.html`
  - API：
    - `GET /api/admin/auth/health`
    - `GET /api/admin/auth/users`
    - `GET /api/admin/auth/roles`
- 写权限：`admin.auth.write`
  - API：
    - `POST /api/admin/auth/users`
    - `POST /api/admin/auth/users/*`
    - `POST /api/admin/auth/roles`
    - `POST /api/admin/auth/roles/*`

## 角色管理使用建议（创建/编辑角色）

- 建议前端优先展示“模块分组 + 权限键”，展开后显示对应页面/API/动作说明。
- 高风险权限建议单独高亮并二次确认：
  - `admin.skills.action.delete`
  - `*`（全量权限，仅 `super_admin`）
- 组合建议：
  - 只读角色：优先分配 `*.read`
  - 运营角色：`runtime/tasks/employees` 的 `read+write`
  - 审计角色：`runtime/tasks/logs/employees` 的 `read`

## 备注

- 角色管理页面的权限矩阵由 `/api/admin/auth/roles` 的 `permissionMatrix` 提供。
- 本次已补齐动态路由的 API 展示（`tools.approval.write`、`skills.delete` 等），确保“页面可见权限”与“真实生效接口权限”一致。

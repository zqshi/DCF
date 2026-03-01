# 技能管理 RBAC 权限点清单与角色模板（2026-02-24）

## 1. 本次新增/关键权限点

### 技能管理
- `admin.skills.read`
  - 用途：访问技能管理页面、查看技能列表与详情。
  - 页面：`/admin/skills.html`
  - 接口：`GET /api/admin/skills`、`GET /api/admin/skills/*`

- `admin.skills.write`
  - 用途：导入技能、技能状态流转（审批/驳回/回滚）。
  - 接口：`POST /api/admin/skills/import`、`POST /api/admin/skills/*`

- `admin.skills.debug`（新增）
  - 用途：显示“调试模式开关”、查看原始 JSON 调试能力。
  - 动作：`admin.skills.debug-toggle`
  - 页面：`/admin/skills.html`

- `admin.skills.delete`（新增，高风险）
  - 用途：技能与员工解绑、删除技能。
  - 接口：`POST /api/admin/skills/:id/unlink`、`DELETE /api/admin/skills/:id`
  - 动作：`admin.skills.unlink-employee`、`admin.skills.delete-skill`
  - 业务约束：若技能仍有关联员工，删除返回 409，需先解绑。

## 2. 高风险权限治理规则

- 高风险权限集合：
  - `admin.skills.delete`
  - `*`

- 授权限制：
  - 仅 `super_admin` 可在“新建角色/编辑角色”时授予高风险权限。
  - 非 `super_admin` 尝试授予会返回 403。

## 3. 角色模板（建议）

### 3.1 super_admin（系统最高权限）
- 权限：`*`
- 适用：平台管理员（极少数）
- 说明：具备高风险配置与删除能力。

### 3.2 skill_admin（技能运营）
- 最小建议权限：
  - `admin.skills.read`
  - `admin.skills.write`
  - （可选）`admin.skills.debug`
- 不建议默认授予：`admin.skills.delete`
- 适用：技能导入、维护、状态审批人员。

### 3.3 skill_auditor（技能审计）
- 建议权限：
  - `admin.skills.read`
  - （可选）`admin.skills.debug`
- 不授予：`admin.skills.write`、`admin.skills.delete`
- 适用：只读核查与问题复盘人员。

### 3.4 skill_operator_limited（业务操作员）
- 建议权限：
  - `admin.skills.read`
- 不授予：`admin.skills.debug`、`admin.skills.write`、`admin.skills.delete`
- 适用：业务查看，不暴露调试与高风险操作。

### 3.5 skill_super_operator（上帝视角运营）
- 建议权限：
  - `admin.skills.read`
  - `admin.skills.write`
  - `admin.skills.debug`
  - `admin.skills.delete`
- 约束：仅在 `super_admin` 主导下审批创建，严格留痕。

## 4. 上线配置步骤（账号权限页）

1. 使用 `super_admin` 登录，进入角色管理页：`/admin/auth-roles.html`。
2. 创建或编辑角色，在“权限矩阵（页面/接口/按钮）”中勾选目标权限。
3. 若涉及 `admin.skills.delete`，确认操作者账号为 `super_admin`。
4. 在用户管理页：`/admin/auth-users.html` 将角色分配到目标账号。
5. 回到技能页验证：
   - 无 `admin.skills.debug`：不显示调试开关。
   - 无 `admin.skills.delete`：不显示解绑/删除高权限操作。
   - 有 `admin.skills.delete`：可解绑；删除时需二次确认，且仅可删无关联技能。

## 5. 验收清单

- [ ] 业务账号进入技能页看不到调试开关。
- [ ] 普通 skill_admin 可导入与查看，但无删除按钮。
- [ ] 高权限角色可看到解绑/删除操作。
- [ ] 有关联员工的技能删除被阻断（409）。
- [ ] 解除关联后可成功删除技能。
- [ ] 角色权限矩阵可展示“页面/接口/按钮”三类引用。

# 运行权限基线落地手册（可执行 API 示例）

适用目标：将“默认放行、敏感审批”的策略落地到当前 DCF 实例。

## 1. 前置条件

1. 服务已启动（示例：`http://127.0.0.1:8092`）
2. 有管理员账号（开发默认可用 `admin/admin123`）
3. 已创建至少一个数字员工

## 2. 准备变量

```bash
BASE_URL="http://127.0.0.1:8092"
COOKIE_JAR="/tmp/dcf-admin-cookie.txt"
USERNAME="admin"
PASSWORD="admin123"
```

## 3. 登录并建立会话

```bash
curl -sS -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/api/auth/login" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}"
```

校验会话：

```bash
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/auth/me"
```

## 4. 查询员工并选择 employeeId

```bash
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/employees"
```

从返回结果中选一个 `id`，设置为：

```bash
EMPLOYEE_ID="替换为员工ID"
```

## 5. 下发审批策略（L1-L3 自动放行，L4 需双审批）

```bash
curl -sS -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/api/admin/employees/$EMPLOYEE_ID/approval-policy" \
  -d '{
    "approvalPolicy": {
      "byRisk": {
        "L1": { "requiredApprovals": 0, "requiredAnyRoles": [], "distinctRoles": false },
        "L2": { "requiredApprovals": 0, "requiredAnyRoles": [], "distinctRoles": false },
        "L3": { "requiredApprovals": 0, "requiredAnyRoles": [], "distinctRoles": false },
        "L4": { "requiredApprovals": 2, "requiredAnyRoles": ["auditor", "super_admin"], "distinctRoles": true }
      }
    }
  }'
```

## 6. 下发岗位边界策略（默认放行，限制敏感词与风险上限）

说明：当前模型中“敏感审批”主要通过 `riskLevel=L4` 触发审批，因此岗位策略建议控制越权词与最大风险等级。

```bash
curl -sS -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/api/admin/employees/$EMPLOYEE_ID/policy" \
  -d '{
    "jobPolicy": {
      "allow": [],
      "deny": ["导出全部凭证", "批量删除生产数据", "绕过审批"],
      "strictAllow": false,
      "allowedDepartments": [],
      "allowedRoles": [],
      "maxRiskLevel": "L4",
      "kpi": [],
      "escalationRule": "敏感动作提升为L4并触发审批",
      "shutdownRule": "P1风险触发立即熔断并人工接管"
    }
  }'
```

## 7. 回读校验

```bash
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/employees/$EMPLOYEE_ID"
```

检查字段：

1. `approvalPolicy.byRisk.L1-L3.requiredApprovals == 0`
2. `approvalPolicy.byRisk.L4.requiredApprovals == 2`
3. `jobPolicy.maxRiskLevel == "L4"`

## 8. 网关环境变量落地（本机 + 外网）

推荐样例文件：

- `/Users/zqs/Downloads/project/DCF/app/config/runtime-permission.env.example`

示例加载并启动：

```bash
cd /Users/zqs/Downloads/project/DCF/app
set -a
source ./config/runtime-permission.env.example
set +a
npm start
```

## 9. 验证“自动放行 + 敏感审批”

1. 提交 `L2` 任务：应自动进入可执行路径（无需审批）。
2. 提交 `L4` 任务：应进入 `task.approval.required`，待审批后执行。
3. 查看审计链：

```bash
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/audit-status"
```

## 10. 一键批量下发脚本（推荐）

脚本位置：

- `/Users/zqs/Downloads/project/DCF/app/scripts/apply-runtime-permission-baseline.js`

对应 npm 命令：

- `npm run policy:apply-runtime`

### 10.1 先做 Dry Run（不写入）

```bash
cd /Users/zqs/Downloads/project/DCF/app
DCF_BASE_URL="http://127.0.0.1:8092" \
DCF_ADMIN_USERNAME="admin" \
DCF_ADMIN_PASSWORD="admin123" \
DCF_POLICY_FILE="./config/runtime-permission-policy.example.json" \
DCF_DRY_RUN=1 \
npm run policy:apply-runtime
```

### 10.2 执行真实写入

```bash
cd /Users/zqs/Downloads/project/DCF/app
DCF_BASE_URL="http://127.0.0.1:8092" \
DCF_ADMIN_USERNAME="admin" \
DCF_ADMIN_PASSWORD="admin123" \
DCF_POLICY_FILE="./config/runtime-permission-policy.example.json" \
DCF_APPLY_JOB_POLICY=1 \
DCF_DRY_RUN=0 \
npm run policy:apply-runtime
```

### 10.3 仅对指定员工下发

```bash
cd /Users/zqs/Downloads/project/DCF/app
DCF_BASE_URL="http://127.0.0.1:8092" \
DCF_ADMIN_USERNAME="admin" \
DCF_ADMIN_PASSWORD="admin123" \
DCF_EMPLOYEE_IDS="id-1,id-2" \
DCF_DRY_RUN=0 \
npm run policy:apply-runtime
```

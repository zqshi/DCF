# 05 Product Modules (Front/Back)

## Front Stage

1. Chat interaction (`/front.html`)
2. Human creator creates one parent digital employee
3. Human only sends goals; execution and child-agent management are server-side

## Back Office Modules

1. Dashboard (`/admin/index.html`)
2. Employees (`/admin/employees.html`)
3. Skills (`/admin/skills.html`)
4. Tasks (`/admin/tasks.html`)
5. Logs (`/admin/logs.html`)
6. OSS Findings (`/admin/oss.html`)

## Decoupling Rules

1. One page owns one core dataset and API group.
2. No cross-page shared mutable state.
3. API groups align to modules: `front/*`, `admin/*`, `shared`.
4. Admin pages are read-first for governance visibility.

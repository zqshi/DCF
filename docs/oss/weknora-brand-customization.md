# WeKnora 品牌定制落点（DCF）

## 目标

官方 WeKnora 本地部署后，前端展示 DCF 品牌而非默认 WeKnora。

## 当前定制文件

1. Logo 资源  
`/Users/zqs/Downloads/project/DCF/app/vendor/WeKnora/frontend/src/assets/img/dcf-knowledge.svg`

2. 左侧菜单 Logo 引用  
`/Users/zqs/Downloads/project/DCF/app/vendor/WeKnora/frontend/src/components/menu.vue`

3. 登录页 Logo 引用  
`/Users/zqs/Downloads/project/DCF/app/vendor/WeKnora/frontend/src/views/auth/Login.vue`

4. 中文文案  
`/Users/zqs/Downloads/project/DCF/app/vendor/WeKnora/frontend/src/i18n/locales/zh-CN.ts`

5. 英文文案  
`/Users/zqs/Downloads/project/DCF/app/vendor/WeKnora/frontend/src/i18n/locales/en-US.ts`

## 复核命令

```bash
rg -n "DCF Knowledge|DCF 知识库|dcf-knowledge.svg" /Users/zqs/Downloads/project/DCF/app/vendor/WeKnora/frontend/src
```

## 注意

`app/vendor/WeKnora` 是外部仓库工作树，重拉取或覆盖会丢失本地品牌定制。  
建议在 DCF 仓库保留该文档并保留对应补丁流程。

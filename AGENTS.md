# email-management-worker Contributor Guide

当前主线是 Cloudflare Worker 版本。优先关注：

1. `README.md`
2. `wrangler.example.toml`
3. `src/index.ts`
4. `email-management-app/index.html`
5. `email-management-app/main.js`
6. `email-management-app/db.js`
7. `migrations/`

## 当前生产边界

当前生产主线只包含：

- `src/`：Worker API 和邮件读取入口
- `email-management-app/`：由 Worker Assets 托管的 Vue 前端
- `migrations/`：完整部署所需 D1 schema
- `wrangler.example.toml`：公开的 Worker 配置模板
- `wrangler.toml`：本地部署配置，由模板复制生成，不提交

`legacy/` 下是历史参考，不参与当前部署；不要把里面的 Flask 后端、React 实验前端、旧原型或旧文档当成当前主线。

## 一句话架构

这是一个“前端本地存账号，Worker 按需拉邮件，可选 D1 登录同步账号资料”的系统：

- 极简部署：不绑定 D1，账号只在浏览器 IndexedDB，本地模式使用。
- 完整部署：绑定 D1，启用注册/登录/账号云同步。
- 邮件读取主链是 Microsoft Graph。
- 邮件内容不写入 D1/KV/云端。

## 代码地图

### 前端

- `email-management-app/index.html`：页面骨架和本地 vendor 资源加载
- `email-management-app/main.js`：Vue 3 主逻辑、账号导入、分组、邮件读取、登录同步 UI
- `email-management-app/db.js`：浏览器 IndexedDB 封装
- `email-management-app/config.js`：运行时接口地址覆盖入口

### Worker

- `src/index.ts`：Worker 入口、认证、D1 云同步、Microsoft Graph 邮件读取
- `migrations/0001_auth_cloud_accounts.sql`：D1 用户、session、账号、加密凭据表；不包含邮件表

## 改动原则

1. README 面向用户，不写成开发者内部文档。
2. 当前对外聚焦 Microsoft Graph，不主动承诺其他邮件服务能力。
3. 极简部署必须在没有 D1 绑定时可用。
4. 完整部署才依赖 D1 和登录相关 Secret。
5. 邮件内容、附件、邮件列表缓存不得写入 D1/KV/云端。
6. `wrangler.example.toml` 只放公开配置示例，不放 CLI 操作命令。
7. `wrangler.toml` 可能包含个人域名或 D1 id，必须保持为本地文件，不提交。

## 提交前检查

```bash
npm run check
node --check email-management-app/main.js
npx wrangler deploy --dry-run --config wrangler.example.toml
```

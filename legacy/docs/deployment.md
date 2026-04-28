# 运行说明

这份文档只保留源码使用者需要的最小信息：

- 如何本地启动
- 需要哪些环境变量
- 如何验证功能是否正常

不再展开任何特定平台、供应商或个人服务器结构细节。

## 本地启动后端

```bash
cd /Volumes/SSD/Email\ Tool/email-management-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

默认访问地址：

```text
http://127.0.0.1:8788
```

## 本地联调新版前端

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
./scripts/npm.sh install
npm run dev
```

## Cloudflare Worker 版本

Worker 版本用于一键部署 `email-management-app/` 静态前端、邮件刷新 API，以及 D1 登录/账号云同步 API。

```bash
npm install
npm run dev
npm run deploy
```

部署前先创建并绑定 D1：

```bash
npx wrangler d1 create email-management-worker-db
```

把命令返回的 `database_id` 填入 `wrangler.toml` 的 `[[d1_databases]]` 示例块并取消注释，然后执行迁移：

```bash
npx wrangler d1 migrations apply email-management-worker-db --remote
```

必须设置的 Worker secrets：

```bash
npx wrangler secret put EMAIL_MANAGEMENT_WORKER_SESSION_SECRET
npx wrangler secret put EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET
```

Worker 版边界：

- Microsoft 只走 Graph；Graph 不可用时不会回退 IMAP
- Gmail 走 Gmail API，需要配置 `EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_ID` 和 secret `EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_SECRET`
- D1 只保存用户、会话、账号普通资料和加密凭据
- 不创建邮件表；邮件 subject/from/body/附件不会写入 D1/KV/云端
- 暂不包含 Flask 版 Google OAuth 回调接口

自定义域名：默认使用 `workers.dev`。如果要绑定自己的域名，在 `wrangler.toml` 里取消 `routes` 示例注释并替换为你的域名；该域名必须已经托管在当前 Cloudflare account 下。

## Flask 版常用环境变量

- `EMAIL_MANAGEMENT_WORKER_DB_PATH`：SQLite 数据库文件路径
- `EMAIL_MANAGEMENT_WORKER_SENSITIVE_KEY_PATH`：完整账号资料加密 key 文件路径
- `EMAIL_MANAGEMENT_WORKER_AUTH_SESSION_TTL_DAYS`：登录会话有效天数
- `EMAIL_MANAGEMENT_WORKER_LOGIN_MAX_FAILED_ATTEMPTS`：登录失败次数上限
- `EMAIL_MANAGEMENT_WORKER_LOGIN_RATE_WINDOW_MINUTES`：登录失败统计窗口
- `EMAIL_MANAGEMENT_WORKER_LOGIN_LOCKOUT_MINUTES`：触发限速后的锁定时间
- `EMAIL_MANAGEMENT_WORKER_TURNSTILE_SITE_KEY`：Cloudflare Turnstile 前端 site key
- `EMAIL_MANAGEMENT_WORKER_TURNSTILE_SECRET_KEY`：Cloudflare Turnstile 后端 secret key
- `EMAIL_MANAGEMENT_WORKER_FRONTEND_DIR`：前端静态目录
- `EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_ID`
- `EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_SECRET`
- `EMAIL_MANAGEMENT_WORKER_GOOGLE_REDIRECT_URI`
- `EMAIL_MANAGEMENT_WORKER_GOOGLE_STATE_SECRET`
- `EMAIL_MANAGEMENT_WORKER_CORS_ORIGIN`：如果前后端不在同一地址，可按需设置

Worker 版常用变量 / secrets：

- `EMAIL_MANAGEMENT_WORKER_SESSION_SECRET`
- `EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET`
- `EMAIL_MANAGEMENT_WORKER_AUTH_SESSION_TTL_DAYS`
- `EMAIL_MANAGEMENT_WORKER_MAIL_FETCH_LIMIT`
- `EMAIL_MANAGEMENT_WORKER_LIVE_TOKEN_URL`
- `EMAIL_MANAGEMENT_WORKER_MS_TOKEN_URL`
- `EMAIL_MANAGEMENT_WORKER_GRAPH_BASE_URL`
- `EMAIL_MANAGEMENT_WORKER_GOOGLE_TOKEN_URL`
- `EMAIL_MANAGEMENT_WORKER_GMAIL_API_BASE_URL`

## 本地验证

后端测试：

```bash
cd /Volumes/SSD/Email\ Tool/email-management-backend
.venv/bin/python -m unittest discover -s tests -v
```

前端构建：

```bash
cd /Volumes/SSD/Email\ Tool/_figma_source
npm run build
```

健康检查：

```bash
curl http://127.0.0.1:8788/healthz
```

## 提示

- 如果只是作为个人邮箱管理工具使用，优先先跑通本地模式
- 如果要自行部署到服务器，请按自己的环境决定进程管理、反向代理、HTTPS 和域名配置
- 仓库提供了相关脚本目录，但不在公开文档里展开平台相关细节

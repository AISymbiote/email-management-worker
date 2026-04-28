# email-management-worker
无需服务器，无需域名，可以一键部署到 Cloudflare Worker 的个人邮箱管理工具。你可以批量导入 Microsoft 邮箱账号，在网页里分组管理，并按需在线查看收件箱或垃圾邮件。

## 选择你的部署方式

- **极简部署**：适合只在一台电脑或一个浏览器里使用，不需要创建 D1 数据库，也不需要设置登录相关 Secret；账号资料只保存在当前浏览器的 IndexedDB，邮件内容只在线读取，不保存到云端。
- **完整部署**：适合希望跨浏览器或跨设备恢复账号资料的使用方式，需要创建 D1 数据库并设置登录与加密 Secret；启用后支持注册、登录和自动同步，敏感凭据会加密后保存到 D1，但邮件内容仍然不会保存到云端。

## 快速开始

### 极简部署

1. 安装依赖：

```bash
npm install
```

2. 复制部署配置模板：

```bash
cp wrangler.example.toml wrangler.toml
```

`wrangler.toml` 是你的本地部署配置，后续可以在里面填写自己的域名或 D1 信息；它不会提交到代码库。

3. 本地预览：

```bash
npm run dev
```

4. 部署：

```bash
npm run deploy
```

极简部署不需要修改 `wrangler.toml` 里的 D1 示例块，保持注释即可。

### 完整部署

1. 安装依赖：

```bash
npm install
```

2. 复制部署配置模板：

```bash
cp wrangler.example.toml wrangler.toml
```

`wrangler.toml` 是你的本地部署配置，后续要在里面填写 D1 信息；它不会提交到代码库。

3. 创建 D1 数据库：

```bash
npx wrangler d1 create email-management-worker-db
```

4. 把返回的 `database_id` 填入 `wrangler.toml`，并取消 D1 配置块的注释：

```toml
[[d1_databases]]
binding = "DB"
database_name = "email-management-worker-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

5. 初始化数据库表：

```bash
npx wrangler d1 migrations apply email-management-worker-db --remote
```

6. 设置登录和加密所需 Secret：

```bash
npx wrangler secret put EMAIL_MANAGEMENT_WORKER_SESSION_SECRET
npx wrangler secret put EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET
```

7. 部署：

```bash
npm run deploy
```

## 自定义域名（可选）

默认会部署到 `workers.dev`。

如果你要绑定自己的域名，只需要修改本地 `wrangler.toml` 中的自定义域名示例块：

```toml
[[routes]]
pattern = "mail.example.com"
custom_domain = true
```

域名需要已经托管在当前 Cloudflare account 下。

## 怎么使用

1. 打开部署后的网页。
2. 点击“导入邮箱”。
3. 按每行一个账号粘贴数据：

```text
邮箱地址----密码----Client ID----刷新令牌
```

4. 导入后可以分组、搜索、批量复制或删除。
5. 点击账号右侧“查看”在线读取邮件。
6. 如果你使用完整部署，可以先注册/登录；登录后账号资料会自动同步。

## 从极简部署升级到完整部署

可以从极简部署升级到完整部署；升级不会主动清空云端或本地数据。但浏览器本地账号是否保留，取决于你是否继续使用同一个访问地址、同一个浏览器，以及是否清理过站点数据。升级前建议先导出备份。

## 数据和隐私说明

### 极简部署

- 账号资料只保存在当前浏览器
- 换浏览器或清空站点数据后，本地账号资料会消失
- 云端不保存账号资料

### 完整部署

会同步到 D1 的普通资料包括：

- 邮箱地址
- 分组
- 状态
- 备注
- 导入序号
- 邮件读取相关的状态信息

会加密后同步到 D1 的敏感资料包括：

- 邮箱密码
- Client ID
- 刷新令牌
- token 过期时间
- 辅助邮箱
- 2FA secret

不会保存到云端的内容：

- 邮件标题
- 发件人
- 邮件正文
- 邮件预览
- 附件
- 邮件列表缓存

## 常用命令

```bash
npm run dev          # 本地预览
npm run check        # 检查代码
npm run deploy       # 部署
```

## 当前限制

- 当前主推 Microsoft Graph 邮件读取
- Graph 不可用的账号无法在 Worker 版中读取邮件
- 极简部署没有登录和云同步
- 完整部署需要正确配置 D1 和 Secret

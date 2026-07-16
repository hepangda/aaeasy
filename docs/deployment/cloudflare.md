# Cloudflare 生产部署

本文描述 AAEasy 当前实现的生产部署步骤。应用选择 **PostgreSQL（推荐 Neon）+ Hyperdrive**，而不是在 Worker 中使用 Neon serverless HTTP driver；这样可以保留现有交互式事务语义，并由 Hyperdrive 负责全局连接复用。

## 1. 前置条件

- Cloudflare 账户已启用 Workers、Durable Objects、R2 和 Browser Run。
- 已有可从公网 TLS 访问的 PostgreSQL；推荐 Neon。
- 已安装 Node.js 22.12+ 和 pnpm 10+。
- `pnpm exec wrangler whoami` 能看到目标 Cloudflare 账户。
- 已确定生产 origin 为 `https://aaeasy.pangda.app`。
- 可以管理 `auth.pangda.app` 与 `auth-staging.pangda.app` 的 KeyForge OAuth clients/resources。

Browser Run Free 当前提供每天 10 分钟、每账户 3 个并发 browser session，并限制每 20 秒启动一个新 browser；Workers Paid 的默认启动速率更高。应用默认用全局 Durable Object 把 PDF 启动间隔限制为 20 秒。参见 [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/) 和 [PDF generation](https://developers.cloudflare.com/browser-run/how-to/pdf-generation/)。

## 2. 准备 PostgreSQL

生产建议分别使用：

- 一个应用角色，交给 Hyperdrive；
- 一个 migration 角色，通过 `DIRECT_DATABASE_URL` 直连执行 Drizzle migrations。

若使用 Neon，为 Hyperdrive 复制 **未启用 Neon connection pooling** 的连接串。Hyperdrive 已负责连接池，不要再套一层 Neon pooler。参见 [Hyperdrive 连接 Neon](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/)。

全新数据库：

```sh
export DIRECT_DATABASE_URL='postgresql://migration-role:...@.../aaeasy?sslmode=require'
pnpm db:migrate
```

既有 AAEasy 数据库：

```sh
export DIRECT_DATABASE_URL='postgresql://migration-role:...@.../aaeasy?sslmode=require'
pnpm db:adopt -- --yes
```

不要把生产连接串放进 `wrangler.jsonc`。Worker 只读取 `env.HYPERDRIVE.connectionString`。

## 3. 创建 Hyperdrive

```sh
pnpm exec wrangler hyperdrive create aaeasy-production \
  --connection-string='postgresql://hyperdrive-user:...@.../aaeasy' \
  --binding HYPERDRIVE
```

把命令返回的 ID 写入 `wrangler.jsonc`：

```json
{
  "env": {
    "production": {
      "hyperdrive": [
        { "binding": "HYPERDRIVE", "id": "真实 Hyperdrive ID" }
      ]
    }
  }
}
```

本地开发的 `localConnectionString` 只在顶层配置中使用，生产 environment 不继承它。Hyperdrive 本地模式不会启用云端连接池和 query cache；需要验证真实行为时可单独使用 remote development，但会操作远端数据。参见 [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)。

## 4. 创建 R2 bucket

```sh
pnpm exec wrangler r2 bucket create aaeasy-receipts --location apac
```

如果使用其他名称，同步修改 `env.production.r2_buckets`。bucket 必须保持私有，不要配置公开开发域名。Worker 的 `RECEIPTS` binding 是唯一读写入口。

旧 Vercel Blob 或其他对象存储的迁移见 [`../migration/data-cutover.md`](../migration/data-cutover.md)。

## 5. 配置 Pangda Auth

AAEasy 只接受以下两个 issuer：

- 本地开发：`https://auth-staging.pangda.app`
- 生产：`https://auth.pangda.app`

在两个 KeyForge 环境分别创建资源 `https://aaeasy.pangda.app`，允许 scopes：

```json
{
  "resource_uri": "https://aaeasy.pangda.app",
  "name": "AAEasy",
  "allowed_scopes": ["openid", "profile", "email", "groups", "offline_access"]
}
```

然后分别创建同名但环境隔离的 confidential application client。生产配置为：

```json
{
  "client_id": "aaeasy",
  "name": "AAEasy",
  "type": "confidential",
  "client_kind": "application",
  "redirect_uris": ["https://aaeasy.pangda.app/api/auth/callback"],
  "post_logout_redirect_uris": ["https://aaeasy.pangda.app/"],
  "allowed_scopes": ["openid", "profile", "email", "groups", "offline_access"],
  "allowed_grant_types": ["authorization_code", "refresh_token"],
  "allowed_resources": ["https://aaeasy.pangda.app"],
  "default_resource": "https://aaeasy.pangda.app",
  "require_pkce": true
}
```

`auth-staging.pangda.app` 中使用同一策略，但把 redirect URI 和 post-logout URI 分别改为：

```text
http://localhost:5173/api/auth/callback
http://localhost:5173/
```

KeyForge 只在创建 client 时返回一次明文 secret。staging secret 写入本机 `.dev.vars`，production secret 写入 Worker secret，不能提交到仓库。KeyForge 的 `sub` 必须与现有 AAEasy `users.id` 相同；KeyForge alias 通过标准 OIDC `preferred_username` claim 同步到 AAEasy `users.username`；`admins` group 是 AAEasy 超级管理员权限的唯一来源。alias 在 KeyForge 变更后，会在 AAEasy 下次会话重新校验时同步。

## 6. 配置生产变量

在 `wrangler.jsonc` 的 `env.production.vars` 中设置：

- `APP_URL=https://aaeasy.pangda.app`：最终 HTTPS origin，不能带尾部 `/`。
- `OIDC_ISSUER=https://auth.pangda.app`。
- `OIDC_CLIENT_ID=aaeasy`。
- `OIDC_RESOURCE=https://aaeasy.pangda.app`。
- `APP_NAME=AAEasy`。
- `ENVIRONMENT=production`。
- `PDF_LAUNCH_INTERVAL_MS`：Free 保持 `20000`；Paid 可按配额降至 `1000`。

Vite 的 Cloudflare environment 在**构建时**选择，而不是 deploy 时选择。仓库的 `pnpm build` 已设置 `CLOUDFLARE_ENV=production`；不要用裸 `vite build` 替代生产构建。

## 7. 配置 secrets

至少配置 KeyForge client secret 和独立的 OIDC session encryption secret：

```sh
pnpm exec wrangler secret put OIDC_CLIENT_SECRET --env production
pnpm exec wrangler secret put OIDC_SESSION_SECRET --env production
```

`OIDC_SESSION_SECRET` 必须是 32-byte base64url 值，可用 `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` 生成。它只用于 AAEasy 的 OIDC flow Cookie 和服务端 token set 加密，不能与 KeyForge client secret 复用。轮换它会使现有 AAEasy 会话失效。

AI 为可选能力。按实际 provider 配置以下一项或多项：

```sh
pnpm exec wrangler secret put AI_API_URL --env production
pnpm exec wrangler secret put AI_MODEL --env production
pnpm exec wrangler secret put AI_PROVIDER --env production
pnpm exec wrangler secret put AI_GATEWAY_TOKEN --env production
pnpm exec wrangler secret put AI_API_KEY --env production
pnpm exec wrangler secret put DASHSCOPE_API_KEY --env production
pnpm exec wrangler secret put AI_ENABLE_IMAGE_CONTEXT --env production
```

不要设置旧的 `DATABASE_URL`、`NEXT_PUBLIC_*` 或 `BLOB_READ_WRITE_TOKEN` Worker secrets；运行时不再使用它们。

## 8. 构建与部署

```sh
pnpm check
pnpm deploy
```

部署流程会：

1. 拒绝全零 Hyperdrive ID、占位域名或缺失 binding；
2. 用 production Cloudflare environment 构建 SPA 和 Worker；
3. 通过 Vite 生成的扁平 Wrangler 配置部署；
4. 上传静态资产、Worker、Durable Object migrations 和 source maps。

只验证 bundle 和 binding，不实际部署：

```sh
pnpm build
pnpm exec wrangler deploy --dry-run
```

## 9. 域名与上线检查

在 Cloudflare Dashboard 给 Worker 绑定最终 custom domain。域名必须与 `APP_URL` 完全一致；更改后重新部署。

```sh
curl -fsS https://aaeasy.pangda.app/api/health
```

期望返回 `runtime: cloudflare-workers`、`framework: hono`、健康的 PostgreSQL 和 Durable Object。随后人工验证：

1. 从 AAEasy 跳转 Pangda Auth 登录、回调、刷新页面和 RP logout；确认本地没有注册、密码或 Passkey 入口；
2. 用 `admins` group 用户验证超级管理员越权视图，用普通用户确认没有该权限；
3. 创建账本、费用和分摊；
4. 两个浏览器同时打开账本，确认 WebSocket 自动刷新；
5. 只读 / 可写分享权限；
6. 图片和 PDF 小票上传、查看、删除；
7. CSV 导出；
8. 中文、多页 PDF 导出；
9. 结算、重开、成员转移和 AAEasy 数据删除（KeyForge 账号应保留）。

Browser Run 已预装 Noto CJK 和 WenQuanYi Zen Hei，当前 PDF CSS 优先使用 `Noto Sans CJK SC`，无需自带字体或 Container。参见 [supported fonts](https://developers.cloudflare.com/browser-run/reference/supported-fonts/)。

常规 `pnpm dev` 不连接远程 browser。需要在本地验证真实 PDF 时，先确认 Wrangler 已登录，再运行 `pnpm dev:pdf`；该命令会把 `BROWSER` binding 临时设为 remote，并消耗目标账户 Browser Run 配额。

## 10. 监控与运维

- Wrangler 已启用 Workers observability 和 source maps。
- 关注 Worker 5xx、Hyperdrive origin errors、DO exceptions、R2 errors 和 Browser Run 429。
- PDF 429 会返回 `Retry-After`；不要由客户端紧密重试。
- `GroupRoom` 只保存最近 256 个 revision events。断线超过窗口时客户端收到 `resync` 并重新拉取 PostgreSQL 快照。
- R2 删除采用数据库提交后异步删除；应定期做数据库 `objectKey` 与 bucket inventory 的孤儿对象审计。

## 11. 回滚

- DNS 切换前保留旧应用只读版本和数据库备份。
- OIDC migration 会删除本地密码、Passkey、挑战、注册白名单并清空旧 AAEasy session；旧版本应用无法在该 schema 上恢复登录。上线前必须保留数据库备份，若需回滚旧版本必须同时恢复迁移前数据库。
- 一旦新 Worker 接受 R2 小票上传，旧 Vercel Blob 应用无法读取这些新对象；回滚前必须暂停小票上传或把新增对象反向复制。
- DO 或 Browser Run 故障不要求回滚数据库：前者只影响实时刷新，后者只影响 PDF。

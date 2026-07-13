# Cloudflare 生产部署

本文描述 AAEasy 当前实现的生产部署步骤。应用选择 **PostgreSQL（推荐 Neon）+ Hyperdrive**，而不是在 Worker 中使用 Neon serverless HTTP driver；这样可以保留现有交互式事务语义，并由 Hyperdrive 负责全局连接复用。

## 1. 前置条件

- Cloudflare 账户已启用 Workers、Durable Objects、R2 和 Browser Run。
- 已有可从公网 TLS 访问的 PostgreSQL；推荐 Neon。
- 已安装 Node.js 22.12+ 和 pnpm 10+。
- `pnpm exec wrangler whoami` 能看到目标 Cloudflare 账户。
- 已确定最终 HTTPS origin，例如 `https://aaeasy.example.com`。

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

## 5. 配置生产变量

在 `wrangler.jsonc` 的 `env.production.vars` 中设置：

- `APP_URL`：最终 HTTPS origin，不能带尾部 `/`；WebAuthn origin 和 secure cookie 依赖它。
- `APP_NAME`：Passkey 提示中的应用名称。
- `ENVIRONMENT=production`。
- `PDF_LAUNCH_INTERVAL_MS`：Free 保持 `20000`；Paid 可按配额降至 `1000`。

Vite 的 Cloudflare environment 在**构建时**选择，而不是 deploy 时选择。仓库的 `pnpm build` 已设置 `CLOUDFLARE_ENV=production`；不要用裸 `vite build` 替代生产构建。

## 6. 配置 secrets

至少配置管理员入口和初始用户名 allowlist：

```sh
pnpm exec wrangler secret put ADMIN_SECRET --env production
pnpm exec wrangler secret put INITIAL_ALLOWED_USERNAMES --env production
```

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

## 7. 构建与部署

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

## 8. 域名与上线检查

在 Cloudflare Dashboard 给 Worker 绑定最终 custom domain。域名必须与 `APP_URL` 完全一致；更改后重新部署。

```sh
curl -fsS https://aaeasy.example.com/api/health
```

期望返回 `runtime: cloudflare-workers`、`framework: hono`、健康的 PostgreSQL 和 Durable Object。随后人工验证：

1. allowlist 用户注册、密码登录和 Passkey 登录；
2. 创建账本、费用和分摊；
3. 两个浏览器同时打开账本，确认 WebSocket 自动刷新；
4. 只读 / 可写分享权限；
5. 图片和 PDF 小票上传、查看、删除；
6. CSV 导出；
7. 中文、多页 PDF 导出；
8. 结算、重开、成员转移和账号删除。

Browser Run 已预装 Noto CJK 和 WenQuanYi Zen Hei，当前 PDF CSS 优先使用 `Noto Sans CJK SC`，无需自带字体或 Container。参见 [supported fonts](https://developers.cloudflare.com/browser-run/reference/supported-fonts/)。

常规 `pnpm dev` 不连接远程 browser。需要在本地验证真实 PDF 时，先确认 Wrangler 已登录，再运行 `pnpm dev:pdf`；该命令会把 `BROWSER` binding 临时设为 remote，并消耗目标账户 Browser Run 配额。

## 9. 监控与运维

- Wrangler 已启用 Workers observability 和 source maps。
- 关注 Worker 5xx、Hyperdrive origin errors、DO exceptions、R2 errors 和 Browser Run 429。
- PDF 429 会返回 `Retry-After`；不要由客户端紧密重试。
- `GroupRoom` 只保存最近 256 个 revision events。断线超过窗口时客户端收到 `resync` 并重新拉取 PostgreSQL 快照。
- R2 删除采用数据库提交后异步删除；应定期做数据库 `objectKey` 与 bucket inventory 的孤儿对象审计。

## 10. 回滚

- DNS 切换前保留旧应用只读版本和数据库备份。
- Drizzle 接管只新增 migration metadata、`groups.revision` 与 `expenses.version`，旧 schema 可读取这些新增列之外的数据。
- 一旦新 Worker 接受 R2 小票上传，旧 Vercel Blob 应用无法读取这些新对象；回滚前必须暂停小票上传或把新增对象反向复制。
- DO 或 Browser Run 故障不要求回滚数据库：前者只影响实时刷新，后者只影响 PDF。

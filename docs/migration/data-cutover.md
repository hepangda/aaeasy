# 数据与对象存储切流

本文用于把旧 AAEasy 部署切换到 Cloudflare Worker。目标是单写、可校验、可回滚，不运行长期双写。

## 迁移对象

- PostgreSQL：迁移前的 19 张表及全部业务行；迁移后保留 15 张业务/会话表。
- Schema 增量：`groups.revision bigint not null default 0`、`expenses.version integer not null default 1`，以及 OIDC 用户资料和加密会话字段。
- 认证切换：删除 `allowed_usernames`、`auth_challenges`、`passkey_credentials`、`password_credentials`，清空不能迁移到 OIDC 的旧 `sessions`；`users.id` 和全部业务外键保持不变。
- Drizzle metadata：`drizzle.__drizzle_migrations`。
- 小票对象：按数据库中的 `receipts.objectKey` 原样复制到私有 R2。
- 不迁移 XLSX 逻辑；新系统保留 CSV 和 PDF。
- 实时事件不迁移。Durable Object 在切流后按数据库 revision 建立新事件历史。

## 路径 A：沿用原 PostgreSQL

该路径停机最短。先备份并冻结旧应用写入，然后在原库执行：

```sh
export DIRECT_DATABASE_URL='postgresql://...'
pnpm db:adopt -- --yes
```

脚本会验证既有 19 张表，登记 baseline，再依次应用 Cloudflare revision 与 Pangda Auth OIDC migration。若 revision 列已由其他流程创建，脚本会登记对应 migration 后继续执行 OIDC migration。

OIDC migration 不可逆地删除本地登录凭据。执行前必须确认每个需要保留的 KeyForge 用户 `sub` 与对应 AAEasy `users.id` 完全一致，并保留迁移前数据库备份。首次 OIDC 登录会把 KeyForge `preferred_username`（alias）同步到对应的 AAEasy `users.username`。

## 路径 B：迁移到 Neon

先创建目标数据库和 migration role。使用 PostgreSQL 原生工具进行一次全量复制：

```sh
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=/secure/path/aaeasy.dump

pg_restore \
  --dbname="$TARGET_DIRECT_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  /secure/path/aaeasy.dump

DIRECT_DATABASE_URL="$TARGET_DIRECT_DATABASE_URL" pnpm db:adopt -- --yes
```

大库可先做预迁移，再在维护窗口使用 provider replication 或最后一次 dump/restore；切流时只能有一个写入方。

## PostgreSQL 校验

在源库和目标库分别记录以下结果并比较：

```sql
select 'users' as table_name, count(*) from users
union all select 'groups', count(*) from groups
union all select 'members', count(*) from members
union all select 'group_memberships', count(*) from group_memberships
union all select 'expenses', count(*) from expenses
union all select 'expense_splits', count(*) from expense_splits
union all select 'receipts', count(*) from receipts
union all select 'settlements', count(*) from settlements
union all select 'settlement_entries', count(*) from settlement_entries
union all select 'share_links', count(*) from share_links
union all select 'share_sessions', count(*) from share_sessions;
```

检查关键引用和新增列：

```sql
select count(*) as orphan_splits
from expense_splits s left join expenses e on e.id = s."expenseId"
where e.id is null;

select count(*) as orphan_receipts
from receipts r left join expenses e on e.id = r."expenseId"
where e.id is null;

select count(*) as invalid_versions from expenses where version < 1;
select count(*) as invalid_revisions from groups where revision < 0;

select id, "groupId", "amountMinor"
from expenses
where "amountMinor" is not null and "amountMinor" < 0
limit 20;
```

再随机抽取账本，对比成员数、费用总数、summary 和 settlement transfers。

## 复制小票到 R2

R2 importer 不改数据库。它把每个源对象上传到**完全相同的 `objectKey`**，因此切流后 Worker 可直接读取既有 `receipts` 行。

先从旧对象存储生成 JSONL manifest。私有对象应使用短期签名 URL，或通过 `RECEIPT_SOURCE_BEARER_TOKEN` 提供 bearer token；不要提交 manifest 或 token。

```json
{"objectKey":"groups/abc/expenses/def/receipt.jpg","sourceUrl":"https://signed.example/receipt.jpg","mime":"image/jpeg","sizeBytes":123456}
```

校验 manifest：

```sh
pnpm r2:migrate -- \
  --manifest /secure/path/receipts.jsonl \
  --bucket aaeasy-receipts \
  --remote \
  --dry-run
```

先在本地 R2 模拟存储演练：

```sh
pnpm r2:migrate -- \
  --manifest /secure/path/receipts.jsonl \
  --bucket aaeasy-receipts-dev \
  --local
```

生产复制需要显式确认：

```sh
export RECEIPT_SOURCE_BEARER_TOKEN='仅在源站需要时设置'
pnpm r2:migrate -- \
  --manifest /secure/path/receipts.jsonl \
  --bucket aaeasy-receipts \
  --remote \
  --env production \
  --yes
```

Importer 会逐对象校验 HTTP 状态和可选 `sizeBytes`，上传失败立即停止，并保持已上传对象可重复覆盖。重复 `objectKey` 会在开始前被拒绝。

复制后至少校验：

1. manifest 行数等于 `select count(*) from receipts`；
2. R2 inventory 的对象数和总大小不小于 manifest；
3. 随机抽样 JPEG、PNG、HEIC 和 PDF；
4. 使用新 Worker 的鉴权下载接口验证，而不是公开 R2 URL；
5. 删除一张测试小票，确认数据库行和 R2 对象都消失。

## 最终切流顺序

1. 将旧应用切为维护 / 只读模式。
2. 等待在途请求结束，记录冻结时间。
3. 完成最后一次 PostgreSQL 同步或原库接管。
4. 运行 row count、引用和金额校验。
5. 完成 R2 增量复制并抽样。
6. 确认 `wrangler.jsonc` 的 production Hyperdrive、R2、APP_URL 和 secrets。
7. 执行 `pnpm check` 和 `pnpm deploy`。
8. 用 Worker URL 完成 Pangda Auth 登录/退出、写入、WebSocket、R2、CSV、PDF smoke test。
9. 切 custom domain / DNS。
10. 观察至少一个业务高峰后，再撤下旧部署；旧 Blob 先保留一个回滚窗口。

## 写入后回滚

OIDC schema 不兼容旧应用的本地登录实现。回滚旧应用时必须恢复迁移前数据库备份；仅切换代码或 DNS 无法恢复密码/Passkey 登录。恢复后仍需处理两类新数据：

- 新 Worker 创建的小票只存在 R2，旧 Blob reader 无法读取；
- 新 Worker 的 WebSocket revision history 只存在 DO storage，但它不是业务事实，不需要回迁。

因此回滚动作是：暂停新写入、反向复制回滚窗口内新增 R2 对象（或临时禁用旧应用的小票查看）、切回旧域名，再恢复旧写入。不要同时开放两个写入端。

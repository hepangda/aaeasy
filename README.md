# AAEasy

A self-hosted, PWA-ready Next.js app for tracking shared expenses with
friends. Built for everyday "drop-in" bookkeeping: anyone can be invited
(or handed a share link as a guest), and balances + minimum-transfer
instructions are computed automatically with high-precision decimal math.

## Features

- 🔐 **Multi-method auth** — Passkey (WebAuthn), username + Argon2id
  password, multiple credentials per account, plus admin-managed username
  allowlist for closed deployments.
- 🔗 **Anonymous share links** — hand a link (with optional passcode,
  expiry, read / write scope) to a guest member so they can drop in
  without an account; can later "claim" the membership by linking a real
  user.
- 👥 **One-shot groups** — settle once and the group archives itself;
  reopen with one click if you need to keep going.
- 🧮 **Three split rules** — equal, subset-equal, weighted (integer
  "shares" UI by default); cents are distributed deterministically so
  every cent is accounted for.
- 💰 **Multi-currency** — FX rate is frozen per expense
  (frankfurter.app + in-memory cache); each member has a preferred display
  currency.
- 🤖 **AI-assisted entry** — paste a sentence (or upload a photo of the
  receipt) and a Cloudflare AI Gateway-fronted LLM pre-fills the form.
  You always review before submit.
- 📷 **Receipt uploads** to Vercel Blob (signed direct uploads, no proxy).
- 🔄 **Live multi-user editing** via Postgres `LISTEN` / `NOTIFY` + SSE —
  open the same group on two tabs and edits stream in.
- 📤 **CSV / Excel / PDF export** of expenses, summaries, and the final
  set of transfers. PDF bundles Noto Sans SC so Chinese renders on
  Vercel by default.
- 🌏 **Bilingual** (中文 / English) UI via `next-intl`, cookie-based locale.
- 📲 **Installable PWA** with offline read-only fallback and themed icons.

## Tech stack

| Layer       | Choice                                                         |
| ----------- | -------------------------------------------------------------- |
| Framework   | Next.js 16 (App Router) + React 19 + TypeScript                |
| Styling     | Tailwind CSS v4 + shadcn/ui + Radix primitives                 |
| Data        | PostgreSQL 17 + Prisma 6                                       |
| Realtime    | `pg` LISTEN/NOTIFY → Server-Sent Events                        |
| Auth        | Argon2id (`@node-rs/argon2`) + WebAuthn (`@simplewebauthn/*`)  |
| Money       | `decimal.js` for arithmetic, Frankfurter for FX                |
| Storage     | Vercel Blob (signed client uploads)                            |
| AI          | Cloudflare AI Gateway (DeepSeek / Qwen / DashScope-compatible) |
| Export      | `exceljs` (xlsx), `@react-pdf/renderer` (pdf), CSV in-house    |
| i18n        | `next-intl` (cookie-based locale)                              |
| Theming     | `next-themes` (light / dark / system)                          |
| Tests       | Vitest                                                         |
| Deploy      | Vercel-first; Docker multi-stage image for self-hosting        |

## Quick start

```sh
# 1. Node ≥ 22.12 (Prisma 6 requirement). Tested with 22.x and 23.x.
node --version

# 2. Install dependencies
pnpm install

# 3. Boot Postgres
docker compose up -d postgres

# 4. Configure environment
cp .env.example .env
#    See `.env.example` for every variable. The minimum to boot is
#    DATABASE_URL + NEXT_PUBLIC_APP_URL + ADMIN_SECRET.

# 5. Apply database migrations
pnpm db:migrate        # creates / updates schema; auto-runs db:generate

# 6. Start the dev server
pnpm dev
# → http://localhost:3000
```

For receipt uploads, create a Vercel Blob store and pull
`BLOB_READ_WRITE_TOKEN` with `vercel env pull`.

For AI-assisted entry, point `AI_API_URL` at a Cloudflare AI Gateway
endpoint that proxies an OpenAI-compatible chat completion API and set
`AI_GATEWAY_TOKEN`. See `src/lib/expenses/ai-parse.ts` for the full set
of supported variables.

## Available scripts

```sh
pnpm dev              # Next.js dev server
pnpm build            # Production build (standalone output)
pnpm start            # Run the production build
pnpm lint             # ESLint
pnpm format           # Prettier write
pnpm format:check     # Prettier check (CI)
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest run
pnpm test:watch       # Vitest watch
pnpm test:coverage    # Vitest coverage
pnpm db:generate      # Generate Prisma client
pnpm db:migrate       # Create / apply dev migration
pnpm db:deploy        # Apply migrations (production)
pnpm db:studio        # Prisma Studio GUI
pnpm ai:speed         # Latency benchmark for the AI parse endpoint
```

`scripts/smoke/` contains phase-by-phase end-to-end smoke scripts (`p2`
through `p6`) that exercise live database flows. Run any of them with
`pnpm tsx scripts/smoke/<file>` against a development database.

## Project layout

```
src/
  app/                       Next.js App Router
    (root)                   Landing, manifest, layout, global CSS
    login/, register/        Auth pages
    account/                 Profile, credentials, admin sub-pages
    groups/                  Group list + detail + expense flows
    s/[token]/               Anonymous share-link landing
    admin/[secret]/          Super-admin entry point
    api/                     Route handlers
      groups/[id]/stream     SSE feed (LISTEN/NOTIFY bridge)
      groups/[id]/export     CSV / XLSX / PDF download
      groups/[id]/expenses/  CRUD, receipts (sign), AI parse
      webauthn/              Passkey register + login challenges
  components/                Client / server UI, grouped by domain
    auth/                    Login, register, passkey, password, allowlist
    account/                 Display-name + account-delete
    group/                   Members, roles, settings, live refresh
    share/                   Share-link dialog, unlock, revoke
    expense/                 Form, draft fill, receipts, split badges
    settle/                  Settle, reopen, transfers, exports
    layout/                  Site header, theme, locale, SW register
    ui/                      shadcn/ui primitives (button, dialog, …)
  lib/                       Server-only domain logic
    auth/                    Sessions, passwords, passkeys, share sessions
    expenses/                Actions, queries, AI parsing + prompts
    groups/                  Group + share-link actions
    settle/                  Settlement snapshotting + reopen
    split/                   Split-rule algorithms (equal / subset / weighted)
    settle/index.ts          Min-transfer algorithm
    fx/                      Currency conversion + cache
    money/                   Decimal helpers (currency-aware rounding)
    export/                  CSV / XLSX / PDF builders + shared data shape
    storage/                 Vercel Blob client wrappers
    realtime/                pg LISTEN/NOTIFY pub/sub + SSE client hook
    admin/                   Super-admin server actions
    db.ts                    Prisma singleton
  i18n/                      next-intl config + server actions
messages/                    en.json / zh.json translation dictionaries
prisma/
  schema.prisma              Database schema
  migrations/                SQL migrations (kept in sync with schema)
public/                      Icons, PWA service worker
scripts/
  ai-speed.ts                AI latency benchmark (`pnpm ai:speed`)
  gen-icons.ts               One-off PWA icon generator
  smoke/                     Phase 2–6 end-to-end smoke scripts
Dockerfile                   Production image (Next.js standalone)
docker-compose.yml           Local Postgres (and a runtime profile)
```

## Deployment

### Vercel

The repo is wired for Vercel out of the box. Set the same variables as
`.env.example` in the project settings, create a Vercel Blob store, and
deploy. `@vercel/speed-insights` is enabled in the root layout.

### Docker

```sh
docker build -t aaeasy .
docker run --rm -p 3000:3000 \
  --env-file .env \
  aaeasy
```

The Dockerfile produces a Next.js standalone build on `node:22-alpine`
and installs `font-noto-cjk` so PDF exports render Chinese without
extra configuration.

## License

MIT


# AAEasy

> 把 AA 算清楚，把朋友处长久 / Settle group bills the easy way.

A self-hosted, PWA-ready Next.js app for tracking shared expenses with friends.
Built for everyday "drop-in" bookkeeping: anyone can be invited (or hand a
share link to a guest), and balances + transfer instructions are computed
automatically with high-precision arithmetic.

## Features (planned)

- 🔐 Passkey + username/password sign-in, plus anonymous one-shot share links (read & write scopes, expiry, optional passcode)
- 👥 One-shot groups: settle once, then archive (with a one-click reopen if you need to keep going)
- 🧮 Three split rules: equal, subset-equal, weighted (integer "shares" UI by default)
- 💰 Multi-currency with frozen FX rate per expense (frankfurter.app + cache)
- 📷 Receipt uploads to Vercel Blob
- 🔄 Live multi-user editing via Postgres `LISTEN`/`NOTIFY` + SSE
- 📤 CSV / Excel / PDF export of expenses, summaries, and settlement instructions
- 🌏 Bilingual (中文 / English) UI
- 📲 Installable PWA with offline read-only view

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui + Radix primitives |
| Data | PostgreSQL 17 + Prisma 6 |
| Auth | Argon2id (password) + WebAuthn (Passkey) + opaque session tokens |
| Storage | Vercel Blob |
| i18n | next-intl (cookie-based locale) |
| Theming | next-themes (light / dark / system) |
| Tests | Vitest |

## Quick start (development)

```sh
# 1. Install Node ≥ 22.12 (Prisma 6 requirement). Tested with 22.x and 23.x.
node --version

# 2. Install dependencies
pnpm install

# 3. Boot Postgres
docker compose up -d postgres

# 4. Configure environment
cp .env.example .env

# 5. Apply database migrations
pnpm db:migrate            # creates initial schema
pnpm db:generate           # regenerate Prisma client (auto by db:migrate)

# 6. Start the dev server
pnpm dev
# → http://localhost:3000
```

Create a Vercel Blob store for the project, then pull `BLOB_READ_WRITE_TOKEN`
with `vercel env pull` for local receipt uploads.

## Available scripts

```sh
pnpm dev              # Next.js dev server
pnpm build            # Production build
pnpm start            # Run production build
pnpm lint             # ESLint
pnpm format           # Prettier write
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest run
pnpm test:watch       # Vitest watch
pnpm test:coverage    # Vitest coverage (lib/**)
pnpm db:generate      # Generate Prisma client
pnpm db:migrate       # Create / apply dev migration
pnpm db:deploy        # Apply migrations (production)
pnpm db:studio        # Prisma Studio GUI
```

## Project layout

```
src/
  app/                    Next.js App Router routes
    login/, register/     Auth pages
  components/             Shared UI (incl. shadcn/ui in components/ui)
  i18n/                   next-intl config + server actions
  lib/
    auth/                 Password (argon2id) + sessions + tokens
    db.ts                 Prisma singleton
    utils.ts              cn() helper
messages/
  zh.json, en.json        Translation dictionaries
prisma/
  schema.prisma           Database schema
docker-compose.yml        Local Postgres
Dockerfile                Production image (Next.js standalone)
```

## Status

Currently at **Phase 1** — project skeleton, basic auth, i18n, theming.
See `memories/session/plan.md` for the full roadmap (Phases 2–6 cover Passkey,
share links, expenses + algorithms, realtime, settlement, exports, PWA).

## License

MIT

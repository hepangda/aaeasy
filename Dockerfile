# ── Build stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm db:generate && pnpm build

# ── Runtime stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# CJK fonts for PDF export (@react-pdf/renderer). Without these, Chinese
# text falls back to Helvetica and renders as tofu/garbled glyphs.
RUN apk add --no-cache font-noto-cjk

# Copy built standalone output (Next.js automatically traces deps).
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000
CMD ["node", "server.js"]

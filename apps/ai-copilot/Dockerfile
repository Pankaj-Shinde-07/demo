# Multi-stage Dockerfile for AI Copilot service
# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/ai-copilot/package*.json ./apps/ai-copilot/

RUN npm install --workspace=apps/ai-copilot

COPY apps/ai-copilot ./apps/ai-copilot

WORKDIR /app/apps/ai-copilot
RUN npm run build

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY package*.json ./
COPY apps/ai-copilot/package*.json ./apps/ai-copilot/

RUN npm install --workspace=apps/ai-copilot --omit=dev && \
    npm cache clean --force

# W4 RRF-tuning pass: replaced `RUN chown -R nestjs:nodejs /app` (≈28 min/rebuild on
# this disk — it re-chowned the whole node_modules tree on every source change) with a
# targeted COPY --chown. Root-owned node_modules stays world-readable for the nestjs
# user; only the dist we copy needs explicit ownership. (Flagged debt from W4-gate.md.)
COPY --from=builder --chown=nestjs:nodejs /app/apps/ai-copilot/dist ./apps/ai-copilot/dist

USER nestjs

WORKDIR /app/apps/ai-copilot

EXPOSE 3110

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3110/ || exit 1

CMD ["node", "dist/main.js"]

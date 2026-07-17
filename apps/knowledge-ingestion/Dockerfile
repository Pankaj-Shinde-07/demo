# Multi-stage Dockerfile for Knowledge Ingestion service
# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/knowledge-ingestion/package*.json ./apps/knowledge-ingestion/

RUN npm install --workspace=apps/knowledge-ingestion

COPY apps/knowledge-ingestion ./apps/knowledge-ingestion

WORKDIR /app/apps/knowledge-ingestion
RUN npm run build

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY package*.json ./
COPY apps/knowledge-ingestion/package*.json ./apps/knowledge-ingestion/

RUN npm install --workspace=apps/knowledge-ingestion --omit=dev && \
    npm cache clean --force

COPY --from=builder /app/apps/knowledge-ingestion/dist ./apps/knowledge-ingestion/dist

RUN chown -R nestjs:nodejs /app

USER nestjs

WORKDIR /app/apps/knowledge-ingestion

EXPOSE 3111

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3111/ || exit 1

CMD ["node", "dist/main.js"]

FROM node:22-alpine AS base

# Install Python3 + litellm for STORM bridge (storm-bridge.py only needs litellm, not knowledge-storm)
RUN apk add --no-cache python3 py3-pip && \
    python3 -m pip install --break-system-packages --no-cache-dir litellm

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && \
    npm ci --omit=dev --maxsockets=1 --fetch-retries=15 --fetch-retry-mintimeout=60000 --fetch-retry-maxtimeout=300000 --fetch-timeout=600000 || \
    (npm config set registry https://registry.npmmirror.com && npm install --omit=dev --maxsockets=1 --fetch-retries=10) || \
    (npm config set registry https://registry.npmjs.org && npm install --omit=dev --maxsockets=1 --fetch-retries=10)

# Build the application
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && \
    npm ci --maxsockets=1 --fetch-retries=15 --fetch-retry-mintimeout=60000 --fetch-retry-maxtimeout=300000 --fetch-timeout=600000 || \
    (npm config set registry https://registry.npmmirror.com && npm install --maxsockets=1 --fetch-retries=10) || \
    (npm config set registry https://registry.npmjs.org && npm install --maxsockets=1 --fetch-retries=10)
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# Prisma 7 generated client location
COPY --from=builder /app/src/generated ./src/generated

# External packages not bundled by Next.js standalone
COPY --from=builder /app/node_modules/nodemailer ./node_modules/nodemailer
COPY --from=builder /app/node_modules/ali-oss ./node_modules/ali-oss
COPY --from=builder /app/node_modules/unpdf ./node_modules/unpdf

# STORM bridge script
COPY --from=builder /app/scripts ./scripts

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=2048"

CMD ["node", "server.js"]

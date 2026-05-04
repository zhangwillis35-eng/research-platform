FROM node:22-alpine AS base

# Install Python3 + litellm for STORM bridge (storm-bridge.py only needs litellm, not knowledge-storm)
RUN apk add --no-cache python3 py3-pip && \
    python3 -m pip install --break-system-packages --no-cache-dir litellm

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --maxsockets=3 --fetch-retries=5 --fetch-retry-mintimeout=20000

# Build the application
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --maxsockets=3 --fetch-retries=5 --fetch-retry-mintimeout=20000
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

# STORM bridge script
COPY --from=builder /app/scripts ./scripts

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=2048"

CMD ["node", "server.js"]

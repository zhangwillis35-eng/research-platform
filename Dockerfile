FROM node:22-alpine AS base

# Install Python3 + STORM dependencies in venv
RUN apk add --no-cache python3 py3-pip py3-virtualenv curl && \
    python3 -m venv /opt/storm-venv && \
    curl -LsSf https://astral.sh/uv/install.sh | sh && \
    export PATH="/root/.local/bin:$PATH" && \
    /root/.local/bin/uv pip install --python /opt/storm-venv/bin/python --no-cache litellm knowledge-storm
ENV PATH="/opt/storm-venv/bin:$PATH"

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build the application
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
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

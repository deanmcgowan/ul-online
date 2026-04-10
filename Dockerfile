FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --no-fund --no-audit

COPY . .

# Accept build-time env vars for Vite frontend
ARG VITE_GOOGLE_STREETVIEW_KEY
ENV VITE_GOOGLE_STREETVIEW_KEY=${VITE_GOOGLE_STREETVIEW_KEY}

# Build the Vite frontend
RUN npm run build

# Compile the server TypeScript
RUN npx tsc -p tsconfig.server.json

# ── Production image ─────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache tini

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit --omit=dev

# Copy built frontend
COPY --from=build /app/dist ./dist

# Copy compiled server
COPY --from=build /app/dist-server ./dist-server

# Data directory for SQLite
RUN mkdir -p /app/data

# Seed with pre-built GTFS database if available (avoids Trafiklab rate limits)
COPY data/gtfs.db* /app/data/

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/app/data/gtfs.db

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist-server/index.js"]
# syntax=docker/dockerfile:1.7

# Stage 1: install all deps (cached when only code changes)
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: build backend (tsc) + frontend (vite)
FROM deps AS build
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build:all

# Stage 3: lean runtime image
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=development
ENV PORT=3000
ENV LIBRAXIS_DB_PATH=/app/data/libraxis.db

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && \
    useradd --system --uid 1001 --home /app libraxis && \
    chown -R libraxis:libraxis /app
USER libraxis

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/index.js"]

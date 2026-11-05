FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS migration
WORKDIR /app
COPY tsconfig.json ./
COPY apps/api ./apps/api
COPY contracts ./contracts
COPY db ./db
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "--import", "tsx", "db/run.ts"]

FROM dependencies AS api-build
COPY tsconfig.json ./
COPY apps/api ./apps/api
COPY contracts ./contracts
COPY db ./db
RUN npm run build:api && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
COPY --from=api-build --chown=node:node /app/node_modules ./node_modules
COPY --from=api-build --chown=node:node /app/dist ./dist
COPY --from=api-build --chown=node:node /app/db/migrations ./db/migrations
COPY --from=api-build --chown=node:node /app/contracts ./contracts
COPY --chown=node:node package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(async r=>{const b=await r.json();process.exit(r.ok&&b.data.checks.database?0:1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/api/apps/api/src/main.js"]

FROM dependencies AS web-build
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.json ./
COPY apps/web ./apps/web
COPY contracts ./contracts
RUN npm run build:web && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=web-build --chown=node:node /app/node_modules ./node_modules
COPY --from=web-build --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=web-build --chown=node:node /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0", "--port", "3000"]

# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS dependencies
WORKDIR /workspace

COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/print-bridge/package.json ./apps/print-bridge/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN npm ci --ignore-scripts --include=optional

FROM dependencies AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8000/api/v1/ws
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_ENABLE_PIN_LOGIN=false
ENV NEXT_PUBLIC_ENABLE_PIN_LOGIN=$NEXT_PUBLIC_ENABLE_PIN_LOGIN

COPY apps/web ./apps/web
COPY packages ./packages
RUN npm run build --workspace web

FROM node:24-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --chown=node:node --from=build /workspace/apps/web/package.json ./apps/web/package.json
COPY --chown=node:node --from=build /workspace/apps/web/.next ./apps/web/.next
COPY --chown=node:node --from=build /workspace/apps/web/public ./apps/web/public
COPY --chown=node:node --from=build /workspace/apps/web/next.config.ts ./apps/web/next.config.ts

USER node
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "web"]

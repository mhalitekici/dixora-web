# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build
WORKDIR /workspace

COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/print-bridge/package.json ./apps/print-bridge/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN npm ci --ignore-scripts --include=optional

COPY packages/config ./packages/config
COPY packages/shared-types ./packages/shared-types
COPY apps/print-bridge ./apps/print-bridge
RUN npm run build --workspace @dixora/config \
    && npm run build --workspace @dixora/shared-types \
    && npm run build --workspace @dixora/print-bridge

FROM node:24-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production

COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/print-bridge/package.json ./apps/print-bridge/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN npm ci --omit=dev --ignore-scripts --include=optional --workspace @dixora/print-bridge

COPY --from=build /workspace/apps/print-bridge/dist ./apps/print-bridge/dist
COPY --from=build /workspace/packages/config/dist ./packages/config/dist
COPY --from=build /workspace/packages/shared-types/dist ./packages/shared-types/dist

USER node
EXPOSE 9100
CMD ["node", "apps/print-bridge/dist/index.js"]

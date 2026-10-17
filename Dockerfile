# syntax=docker/dockerfile:1
# 听书小屋（audiobook-hut）多阶段构建
# 依据：docs/sop/docker.md §4.1
ARG NODE_IMAGE=node:22-alpine

# ---------- 构建阶段：装依赖并编译前端产物 ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ---------- 运行阶段：只保留运行必需的产物 ----------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    APP_PORT=8792 \
    AUDIO_ROOT=/audio
# catalog 由 DockerData 挂载提供（私有数据，不入镜像）
RUN mkdir -p /app/catalog
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/audiobook-server.mjs ./audiobook-server.mjs
EXPOSE 8792
CMD ["node", "audiobook-server.mjs"]

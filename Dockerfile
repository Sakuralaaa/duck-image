# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# DuckAI CPA — 极简运行时镜像（单文件二进制 + Alpine）
#
#   docker build -f Dockerfile.binary -t duckai-cpa:binary .
#   docker run -d --name duckai-cpa -p 8787:8787 \
#     -v duckai-cpa-binary-data:/data duckai-cpa:binary
#
# 设计：
#   - build 阶段用 node:24-bookworm-slim 安装依赖 + 构建管理后台，并从官方 Bun 镜像
#     复制 bun 可执行文件，交叉编译 **musl** 单文件二进制（bun-linux-{x64,arm64}-musl，按 TARGETARCH）；
#   - runtime 阶段只有 alpine:3.20 + ca-certificates + libstdc++（musl 运行时的依赖）+ 二进制；
#     不装 Node.js、npm 或 node_modules。
#   - 镜像未压缩约 150 MB、压缩后约 56 MB（Bun 运行时占体积主体，详见 docs/BINARY-BUILDS.md）。
#
# 可选构建参数：
#   APP_VERSION=0.1.0                仅写入 OCI label / DUCKAI_CPA_VERSION
#   INSTALL_CJK_FONTS=true           安装 font-wqy-zenhei（≈16 MB），供上下文 PDF / 工具协议 PDF 渲染中文；
#                                    默认 true（中文长对话与工具调用依赖它），追求极致体积可传 false。
# ---------------------------------------------------------------------------

# ---------- 构建阶段：web + 单文件二进制 ----------
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build

# 多架构：构建阶段始终跑在构建机原生架构，按 TARGETARCH 交叉编译 musl 二进制（amd64 → x64，arm64 → arm64）
ARG TARGETARCH=amd64

WORKDIR /app

# 从官方 Bun 镜像复用可执行文件（要求 Bun >= 1.4.4；--trim / --asset 需要新版）
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun

# 先装依赖，利用 Docker layer cache
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 构建管理后台 + 交叉编译 musl 单文件二进制
COPY webapp ./webapp
COPY config ./config
COPY src ./src
COPY scripts/build-exe.mjs ./scripts/build-exe.mjs
RUN npm run build:web \
 && case "$TARGETARCH" in arm64) BUN_ARCH=arm64 ;; *) BUN_ARCH=x64 ;; esac \
 && node scripts/build-exe.mjs --target=bun-linux-${BUN_ARCH}-musl --skip-web-build \
 && mkdir -p /app/out && cp dist/linux-${BUN_ARCH}-musl/duckai-cpa dist/linux-${BUN_ARCH}-musl/RUN-README.txt /app/out/

# ---------- 运行阶段：最小 Alpine + 二进制 ----------
FROM alpine:3.20

ARG APP_VERSION=""
ARG INSTALL_CJK_FONTS="true"

ENV DUCKAI_CPA_VERSION=${APP_VERSION} \
    DUCKAI_CPA_HOST=0.0.0.0 \
    DUCKAI_CPA_PORT=8787 \
    DUCKAI_CPA_DATA_DIR=/data \
    NODE_ENV=production

LABEL org.opencontainers.image.title="duckai-cpa" \
      org.opencontainers.image.source="https://github.com/Sakuralaaa/duckai-cpa" \
      org.opencontainers.image.description="Duck.ai -> OpenAI-compatible gateway with admin dashboard (single-binary image)" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="MIT"

# ca-certificates: HTTPS 出站必需；libstdc++: Bun musl 运行时依赖。
# CJK 字体：上下文 PDF 渲染中文所需（默认安装）。
RUN apk add --no-cache ca-certificates libstdc++ \
 && if [ "$INSTALL_CJK_FONTS" = "true" ]; then apk add --no-cache font-wqy-zenhei; fi \
 && addgroup -S -g 10001 duckai \
 && adduser -S -D -H -u 10001 -G duckai duckai \
 && mkdir -p /data/images \
 && chown -R duckai:duckai /data

COPY --from=build /app/out/duckai-cpa /usr/local/bin/duckai-cpa
COPY --from=build /app/out/RUN-README.txt /usr/local/share/duckai-cpa/RUN-README.txt

USER duckai

# 运行数据：config.json / duckai.db / identity.json / pairing.json / images/（生图图库）等
VOLUME ["/data"]

EXPOSE 8787

# 上游异常时 /healthz 仍返回 200（body.upstream.ok=false），这里只检查进程可响应；
# start-period 60s 容忍启动时的挑战预热/身份初始化。
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${DUCKAI_CPA_PORT}/healthz" || exit 1

# 二进制自身处理 SIGTERM/SIGINT（优雅关闭 SSE 与原子写）
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/duckai-cpa"]

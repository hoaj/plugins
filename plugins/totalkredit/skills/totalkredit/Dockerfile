# Remote mode for the totalkredit CLI skill: `totalkredit mcp --http` behind the Owner's sign-in.
# Build context: this folder (skills/totalkredit/). The host provides OWNER_PASSWORD or
# OWNER_PASSWORD_HASH, and PUBLIC_URL (Railway: a generated domain sets RAILWAY_PUBLIC_DOMAIN).
FROM oven/bun:1.4.3 AS build
WORKDIR /src/cli
COPY cli/package.json cli/bun.lock* ./
RUN if [ -f bun.lock ]; then bun install --frozen-lockfile; else bun install; fi
COPY cli/ ./
ARG TARGETARCH
RUN case "$TARGETARCH" in arm64) t=bun-linux-arm64 ;; *) t=bun-linux-x64 ;; esac && bun build.ts "$t" /out/totalkredit

# glibc, no shell, no Chrome: remote mode never launches a browser.
FROM gcr.io/distroless/cc-debian12
COPY --from=build /out/totalkredit /usr/local/bin/totalkredit
# State (oauth.json, session.json) lives under HOME: mount the host's volume on /data.
# Root, because hosts mount volumes owned by root and the state dir must be created there.
ENV HOME=/data PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/totalkredit", "mcp", "--http"]

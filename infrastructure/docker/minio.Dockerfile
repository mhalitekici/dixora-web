# syntax=docker/dockerfile:1.7
# Legacy community registry tags are unavailable on clean CI runners.
# Build the same release as production from immutable official source commits.
FROM golang:1.25.7-alpine AS source
RUN apk add --no-cache git ca-certificates
WORKDIR /src/minio
RUN git init \
    && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin 0d7408fc9969caf07de6a8c3a84f9fbb10a6739e \
    && git checkout --detach FETCH_HEAD
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -o /out/minio .

FROM alpine:3.22.3 AS server
RUN apk add --no-cache ca-certificates
COPY --from=source /out/minio /usr/local/bin/minio
COPY --from=source /src/minio/LICENSE /licenses/minio-LICENSE
COPY --from=source /src/minio/NOTICE /licenses/minio-NOTICE
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="0d7408fc9969caf07de6a8c3a84f9fbb10a6739e" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data"]

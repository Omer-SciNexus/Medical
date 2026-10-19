# Local development and integration tests only. Keep the existing MinIO release.
# Official RELEASE.2025-04-22T22-12-26Z resolves to this immutable source commit.
# https://github.com/minio/minio/tree/0d7408fc9969caf07de6a8c3a84f9fbb10a6739e
FROM golang:1.24.2-alpine AS build
RUN apk add --no-cache ca-certificates curl
WORKDIR /src
RUN curl --fail --location --retry 3 --max-time 180 \
      https://codeload.github.com/minio/minio/tar.gz/0d7408fc9969caf07de6a8c3a84f9fbb10a6739e \
      --output /tmp/minio.tar.gz \
    && echo "7eb30a913fea30f18069abf194e1e78e4983b558cc526911ae1c11396a9859a5  /tmp/minio.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/minio.tar.gz --strip-components=1 \
    && rm /tmp/minio.tar.gz
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/minio .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates curl
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /licenses/minio/LICENSE
COPY --from=build /src/NOTICE /licenses/minio/NOTICE
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data"]

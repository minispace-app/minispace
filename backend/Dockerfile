# Stage 1: Build
FROM rust:alpine AS builder

RUN apk add --no-cache musl-dev openssl-dev pkgconfig

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
# Cache dependencies - create dummy lib and binary files
RUN mkdir src && \
    mkdir -p src/bin && \
    echo "" > src/lib.rs && \
    echo "fn main() {}" > src/main.rs && \
    echo "fn main() {}" > src/bin/encrypt-existing-files.rs && \
    echo "fn main() {}" > src/bin/seed-demo.rs && \
    echo "fn main() {}" > src/bin/purge-data.rs && \
    cargo build --release && \
    rm -rf src

COPY . .
RUN touch src/lib.rs src/main.rs src/bin/seed-demo.rs src/bin/encrypt-existing-files.rs src/bin/purge-data.rs && cargo build --release

# Stage 2: Runtime
FROM alpine:3.20

RUN apk add --no-cache libgcc openssl ca-certificates postgresql-client busybox tzdata

WORKDIR /app
COPY --from=builder /app/target/release/api /app/api
COPY --from=builder /app/target/release/seed-demo /app/seed-demo
COPY --from=builder /app/target/release/purge-data /app/purge-data
COPY --from=builder /app/migrations /app/migrations

EXPOSE 8080

CMD ["/app/api"]

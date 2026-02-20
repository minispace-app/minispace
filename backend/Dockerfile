# Stage 1: Build
FROM rust:alpine AS builder

RUN apk add --no-cache musl-dev openssl-dev pkgconfig

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY . .
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime
FROM alpine:3.20

RUN apk add --no-cache libgcc openssl ca-certificates postgresql-client busybox

WORKDIR /app
COPY --from=builder /app/target/release/api /app/api
COPY --from=builder /app/migrations /app/migrations

EXPOSE 8080

CMD ["/app/api"]

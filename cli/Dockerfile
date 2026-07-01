FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /build

# Copy proto module first (dependency)
COPY proto/go.mod proto/go.sum* ./proto/
COPY proto/ ./proto/

# Copy cli module
COPY cli/go.mod cli/go.sum ./cli/
WORKDIR /build/cli
RUN go mod download

COPY cli/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /deployzy ./cmd/deployzy

# Final image
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tini
COPY --from=builder /deployzy /usr/local/bin/deployzy

ENTRYPOINT ["deployzy"]

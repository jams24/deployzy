.PHONY: all build build-server build-cli test lint clean dev-server dev-certs

all: build

build: build-server build-cli

build-server:
	cd server && go build -o ../bin/servermesrv ./cmd/servermesrv

build-cli:
	cd cli && go build -o ../bin/deployzy ./cmd/deployzy

test:
	cd proto && go test -v ./...
	cd server && go test -v ./...
	cd cli && go test -v ./...

lint:
	cd server && golangci-lint run ./...
	cd cli && golangci-lint run ./...

clean:
	rm -rf bin/

dev-server: dev-certs
	cd server && go run ./cmd/servermesrv --domain=localhost --addr=:8443 --http-addr=:8080 --tls-cert=../certs/server.crt --tls-key=../certs/server.key

dev-certs:
	@mkdir -p certs
	@if [ ! -f certs/server.crt ]; then \
		openssl req -x509 -newkey rsa:4096 -keyout certs/server.key -out certs/server.crt \
			-days 365 -nodes -subj "/CN=localhost" \
			-addext "subjectAltName=DNS:localhost,DNS:*.localhost"; \
		echo "Dev certificates generated in certs/"; \
	fi

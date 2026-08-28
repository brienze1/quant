.PHONY: release release-patch release-minor release-major dev dev-browser forward forward-stop mobile mobile-stop build test

# Auto-bump: make release-patch | release-minor | release-major
# Manual:    make release v=1.0.0

CURRENT_VERSION := $(shell gh release list --repo brienze1/quant --limit 1 --json tagName --jq '.[0].tagName // "v0.0.0"' 2>/dev/null || echo "v0.0.0")
MAJOR := $(shell echo $(CURRENT_VERSION) | sed 's/v//' | cut -d. -f1)
MINOR := $(shell echo $(CURRENT_VERSION) | sed 's/v//' | cut -d. -f2)
PATCH := $(shell echo $(CURRENT_VERSION) | sed 's/v//' | cut -d. -f3)

release:
	@if [ -z "$(v)" ]; then echo "Usage: make release v=1.0.0"; exit 1; fi
	git tag v$(v)
	git push origin v$(v)
	@echo "Release v$(v) triggered. Check: https://github.com/brienze1/quant/actions"

release-patch:
	@$(MAKE) release v=$(MAJOR).$(MINOR).$(shell echo $$(($(PATCH)+1)))

release-minor:
	@$(MAKE) release v=$(MAJOR).$(shell echo $$(($(MINOR)+1))).0

release-major:
	@$(MAKE) release v=$(shell echo $$(($(MAJOR)+1))).0.0

version:
	@echo "Current: $(CURRENT_VERSION)"
	@echo "Next patch: v$(MAJOR).$(MINOR).$(shell echo $$(($(PATCH)+1)))"
	@echo "Next minor: v$(MAJOR).$(shell echo $$(($(MINOR)+1))).0"
	@echo "Next major: v$(shell echo $$(($(MAJOR)+1))).0.0"

dev:
	wails dev

# Dev server reachable in a plain browser (no native window traffic needed
# for backend calls, still spawns the native app as it's the same process).
dev-browser:
	wails dev -browser

FORWARD_PORT := 8081
PID_DIR := /tmp/quant-dev

# Wails' dev asset server binds 127.0.0.1:34115 only, so LAN/mobile clients
# can't reach it directly. socat re-exposes it on all interfaces.
forward:
	@mkdir -p $(PID_DIR)
	@if [ -f $(PID_DIR)/socat.pid ] && kill -0 $$(cat $(PID_DIR)/socat.pid) 2>/dev/null; then \
		echo "forward already running (pid $$(cat $(PID_DIR)/socat.pid))"; \
	else \
		nohup socat TCP-LISTEN:$(FORWARD_PORT),fork,reuseaddr TCP:127.0.0.1:34115 \
			> $(PID_DIR)/socat.log 2>&1 & echo $$! > $(PID_DIR)/socat.pid; \
		echo "forwarding :$(FORWARD_PORT) -> :34115 (pid $$(cat $(PID_DIR)/socat.pid))"; \
	fi
	@echo "phone/browser url: http://$$(ipconfig getifaddr en0):$(FORWARD_PORT)"

forward-stop:
	@if [ -f $(PID_DIR)/socat.pid ]; then \
		kill $$(cat $(PID_DIR)/socat.pid) 2>/dev/null; \
		rm -f $(PID_DIR)/socat.pid; \
		echo "forward stopped"; \
	else \
		echo "forward not running"; \
	fi

# Starts dev server + LAN forward together, for accessing quant from an
# iPhone/other device on the same network (see forward target above).
mobile:
	@mkdir -p $(PID_DIR)
	@if [ -f $(PID_DIR)/wails.pid ] && kill -0 $$(cat $(PID_DIR)/wails.pid) 2>/dev/null; then \
		echo "wails dev already running (pid $$(cat $(PID_DIR)/wails.pid))"; \
	else \
		nohup wails dev -browser > $(PID_DIR)/wails.log 2>&1 & echo $$! > $(PID_DIR)/wails.pid; \
		echo "wails dev starting (pid $$(cat $(PID_DIR)/wails.pid)), see $(PID_DIR)/wails.log"; \
	fi
	@sleep 3
	@$(MAKE) forward

mobile-stop: forward-stop
	@if [ -f $(PID_DIR)/wails.pid ]; then \
		kill $$(cat $(PID_DIR)/wails.pid) 2>/dev/null; \
		rm -f $(PID_DIR)/wails.pid; \
		echo "wails dev stopped"; \
	else \
		echo "wails dev not running"; \
	fi

build:
	wails build

uninstall:
	brew uninstall quant

retap:
	brew untap brienze1/tap
	brew tap brienze1/tap

install:
	brew install quant

update:
	brew update
	brew upgrade quant

# Run Go tests with the race detector. issue #50 unit tests for the typed
# input validator and <quant-output> sentinel extractor live in
# internal/application/service/*_test.go.
test:
	go test -race ./...

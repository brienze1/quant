.PHONY: release release-patch release-minor release-major dev build

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

build:
	wails build

uninstall:
	brew uninstall quant

retap:
	brew untap brienze1/tap
	brew tap brienze1/tap

install:
	brew install quant

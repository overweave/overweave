# One entry point for checking and building. Node runs in containers, so only
# Docker is needed on the development machine.

NODE_IMAGE ?= node:24-alpine

RUN  = docker run --rm -v "$(CURDIR)":/repo -w /repo
NODE = $(RUN) -e npm_config_update_notifier=false -v ow-npmcache:/root/.npm $(NODE_IMAGE)

.PHONY: help deps check lint format typecheck test coverage dist bench

help:
	@echo "make check      everything CI checks: lint and format, types, tests, the built packages imported by Node"
	@echo "make lint / format / typecheck / test / coverage   one of them; format rewrites the files"
	@echo "make bench      core and UI under a real app's load, each run against the one before"

# Reinstall only when the lock file or a package.json changed.
deps: node_modules/.package-lock.json
node_modules/.package-lock.json: $(wildcard package-lock.json) package.json $(wildcard packages/*/package.json)
	$(NODE) npm install --no-audit --no-fund

check: deps
	$(NODE) sh -c 'npm run lint && npm run typecheck && npm test && npm run build && npm run check:dist'

# The packages built, and imported as plain Node imports them (no bundler, no source condition).
dist: deps
	$(NODE) sh -c 'npm run build && npm run check:dist'

lint: deps
	$(NODE) npm run lint

format: deps
	$(NODE) npm run format

typecheck: deps
	$(NODE) npm run typecheck

test: deps
	$(NODE) npm test

coverage: deps
	$(NODE) npm run coverage

# The benches: core and UI under a real app's load (bench-results/*.json), each run against the one before.
bench: deps
	$(NODE) npm run bench

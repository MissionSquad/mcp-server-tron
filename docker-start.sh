#!/bin/sh

set -eu

APP_DIR="/app"
READONLY_FLAG=""

if [ "${MCP_READONLY:-false}" = "true" ]; then
  READONLY_FLAG="--readonly"
fi

exec node build/server/http-server.js ${READONLY_FLAG}

#!/bin/sh

set -eu

APP_DIR="/app"
LOG_DIR="${MCP_LOG_DIR:-${APP_DIR}/logs}"
DATE_TAG="$(date +%F)"
PROJECT_NAME="mcp-server-tron"
COMBINED_LOG="${LOG_DIR}/${PROJECT_NAME}-${DATE_TAG}-combined.log"
ERROR_LOG="${LOG_DIR}/${PROJECT_NAME}-${DATE_TAG}-error.log"

mkdir -p "${LOG_DIR}"
touch "${COMBINED_LOG}" "${ERROR_LOG}"

exec node build/server/http-server.js --readonly >>"${COMBINED_LOG}" 2>>"${ERROR_LOG}"

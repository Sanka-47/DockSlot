#!/bin/sh
set -e

# The API is always the foreground process so Render can route to $PORT and
# receive SIGTERM for the graceful shutdown handler.
#
# The mock carrier is an internal test utility on port 4001. It is opt-in
# because exposing it as the public process breaks /api and CORS.
if [ "${START_MOCK_CARRIER:-false}" = "true" ]; then
  echo "[start] Starting mock carrier on port ${MOCK_CARRIER_PORT:-4001}"
  node dist/mock-carrier/server.js &
  sleep 1
fi

echo "[start] Starting API and outbox worker"
exec node dist/index.js

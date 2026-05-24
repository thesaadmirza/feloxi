#!/bin/sh
set -e

# Next.js standalone bakes the API_URL from next.config.ts into the routes
# manifest at build time. Patch it on startup so the published image honours
# a runtime API_URL without requiring a rebuild.
#
# Verified empirically (Next.js 15.5): the standalone server reads
# routes-manifest.json at startup for rewrite destinations. The other files
# below contain the same URL as metadata; we patch them for consistency.
# The .current file lets us re-patch correctly if API_URL changes between
# restarts of the same container.

MANIFEST="/app/apps/web/.next/routes-manifest.json"
SERVER_FILES="/app/apps/web/.next/required-server-files.json"
SERVER_JS="/app/apps/web/server.js"
BAKED_URL_FILE="/app/.api-url"
CURRENT_URL_FILE="/tmp/.feloxi-api-url.current"

BAKED_URL="$(cat "$BAKED_URL_FILE")"
RUNTIME_URL="${API_URL:-$BAKED_URL}"
CURRENT_URL="$(cat "$CURRENT_URL_FILE" 2>/dev/null || echo "$BAKED_URL")"

if [ "$CURRENT_URL" != "$RUNTIME_URL" ]; then
  sed -i "s|${CURRENT_URL}|${RUNTIME_URL}|g" "$MANIFEST" "$SERVER_FILES" "$SERVER_JS"
  echo "$RUNTIME_URL" > "$CURRENT_URL_FILE"
fi

exec node apps/web/server.js

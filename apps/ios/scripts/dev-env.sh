#!/usr/bin/env bash
# Writes a gitignored .env.local so a dev build knows the gateway URL and (for the first pairing
# only) the gateway token. The token is read from the OpenClaw CLI at runtime, never printed.
#
#   ./scripts/dev-env.sh                      # local simulator / Expo web: ws://127.0.0.1:18789
#   ./scripts/dev-env.sh tailscale            # phone over Tailscale: wss://$EXPO_PUBLIC_ANO_PAIR_HOST
#   ./scripts/dev-env.sh wss://custom.host    # any gateway URL
#
# EXPO_PUBLIC_* values are baked into the dev JS bundle. Use this for development only and delete
# .env.local when you are done. Once the device is paired the app keeps its own device token and
# ignores the shared token (Settings also lets you paste the token by hand instead).
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-local}" in
  local) URL="ws://127.0.0.1:18789" ;;
  tailscale)
    # The Mac's MagicDNS name, from the environment or .env (e.g. my-mac.example-tailnet.ts.net).
    HOST="${EXPO_PUBLIC_ANO_PAIR_HOST:-}"
    if [ -z "$HOST" ] && [ -f .env ]; then
      HOST="$(awk -F= '$1 == "EXPO_PUBLIC_ANO_PAIR_HOST" { print $2 }' .env | tr -d '[:space:]"')"
    fi
    if [ -z "$HOST" ]; then
      echo "set EXPO_PUBLIC_ANO_PAIR_HOST (env or .env) to your Mac's MagicDNS name" >&2
      exit 1
    fi
    URL="wss://$HOST"
    ;;
  *) URL="$1" ;;
esac

if ! command -v openclaw >/dev/null 2>&1; then
  echo "openclaw CLI not found on PATH" >&2
  exit 1
fi

umask 077
TOKEN="$(openclaw gateway auth-token --show | tr -d '[:space:]')"
if [ -z "$TOKEN" ]; then
  echo "could not read the gateway token (run this in an interactive terminal)" >&2
  exit 1
fi
{
  echo "EXPO_PUBLIC_OPENCLAW_URL=$URL"
  echo "EXPO_PUBLIC_OPENCLAW_TOKEN=$TOKEN"
} > .env.local
echo "wrote .env.local for $URL (gitignored, mode 600). Restart Metro to pick it up."

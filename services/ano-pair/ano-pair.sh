#!/usr/bin/env bash
# Manage the ano-pair LaunchAgent (com.ano.pair).
#   ano-pair.sh install | uninstall | restart | status | logs | audit | test | run
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$HERE/run"
# Owner settings live in a git-ignored .env next to this script (copy .env.example).
if [ -f "$HERE/.env" ]; then set -a; . "$HERE/.env"; set +a; fi
LABEL="com.ano.pair"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${ANO_PAIR_PORT:-4391}"
TAILNET_IP="${ANO_PAIR_TAILNET_IP:-}"
NODE_BIN="${ANO_PAIR_NODE:-/opt/homebrew/bin/node}"
DOMAIN="gui/$(id -u)"

die() { echo "error: $*" >&2; exit 1; }
require_env() {
  [ -n "${ANO_PAIR_TAILNET_IP:-}" ] || die "ANO_PAIR_TAILNET_IP is not set (this Mac's \`tailscale ip -4\`); see .env.example"
  [ -n "${ANO_PAIR_ALLOWED_LOGINS:-}" ] || die "ANO_PAIR_ALLOWED_LOGINS is not set (Tailscale logins allowed to pair); see .env.example"
  [ -n "${ANO_PAIR_GATEWAY_URL:-}${ANO_PAIR_MAGICDNS:-}" ] || die "set ANO_PAIR_GATEWAY_URL or ANO_PAIR_MAGICDNS; see .env.example"
}
xml_escape() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; printf '%s' "$s"; }
# Every ANO_PAIR_* variable in the environment (including .env) is passed to the LaunchAgent.
plist_env() {
  local name
  for name in $(compgen -e | grep '^ANO_PAIR_' | grep -v '^ANO_PAIR_NODE$' | sort); do
    printf '    <key>%s</key><string>%s</string>\n' "$name" "$(xml_escape "${!name}")"
  done
}
loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

write_plist() {
  mkdir -p "$RUN" "$(dirname "$PLIST")"
  chmod 700 "$RUN"
  cat >"$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$HERE/server.mjs</string></array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$RUN/service.log</string>
  <key>StandardErrorPath</key><string>$RUN/service.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
$(plist_env)
  </dict>
</dict>
</plist>
PLISTEOF
  plutil -lint "$PLIST" >/dev/null
}

cmd_install() {
  [ -x "$NODE_BIN" ] || die "node not found at $NODE_BIN (set ANO_PAIR_NODE)"
  require_env
  local openclaw="${ANO_PAIR_OPENCLAW_BIN:-/opt/homebrew/bin/openclaw}"
  [ -x "$openclaw" ] || die "openclaw CLI not found at $openclaw (set ANO_PAIR_OPENCLAW_BIN)"
  local free; free="$(df -m "$HERE" | awk 'NR==2{print $4}')"
  [ "$free" -ge 50 ] || die "only ${free} MB free; free disk first"
  write_plist
  loaded && launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  # bootout returns before the job is gone; bootstrapping too early fails with "Input/output error".
  local i; for i in 1 2 3 4 5 6 7 8 9 10; do loaded || break; sleep 0.5; done
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  echo "installed $LABEL (listens on 127.0.0.1:$PORT and $TAILNET_IP:$PORT)"
  sleep 1
  cmd_status
}

cmd_uninstall() {
  loaded && launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "uninstalled $LABEL (run/ logs kept)"
}

cmd_restart() { loaded || die "not installed"; launchctl kickstart -k "$DOMAIN/$LABEL"; sleep 1; cmd_status; }

cmd_status() {
  if loaded; then
    local pid; pid="$(launchctl print "$DOMAIN/$LABEL" | awk '/^[[:space:]]*pid = /{print $3; exit}')"
    echo "launchd: loaded (pid ${pid:-none})"
  else
    echo "launchd: not loaded"
  fi
  echo "listeners on :$PORT (must be only 127.0.0.1 and $TAILNET_IP):"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print "  " $1, $9}' || true
  for h in 127.0.0.1 ${TAILNET_IP:+"$TAILNET_IP"}; do
    printf '%s: ' "$h"
    curl -s -m 3 "http://$h:$PORT/.well-known/ano" || echo "no answer"
    echo
  done
}

cmd_logs() { tail -n "${1:-40}" "$RUN/service.log" 2>/dev/null || echo "no log yet"; }
cmd_audit() { tail -n "${1:-20}" "$RUN/audit.log" 2>/dev/null || echo "no audit log yet"; }
cmd_test() { (cd "$HERE" && "$NODE_BIN" --test --test-timeout=20000 test/*.test.mjs); }
cmd_run() { require_env; exec "$NODE_BIN" "$HERE/server.mjs"; }

case "${1:-status}" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) shift || true; cmd_logs "$@" ;;
  audit) shift || true; cmd_audit "$@" ;;
  test) cmd_test ;;
  run) cmd_run ;;
  *) echo "usage: $0 install|uninstall|restart|status|logs [n]|audit [n]|test|run"; exit 2 ;;
esac

#!/bin/sh
set -eu

usage() {
  printf '%s\n' 'Usage: install-macos.sh --api-url https://api.example.com --code XXXX-XXXX [--name Mac-mini] [--install-root /path]'
}

API_URL=""
ENROLLMENT_CODE=""
BRIDGE_NAME="$(scutil --get ComputerName 2>/dev/null || hostname)"
INSTALL_ROOT="${HOME}/Library/Application Support/DixoraPrintBridge"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-url) API_URL=${2:?missing API URL}; shift 2 ;;
    --code) ENROLLMENT_CODE=${2:?missing enrollment code}; shift 2 ;;
    --name) BRIDGE_NAME=${2:?missing bridge name}; shift 2 ;;
    --install-root) INSTALL_ROOT=${2:?missing install root}; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage; exit 64 ;;
  esac
done

[ -n "$API_URL" ] && [ -n "$ENROLLMENT_CODE" ] || { usage; exit 64; }

NODE_BIN=$(command -v node || true)
[ -n "$NODE_BIN" ] || { printf '%s\n' 'Node.js 22 or newer is required.' >&2; exit 1; }
NODE_MAJOR=$($NODE_BIN --version | sed 's/^v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 22 ] || { printf '%s\n' 'Node.js 22 or newer is required.' >&2; exit 1; }

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)
STATE_DIRECTORY="$INSTALL_ROOT/state"
PLIST_PATH="$HOME/Library/LaunchAgents/com.dixora.print-bridge.plist"
LOG_DIRECTORY="$HOME/Library/Logs/DixoraPrintBridge"

mkdir -p "$INSTALL_ROOT" "$STATE_DIRECTORY" "$LOG_DIRECTORY" "$HOME/Library/LaunchAgents"
if [ "$SOURCE_ROOT" != "$INSTALL_ROOT" ]; then
  ditto "$SOURCE_ROOT" "$INSTALL_ROOT"
fi

export PRINT_BRIDGE_API_URL="${API_URL%/}"
export NODE_ENV="production"
export PRINT_BRIDGE_TRANSPORT="auto"
export PRINT_BRIDGE_PORT="0"
export PRINT_BRIDGE_CREDENTIALS_PATH="$STATE_DIRECTORY/credentials.json"
export PRINT_BRIDGE_JOURNAL_PATH="$STATE_DIRECTORY/journal.json"
"$NODE_BIN" "$INSTALL_ROOT/dist/index.js" enroll --code "$ENROLLMENT_CODE" --name "$BRIDGE_NAME"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dixora.print-bridge</string>
  <key>ProgramArguments</key><array>
    <string>$(xml_escape "$NODE_BIN")</string>
    <string>$(xml_escape "$INSTALL_ROOT/dist/index.js")</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PRINT_BRIDGE_API_URL</key><string>$(xml_escape "$PRINT_BRIDGE_API_URL")</string>
    <key>PRINT_BRIDGE_TRANSPORT</key><string>auto</string>
    <key>PRINT_BRIDGE_PORT</key><string>0</string>
    <key>PRINT_BRIDGE_CREDENTIALS_PATH</key><string>$(xml_escape "$PRINT_BRIDGE_CREDENTIALS_PATH")</string>
    <key>PRINT_BRIDGE_JOURNAL_PATH</key><string>$(xml_escape "$PRINT_BRIDGE_JOURNAL_PATH")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_DIRECTORY/bridge.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_DIRECTORY/bridge-error.log")</string>
</dict>
</plist>
EOF

USER_ID=$(id -u)
launchctl bootout "gui/$USER_ID" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$USER_ID" "$PLIST_PATH"
printf '%s\n' "Dixora Print Bridge installed for $BRIDGE_NAME and started with LaunchAgent."

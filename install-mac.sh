#!/bin/bash
# 安装“记账”菜单栏 App：在 Mac 上编译 LedgerBar.swift，装到 ~/Applications，并设为开机自动启动。
# 用法：curl -fsSL https://zkmfung.github.io/ledger-dashboard/install-mac.sh | bash
set -euo pipefail

BASE="${LEDGER_DASHBOARD_URL:-https://zkmfung.github.io/ledger-dashboard/}"
APP="$HOME/Applications/LedgerBar.app"
AGENT="$HOME/Library/LaunchAgents/com.zkmfung.ledgerbar.plist"

if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "需要先安装“命令行开发者工具”。马上会弹出安装窗口，装好后再运行一次这条命令。"
  xcode-select --install || true
  exit 1
fi

if ! security find-generic-password -s ledger-dashboard >/dev/null 2>&1; then
  echo "钥匙串里还没有看板密码，现在保存一次（输入两次，屏幕上不显示）："
  security add-generic-password -s ledger-dashboard -a "$USER" -w
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
echo "下载源码…"
curl -fsSL "${BASE}LedgerBar.swift" -o "$work/LedgerBar.swift"

echo "编译中（大约半分钟）…"
mkdir -p "$work/LedgerBar.app/Contents/MacOS"
xcrun swiftc -O "$work/LedgerBar.swift" -o "$work/LedgerBar.app/Contents/MacOS/LedgerBar"
cat > "$work/LedgerBar.app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.zkmfung.ledgerbar</string>
  <key>CFBundleName</key><string>记账</string>
  <key>CFBundleDisplayName</key><string>记账</string>
  <key>CFBundleExecutable</key><string>LedgerBar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
codesign --force --sign - "$work/LedgerBar.app" >/dev/null 2>&1 || true

# 换成新版本
launchctl unload "$AGENT" >/dev/null 2>&1 || true
pkill -x LedgerBar >/dev/null 2>&1 || true
mkdir -p "$HOME/Applications"
rm -rf "$APP"
mv "$work/LedgerBar.app" "$APP"

# 开机自动启动
mkdir -p "$(dirname "$AGENT")"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.zkmfung.ledgerbar</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/LedgerBar</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
launchctl load "$AGENT"

# 旧的 SwiftBar 文字菜单不再需要：移出插件文件夹（没删，放在 ~/SwiftBar-old）
if [ -f "$HOME/SwiftBar/ledger.30m.py" ]; then
  mkdir -p "$HOME/SwiftBar-old"
  mv "$HOME/SwiftBar/ledger.30m.py" "$HOME/SwiftBar-old/"
  echo "已停用旧的 SwiftBar 插件（移到了 ~/SwiftBar-old）。不再用 SwiftBar 的话可以退出它：brew uninstall --cask swiftbar"
fi

echo "装好了：点屏幕右上角菜单栏的 ¥ 金额，就会弹出看板。右键可以刷新或退出。"

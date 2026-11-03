#!/bin/bash
# External developer build/install; never invoked by the Obsidian plugin.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="artifacts/Qiaomu Audio Helper.app"
mkdir -p "$APP/Contents/MacOS"
swiftc -swift-version 5 -O -target arm64-apple-macosx14.4 native/apple/main.swift native/apple/SystemAudioTap.swift -o "$APP/Contents/MacOS/qiaomu-audio-helper"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.qiaomu.audio.helper</string>
<key>CFBundleName</key><string>Qiaomu Audio Helper</string>
<key>CFBundleExecutable</key><string>qiaomu-audio-helper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.4</string>
<key>LSUIElement</key><true/>
<key>NSAudioCaptureUsageDescription</key><string>乔木语音读取电脑播放的声音并转成文字，不录屏幕。</string>
<key>NSSpeechRecognitionUsageDescription</key><string>乔木语音使用 Apple 本机模型把录音转成文字。</string>
</dict></plist>
PLIST
codesign --force --sign - --requirements '=designated => identifier "app.qiaomu.audio.helper"' "$APP"
codesign --verify --deep --strict "$APP"
if [[ "${1:-}" == "--install" ]]; then
  # Refuse to replace a running helper.
  if pgrep -f '/Applications/Qiaomu Audio Helper.app/Contents/MacOS/qiaomu-audio-helper' >/dev/null; then echo 'Stop transcription before installing.' >&2; exit 1; fi
  ditto "$APP" '/Applications/Qiaomu Audio Helper.app'
fi

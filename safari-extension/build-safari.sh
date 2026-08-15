#!/usr/bin/env bash
# LowP Safari Web Extension Build & Conversion Script
# Run this on macOS with Xcode installed

set -e

echo "⚡ Converting LowP to Xcode Safari Extension Project for iOS & macOS..."

XCODE_APP_NAME="LowP"
BUNDLE_ID="com.lowp.safari"
OUTPUT_DIR="./safari-xcode-project"

if command -v xcrun &> /dev/null; then
    xcrun safari-web-extension-converter . \
        --project-location "$OUTPUT_DIR" \
        --app-name "$XCODE_APP_NAME" \
        --bundle-identifier "$BUNDLE_ID" \
        --swift \
        --ios-only
    
    echo "✅ Xcode project generated successfully at: $OUTPUT_DIR"
    echo "👉 Open $OUTPUT_DIR/$XCODE_APP_NAME/$XCODE_APP_NAME.xcodeproj in Xcode to build and run on your iPhone or iOS Simulator!"
else
    echo "⚠️ 'xcrun' not found. Please run this command on macOS with Xcode Command Line Tools installed."
fi

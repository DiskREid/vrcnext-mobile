#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f /workspace/.tools/env.sh ]]; then . /workspace/.tools/env.sh; fi
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK (API 35)}"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
cd "$repo_dir"
app_version="$(node -p 'require("./package.json").version')"
npm run android:sync
cd android
if command -v gradle >/dev/null 2>&1; then
  gradle --no-daemon --max-workers=4 :app:assembleDebug
else
  ./gradlew --no-daemon --max-workers=4 :app:assembleDebug
fi
mkdir -p "$repo_dir/artifacts"
cp app/build/outputs/apk/debug/app-debug.apk "$repo_dir/artifacts/VRCNext-Mobile-${app_version}.apk"
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify "$repo_dir/artifacts/VRCNext-Mobile-${app_version}.apk"
cd "$repo_dir/artifacts"
sha256sum "VRCNext-Mobile-${app_version}.apk" > "VRCNext-Mobile-${app_version}.apk.sha256"
printf 'APK: %s/artifacts/VRCNext-Mobile-%s.apk\n' "$repo_dir" "$app_version"

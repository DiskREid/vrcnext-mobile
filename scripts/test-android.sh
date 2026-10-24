#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f /workspace/.tools/env.sh ]]; then . /workspace/.tools/env.sh; fi
cd "$repo_dir"
npm run android:sync
cd android
if command -v gradle >/dev/null 2>&1; then
  gradle --no-daemon --max-workers=4 :app:testDebugUnitTest :app:lintDebug
else
  ./gradlew --no-daemon --max-workers=4 :app:testDebugUnitTest :app:lintDebug
fi

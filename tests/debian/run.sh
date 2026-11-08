#!/bin/bash
set -euo pipefail
cat /etc/os-release
test "$(id -u)" != 0
npm test
dbus-run-session -- xvfb-run -a npx electron tests/desktop-smoke.cjs
dbus-run-session -- xvfb-run -a npx electron tests/main-smoke.cjs
# Validate the Ubuntu-built downloadable tarball against Debian userland too.
mkdir -p /work/debian-package
tar -xzf /work/release/CIQ-Developer-Terminal-*-linux-x64.tar.gz -C /work/debian-package
executable="$(find /work/debian-package -type f -name ciq-developer-terminal -print -quit)"
test -n "$executable"
dbus-run-session -- xvfb-run -a node scripts/smoke-launch.mjs "$executable"

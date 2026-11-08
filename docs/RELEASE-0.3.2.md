# CIQ Developer Terminal 0.3.2 — saved conversation startup fix

**Created by Stefano Roman Gunness · Powered by OpenCode**

Fixes the startup glitch that displayed **“Let’s reopen your workspace”** when
the selected saved conversation contained a failed tool call.

## Root cause and fix

OpenCode persists tool errors as structured `{ type, message }` objects. The
renderer incorrectly treated them as strings and passed the object into React,
causing React error #31. Reloading reopened the same conversation and crashed
again. The updated renderer extracts the error message safely and supports both
structured errors and legacy string errors. Raw provider response objects are
not displayed as error text.

No workspace reset, conversation deletion or key re-entry is needed.

## Verification

- Reproduced the crash against a read-only snapshot of the affected workspace.
- Verified that the corrected renderer opens its saved conversation (27 rendered
  messages) with no recovery screen. Private workspace data is not committed.
- Added a regression fixture for both structured and legacy tool errors. It
  checks opening and reopening a saved conversation, verifies error text, and
  rejects renderer errors, raw response output and the recovery screen.
- The regression check runs against source and packaged renderers on Windows,
  macOS, Ubuntu and Debian 12/13 userland, as part of the release workflow.

Includes 0.3.1 engine lifecycle fixes, health/restart controls, import support,
saved provider keys, free model discovery and verified updates. The preceding
stability validation passed all five platform jobs in
[run 42431803521](https://github.com/stefanoromang/ciq-developer-terminal/actions/runs/42431803521).
See this tag's Actions run for 0.3.2 validation.

Downloads: macOS arm64 ZIP; Windows x64 setup/portable; Linux x64 tarball.
Debian validation uses non-root containers with Debian userland, not bare-metal
desktop certification. Builds remain unsigned and macOS is not notarized.

Original OpenCode source: https://github.com/anomalyco/opencode

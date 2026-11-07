# CIQ Developer Terminal 0.1.1 — Preview

**Created by Stefano Roman Gunness. Designed for CollectivIQ. Powered by OpenCode.**

## This release

- Independent dark desktop interface with official CollectivIQ colors and mark.
- Left-side projects, conversations, MCP connections, memory, models and settings.
- Creator credit in the app and explicit links to the original OpenCode source
  and documentation in Settings and the repository.
- One required Developer/Gateway API key, encrypted local credential storage
  where supported, and a session-only alternative.
- API-derived model catalog, daily/weekly/manual checks, editable project notes,
  local conversation history, tool approvals and a command-output panel.

## macOS Apple Silicon download

Download `CIQ-Developer-Terminal-0.1.1-mac-arm64.zip`, extract it, and place
`CIQ Developer Terminal.app` in `~/Applications`. This is a per-user location;
it does not require an administrator installation.

**Unsigned / not notarized preview:** macOS may warn. Do not disable Gatekeeper
or other security protections. Live gateway use needs your own active
CollectivIQ Developer/Gateway key, entered only in the app.

## What is and is not validated

- macOS arm64 native app, renderer, bundled engine, local fixture generation,
  tool approvals and local MCP lifecycle have passing local checks.
- No real CollectivIQ generation or account entitlement has been tested by the
  maintainer's fixtures. Best of the Best appears only if exposed by the gateway.
- Windows and Debian/Linux build configurations are supplied. They are not
  advertised as validated release downloads until platform tests pass.
- This is not full OpenCode feature parity. No measured speed or memory-use
  advantage over OpenCode is claimed.

## Read a copy of the original OpenCode

CIQ uses the MIT-licensed **OpenCode 2.2.6 engine**. That engine is upstream work,
not original code by Stefano Roman Gunness.

- Original source / download: https://github.com/anomalyco/opencode
- Official docs: https://opencode.ai/v2/docs/
- Integration and attribution: https://github.com/stefanoromang/ciq-developer-terminal/blob/main/docs/OPENCODE.md

The original CIQ application code is source-visible with rights reserved;
third-party components retain their upstream licenses.

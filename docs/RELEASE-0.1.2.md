# CIQ Developer Terminal 0.1.2 — cross-platform preview

**Created by Stefano Roman Gunness. Designed for CollectivIQ. Powered by OpenCode.**

## Choose your download

| Platform | File | Install / run |
|---|---|---|
| Windows 10/11, x64 | `CIQ-Developer-Terminal-0.1.2-windows-x64-setup.exe` | Run as your normal user. Installs in your user profile; installer elevation is disabled. |
| Windows 10/11, x64 portable | `CIQ-Developer-Terminal-0.1.2-windows-x64-portable.exe` | Run directly, without an installer. |
| Linux desktop, x64 | `CIQ-Developer-Terminal-0.1.2-linux-x64.tar.gz` | Extract to a folder you own, then run `./ciq-developer-terminal`. No root installation. |
| macOS, Apple Silicon | [Existing 0.1.1 download](https://github.com/stefanoromang/ciq-developer-terminal/releases/tag/v0.1.1) | Extract and move the app to `~/Applications`. The 0.1.2 macOS CI runner was unavailable. |

Only assets actually attached to this release are available. ARM Windows/Linux
and Intel macOS are not provided by this build matrix.

## Important preview requirements

- Enter your own active **CollectivIQ Developer/Gateway API key** in the app.
  Standard platform keys are different. No real key is included in downloads.
- These downloads are **unsigned**. Windows SmartScreen/macOS Gatekeeper can
  warn; do not disable OS security protections. Code signing is outstanding.
- Linux needs a graphical desktop, glibc and Electron's desktop shared libraries,
  plus working unprivileged user namespaces for Chromium's sandbox. Modern
  Debian desktop installations are the target; this is not a universal package
  for headless/minimal/restricted Linux systems. No `--no-sandbox` launcher is supplied.
- On Linux without a secure keyring backend, use session-only key storage.
- The command panel is non-interactive, not a full PTY emulator.
- Live gateway generation, account entitlement and model capabilities remain
  provider-dependent; automated generation tests use a local fixture endpoint.

## What's changed

- Windows-safe packaged engine path resolution.
- Distinct Windows per-user setup and portable executable downloads.
- Explicit `asInvoker` application privilege level; portable launch requests user level.
- Native OS engine, renderer and IPC tests, packaged-engine/native tests and
  a Windows install-to-user-profile smoke test in the build workflow.
- SHA-256 checksum files supplied alongside downloads.

## Validation for these binaries

Built from commit `30409263d1a310af58d16206ccbd663144ab0bea` in
[GitHub Actions run 42423455785](https://github.com/stefanoromang/ciq-developer-terminal/actions/runs/42423455785).

- **Windows x64:** engine/unit/fixture tests, renderer and native IPC tests,
  packaged engine/native app tests, and installation into a user-profile folder
  all passed on the Windows runner.
- **Linux x64:** engine/unit/fixture tests, sandbox-enabled renderer/native IPC
  tests, packaging, and packaged engine/native app tests all passed on Ubuntu 22.04.
- **Debian:** no separate Debian-host smoke test has been performed. Debian
  desktop compatibility remains subject to shared libraries and sandbox support.
- The overall workflow is marked failed because the **unrelated macOS runner
  could not start**; the Windows and Linux jobs individually completed successfully.
- Live CollectivIQ requests are not part of these fixture tests.

## Upstream attribution

CIQ's independently implemented interface is by Stefano Roman Gunness. The
underlying **OpenCode 2.2.6 engine** is upstream MIT-licensed work.

- Original OpenCode source: https://github.com/anomalyco/opencode
- Official docs: https://opencode.ai/v2/docs/
- What CIQ adds: https://github.com/stefanoromang/ciq-developer-terminal/blob/main/docs/OPENCODE.md

This is an independent preview, not an official OpenCode or CollectivIQ release.

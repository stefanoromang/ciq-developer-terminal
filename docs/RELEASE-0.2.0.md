# CIQ Developer Terminal 0.2.0 — free models, bring-your-own providers, automatic updates

**Created by Stefano Roman Gunness. Designed for CollectivIQ. Powered by OpenCode.**

## Start without a key

0.2.0 opens in **free mode**. OpenCode's free coding models are available
immediately—no CollectivIQ key, no OpenAI/Anthropic key, no configuration file.

- Big Pickle, DeepSeek V4.1 Flash, GLM-5.3 Flash, Nemotron 3.5, MiMo-V2.6 Flash,
  Inkling 2 Small and the rest of the free catalog exposed by the bundled
  OpenCode 2.2.6 engine.
- The model list is read from the engine at runtime. It is not hard-coded.
- Free access is rate-limited by OpenCode. When the limit is reached, CIQ shows
  a rate-limit message instead of pretending the key is broken.

## Add other providers when you want them

- **CollectivIQ** remains a first-class option. A Developer/Gateway key adds
  every model your account can access.
- **Any provider the engine exposes** can be connected from
  **Model library → Connect another provider** by pasting an API key.
- Keys are stored in CIQ's encrypted vault (Electron `safeStorage`), injected
  into the isolated engine process only, and never written into the engine's
  own credential store.
- No provider is usable unless it is the free provider, CollectivIQ, or one you
  explicitly connected. Unrelated host credentials stay blocked.

## Updates that actually reach installed apps

- CIQ checks this repository's GitHub releases about **twice a week**, with a
  catch-up check on launch and a six-hour timer while running.
- A newer release is downloaded automatically and verified against the
  release's SHA-256 checksum file.
- CIQ asks before restarting. It does not replace itself mid-session.
- macOS replaces the app bundle with `ditto` after the app quits; Windows uses
  the per-user NSIS installer or a portable replacement helper; Linux replaces
  the extracted directory and relaunches.

> **Updating from 0.1.2:** the 0.1.2 preview has no updater. Install 0.2.0 once
> manually. Automatic updates apply from 0.2.0 onward.

## Choose your download

| Platform | File | Install / run |
|---|---|---|
| Windows 10/11, x64 | `CIQ-Developer-Terminal-0.2.0-windows-x64-setup.exe` | Run as your normal user. Installs in your profile; installer elevation is disabled. |
| Windows 10/11, x64 portable | `CIQ-Developer-Terminal-0.2.0-windows-x64-portable.exe` | Run directly, without an installer. |
| Linux desktop, x64 | `CIQ-Developer-Terminal-0.2.0-linux-x64.tar.gz` | Extract to a folder you own, then run `./ciq-developer-terminal`. No root installation. |
| macOS, Apple Silicon | `CIQ-Developer-Terminal-0.2.0-mac-arm64.zip` | Extract and move the app to `~/Applications`. |

Only assets actually attached to this release are available. ARM Windows/Linux
and Intel macOS are not provided by this build matrix.

## Important preview requirements

- These downloads are **unsigned**. Windows SmartScreen/macOS Gatekeeper can
  warn; do not disable OS security protections. Code signing and macOS
  notarization are outstanding.
- Linux needs a graphical desktop, glibc and Electron's desktop shared libraries,
  plus working unprivileged user namespaces for Chromium's sandbox. Modern
  Debian desktop installations are the target; this is not a universal package
  for headless/minimal/restricted Linux systems. No `--no-sandbox` launcher is supplied.
- On Linux without a secure keyring backend, use session-only key storage.
- The command panel is non-interactive, not a full PTY emulator.
- Live provider generation, account entitlement and model capabilities remain
  provider-dependent; automated generation tests use a local fixture endpoint.

## What's changed

- Free OpenCode models are enabled by default; CollectivIQ is now optional.
- Provider-qualified model IDs so identical model names from different
  providers cannot collide.
- Encrypted multi-provider key vault and engine environment injection.
- Provider list/connect/disconnect UI and API.
- Twice-weekly update checks, automatic download, SHA-256 verification, and
  platform-specific install helpers.
- Update banner and update controls in Settings.
- Migrated workspace state preserves existing projects, notes, sessions and
  selections; bare legacy model IDs are upgraded in place.
- New unit tests for model normalization, migration, provider vaults and the
  updater.

## Validation for these binaries

Built from this repository's `v0.2.0` tag by the GitHub Actions build workflow.
See the Actions run linked from the release and the attached
`SHA256SUMS-*.txt` files.

- Unit, fixture, engine, renderer, native IPC and updater tests pass locally.
- Packaging and packaged-engine/native-app verification run on each OS runner.
- **Debian:** no separate Debian-host smoke test has been performed. Debian
  desktop compatibility remains subject to shared libraries and sandbox support.
- Live free-model generation could not be validated during the build because
  OpenCode returned its free-usage limit (`HTTP 429`) from this network. The
  catalog and request path are exercised; live quota is provider-controlled.

## Upstream attribution

CIQ's independently implemented interface is by Stefano Roman Gunness. The
underlying **OpenCode 2.2.6 engine** is upstream MIT-licensed work.

- Original OpenCode source: https://github.com/anomalyco/opencode
- Official docs: https://opencode.ai/v2/docs/
- What CIQ adds: https://github.com/stefanoromang/ciq-developer-terminal/blob/main/docs/OPENCODE.md

This is an independent preview, not an official OpenCode or CollectivIQ release.

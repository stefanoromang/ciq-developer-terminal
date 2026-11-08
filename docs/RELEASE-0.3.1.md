# CIQ Developer Terminal 0.3.1 — stability and platform validation

**Created by Stefano Roman Gunness · Powered by OpenCode**

Includes the free-model catalog, saved API keys and bulk folder import from
0.3.0, with these reliability improvements:

- Serialize engine startup/shutdown and config writes; cancel startup cleanly
  if the app quits and ignore stale process exits after restarting.
- Avoid writing unchanged engine configuration and unnecessary reloads.
- Coalesce rapid conversation events into non-overlapping refreshes. A burst
  during a pending refresh produces one trailing refresh, not parallel requests.
- Fetch messages, permissions and questions concurrently. Keep paged earlier
  history when new messages arrive.
- Start independent model-catalog requests concurrently.
- Keep free mode usable when a saved credential cannot be unlocked; preserve
  the encrypted vault and show reconnect status for unavailable credentials.
- Handle background refresh failures and wait for queued state/key writes on exit.
- Prevent overlapping update downloads and stale MCP/terminal UI responses.
- Add **Settings → Engine health & recovery**, with restart and a copyable
  runtime/sandbox report. Offer workspace reload after a renderer crash.
- Use native window controls on Windows/Linux and macOS inset controls on Mac.

## Platform checks

The release workflow requires native macOS arm64, Windows x64 and Ubuntu 22.04
build jobs, plus Debian 12/13 non-root container checks, before publishing.
It validates actual packaged executables, not only application modules loaded
by the development Electron runtime. Linux screenshots use a software-rendered
test harness and a session DBus; production GPU settings and Chromium sandbox
remain enabled.

Debian checks use Debian userland inside Docker with nested namespaces allowed;
they are not bare-metal or every-desktop-environment certification. Windows per-user
installer checks remain part of the build. Signing and macOS notarization are
outstanding; platform policy and Linux desktop libraries still apply.

Forty-one local tests cover the engine, vaults, imports, update verification, streaming
refresh bursts, locked credentials and shutdown/startup races. See the tagged
Actions run for cross-platform results. Optimizations reduce redundant work;
no universal speed or memory improvement is claimed without benchmarking.

The local packaged macOS smoke run reached a ready engine and exited cleanly
in 3,986 ms, with sandbox enabled. This is one development-machine measurement,
not a comparison against an earlier release or a cross-platform benchmark.

## Use the app

- Open a project and choose a free model, or connect an optional provider key.
- **Import projects** brings in folders from Claude Code, Codex, Cursor,
  OpenCode, VS Code, Windsurf, or manually chosen local folders.
- API keys are saved with OS-backed encryption when available.
- **Settings → Updates → Check now** finds releases; download and restart/install
  use verified packages. 0.1.x installations need one manual upgrade.

Free model quotas are controlled by OpenCode; live free generation encountered
HTTP 429 during development. Imported folders retain their files/Git history;
proprietary chat histories and cloud-only projects are not converted.

Original OpenCode source: https://github.com/anomalyco/opencode

Independent CIQ interface; OpenCode 2.2.6 remains MIT-licensed upstream work.

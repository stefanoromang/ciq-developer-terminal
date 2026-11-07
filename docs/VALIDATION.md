# Validation — November 7, 2026

## 0.1.2 Windows / Linux native build validation

Build evidence: [GitHub Actions run 42423455785](https://github.com/stefanoromang/ciq-developer-terminal/actions/runs/42423455785),
source commit `30409263d1a310af58d16206ccbd663144ab0bea`.

- **Windows x64 job succeeded:** 13 engine/unit/fixture tests, desktop renderer
  and native IPC smoke tests, NSIS + portable packaging, packaged engine and
  native app smoke tests, silent per-user installation into `LOCALAPPDATA`,
  then engine and native app checks from that installed directory. The hosted
  CI account's privileges do not establish behavior on every managed Windows
  machine; no-elevation configuration is additionally asserted by local tests.
- **Linux x64 job succeeded on Ubuntu 22.04:** the same 13 engine/unit/fixture
  tests, sandbox-enabled desktop/native tests under Xvfb, tarball packaging,
  packaged engine/native checks, and checksum generation.
- **Not tested on a Debian host:** modern Debian desktop environments remain
  subject to shared-library and user-namespace sandbox requirements.
- **macOS job unavailable:** the `macos-14` runner configuration was rejected
  before execution. The overall workflow therefore did not pass as a whole;
  Windows and Linux jobs each passed independently. The existing 0.1.1 local
  macOS validation remains the published Mac download's evidence.
- Two later packaging-configuration assertions pass locally (15 tests total);
  those test-only additions were not in the 13-test CI binary build commit.
- Downloads are unsigned preview artifacts. No real CollectivIQ key or live
  provider generation was used in these checks.

Downloaded CI artifacts were checked against their runner-generated SHA-256
files before release upload:

| File | Bytes | SHA-256 |
|---|---:|---|
| Windows x64 setup | 425,260,012 | `eed7f40c5d1065b598412fe40b6769638134ac6da97b429457f0a441a7cbf4f4` |
| Windows x64 portable | 395,996,098 | `5f8c42381e0fd443eacbf5335434445a32f356a496dda3be9c4eccdecc7349db` |
| Linux x64 tar.gz | 594,110,773 | `cced0b01cd6df362646533ad50b7ddd2a55ac9c65c5af55535bc008c6b3cb259` |

The Linux archive's launcher is mode `0755`, under the top-level folder
`CIQ-Developer-Terminal-0.1.2-linux-x64`; member paths were checked for absolute
paths and `..` traversal. No claim of a smaller footprint than OpenCode is made.

The sections below retain the original macOS delivery record and its then-current
release blockers; they do not override the newer platform evidence above.

## 0.1.1 creator-branded update

- Creator metadata, sidebar credit and Settings attribution identify **Stefano Roman Gunness** as creator of the independent CIQ interface.
- README, Settings and `docs/OPENCODE.md` link to the original OpenCode source and official documentation. OpenCode engine authorship is not attributed to Stefano.
- All 13 tests, desktop renderer checks, native IPC checks and packaged-engine checks were rerun successfully for 0.1.1.
- The updated macOS arm64 app was installed at `~/Applications/CIQ Developer Terminal.app` and confirmed running. Existing app data was left untouched; the previous preview was preserved as a sibling backup.
- `CIQ-Developer-Terminal-0.1.1-mac-arm64.zip`: approximately 220 MiB.
- SHA-256: `9f112cc4a6937cbbbd486b5beca8940be7f637abb171fd10c3930876a5835f34`.
- Public repository: https://github.com/stefanoromang/ciq-developer-terminal
- The following original delivery record concerns 0.1.0; signing and platform limitations still apply.

## Delivered locally

- Source project: `ciq-developer-terminal/`.
- Installed app: `~/Applications/CIQ Developer Terminal.app` on the developer's Mac.
- Built platform: **macOS arm64** only.
- Portable ZIP: `release/CIQ-Developer-Terminal-0.1.0-mac-arm64.zip` (approximately 220 MiB compressed; 481 MiB installed).
- ZIP SHA-256: `790596d5a32177a90199f008e688304f929e2c342bcd7359eccfeb9f44746fa6`.
- Installation ran as the ordinary user, created `~/Applications`, and requested no administrator password. It did not overwrite an existing app or alter system OpenCode.
- App launched with macOS `open`. First-run key entry is user-operated. No real key was read, created, copied from another app, or submitted by this build task.

## Passing checks

`npm test`: **13 tests**, including:

- Dynamic catalog parsing/filtering, authentication errors, credential redaction boundaries and manual/daily/weekly refresh timing.
- Encrypted-vault semantics, session-only keys and rejecting Linux's insecure `basic_text` backend. These vault unit tests use a deterministic encryption fixture; native OS secure storage availability is separately checked below.
- Preservation of corrupt settings, canonical project paths, project-note isolation and reopening.
- MCP input validation and V2 engine configuration.
- Real pinned OpenCode 2.2.6 startup, authentication, app-specific config paths, session persistence, harmless local shell execution and process shutdown.
- **Real engine + local mock OpenAI endpoint:** streaming completion, real engine tool-call decoding, a permission request before `read`, Allow once, tool result and final projected assistant response. No paid gateway call is used or implied.
- **Real engine + local inert MCP server:** initially disabled, explicit connect, connected state, persistence across restart and disconnect.

`npm run test:desktop`:

- Responsive screenshots at 1440×960, 1024×800, 768×1024 and 390×844; no document horizontal overflow at those sizes.
- Font loading, sidebar pages, key onboarding dialog and focused modal control.
- No renderer Node `require`; zero captured renderer console errors.
- Screenshots inspected in `test-results/`. This test runs the honest offline renderer-preview mode; it does not simulate a connected user account.

`npm run test:native`:

- Actual main process + sandboxed preload + renderer.
- Native `state` and `engine.info` IPC succeed; unsupported preload action rejected.
- Renderer has neither `require` nor `process`; no browser-preview badge appears.
- First-run onboarding shown, no saved key exposed, **native macOS secure storage reports available**.
- Owned engine process is gone when the app quits.

`npx electron scripts/verify-package.cjs`:

- Launches the engine through the module inside the packaged ASAR, resolving to the actual executable in `app.asar.unpacked`.
- Confirms version 2.2.6 and owned shutdown. This caught and fixed the npm-bin-shim packaging problem before installation.

`npm audit --omit=dev`: **0 reported runtime dependency vulnerabilities** at validation time.

## Not established / release blockers

- **Live CollectivIQ key validation or generation:** not tested without a user-supplied key. The documented gateway protocol and model-catalog semantics are implemented; exact account entitlement, tool support, pricing and Best of the Best availability remain provider-dependent.
- **Windows and Debian runtime/installer behavior:** build configurations and a multi-OS CI workflow are supplied, but no Windows/Linux artifact has been built or tested here. Debian system desktop libraries/user-namespace sandbox availability can require IT support on restricted machines.
- **Signing/notarization:** no Developer ID identity is available. The macOS build is unsigned/not notarized; distribution security prompts can occur. No Gatekeeper bypass was installed.
- **MCP OAuth against a real provider:** interface and documented API flow implemented, not live-authorized. Header-key MCP credentials are not implemented.
- **Accessibility audit:** focus handling and responsive behavior tested; no claim of complete WCAG certification. The marketing-site checker is not applicable to a full-height installed application with sidebar/dialogs; Electron-native screenshot checks were used instead.
- **Performance versus OpenCode:** not benchmarked. No claim that this Electron-based preview is lighter, faster or fully feature-equivalent. Frontend JS: approximately 475 KiB before gzip; CSS: approximately 38 KiB; the installed app is approximately 481 MiB.
- **Build tooling audit:** full `npm audit` reports six moderate findings, all in electron-builder's build-only minimatch dependency chain. No forced major downgrade or unverified overrides were applied. Review and update the packaging toolchain before public release.

## Request checklist

| Requirement | Status |
|---|---|
| CIQ name, official corner logo, neon CollectivIQ palette | Implemented |
| Left-side projects, conversations, memory, MCPs and model library | Implemented |
| Only CollectivIQ key required, endpoint preconfigured | Implemented; live key flow awaits user |
| Developer vs Standard key distinction | Implemented |
| Dynamic model picker, daily/weekly/manual discovery | Implemented; fixture-tested |
| Persistent project context | Explicit editable local notes + engine history; no automatic semantic memory |
| Tool execution approvals | Implemented and fixture-tested with real engine |
| macOS user installation | Installed and locally tested (arm64) |
| Debian and Windows no-admin packages | Configuration/workflow supplied; builds and platform validation outstanding |
| Faster/lighter than OpenCode, full copy/parity | Not established; preview is intentionally narrower |

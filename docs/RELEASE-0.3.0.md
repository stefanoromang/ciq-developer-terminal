# CIQ Developer Terminal 0.3.0

**Created by Stefano Roman Gunness · Powered by OpenCode**

## Free models and saved API keys

- All free coding models advertised by OpenCode are discovered automatically;
  no CollectivIQ key is needed. Model availability and quotas remain controlled
  by OpenCode. Use **Model library → Free models only** to browse zero-cost
  models from all connected providers.
- Bring your own key for the engine's key-based providers, including free-tier
  accounts. The provider picker displays its entire supported catalog.
- **Save API key securely for future launches** is enabled by default when
  OS-backed encryption is available. Provider cards show saved/session-only/
  reconnect status. Replace and disconnect keys from the Model library.
- Saved keys survive restarts. Corrupt vaults are preserved; failed saves cannot
  silently replace them. Linux without a secure keyring uses session-only keys.

## Import your projects

Use **Projects → Import projects → Find projects**, select folders, and click
**Import selected**. Select all shown, search by path/name, or filter by source.

- **Claude Code:** project metadata and local session headers.
- **Codex:** saved workspace roots, project configuration, thread databases and
  session headers.
- **Cursor, VS Code and Windsurf:** recent folders and local multi-root
  `.code-workspace` files, including JSONC comments and relative paths.
- **OpenCode:** read-only database snapshots and legacy project records.
- **Any other app:** **Choose folders…** supports multi-folder selection.

Imports open existing directories in CIQ and preserve files, Git history,
CIQ notes and existing CIQ conversations. Duplicate folders are merged. Missing
folders are reported. This imports local project folders, not proprietary chat
histories or cloud-only Claude Projects. Remote-only workspaces must first be
made available as local folders. Metadata formats may differ between app versions.

## Update fixes

CIQ checks releases every 3.5 days while open, with launch catch-up. Downloads
are automatic by default; choose **Restart & install** when ready.

- Follow GitHub checksum redirects and select platform-specific checksum files.
- Verify the file again immediately before installation.
- Preserve Windows portable installs as portable apps.
- Stage macOS/Linux replacements before quitting and keep the previous app
  for recovery instead of deleting it first.
- Tagged releases publish only after all platform build jobs pass, with verified
  SHA-256 checksums attached.

0.1.x apps need one manual installation of this release. Those builds contain
no updater. Workspace data and saved CollectivIQ keys migrate in place.

## Downloads and validation

Download the attached **macOS arm64 ZIP**, **Windows x64 setup or portable EXE**,
or **Linux x64 tar.gz**. Install under your user account.

The release workflow runs unit/engine/fixture tests, renderer and native IPC
tests, import and encrypted-key persistence checks, package verification, and
Windows per-user installation checks. Source and packaged imports are tested
using isolated metadata fixtures. Linux is tested on Ubuntu 22.04, not a separate
Debian host. Free catalog discovery is verified; live generation encountered
OpenCode's HTTP 429 free quota during development.

Downloads are unsigned; macOS is not notarized. Linux requires normal desktop
libraries and a working Chromium sandbox. Native end-to-end updater installation
has not been established on every end-user OS configuration.

Original OpenCode source: https://github.com/anomalyco/opencode

Independent CIQ interface by Stefano Roman Gunness; OpenCode 2.2.6 remains
MIT-licensed upstream work. Not an official OpenCode or CollectivIQ distribution.

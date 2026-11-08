# Security and privacy

Never put API keys, passwords, saved workspace data, private project contents,
or OAuth callback codes in GitHub issues or pull requests.

For a sensitive vulnerability, contact the maintainer privately through the
contact options on [Stefano Roman Gunness's GitHub profile](https://github.com/stefanoromang)
before disclosing exploit details. Do not use a public issue to share secrets.

## Preview boundaries

- The renderer is sandboxed, but the coding engine runs as the current OS user.
  Approval prompts are not an OS-level filesystem sandbox.
- Open only trusted project folders. OpenCode discovers project configuration,
  plugins, instructions and skills, which can affect the engine.
- Saved gateway and provider keys use Electron safeStorage; Linux's insecure `basic_text`
  fallback is rejected. Session-only storage is available.
- Prompt/context data is sent to the selected provider model. MCP tools can send
  their inputs to the configured server.
- The macOS preview is unsigned and not notarized. Do not disable OS security
  protections to install it.
- Run local MCP commands only after reviewing the executable, arguments and
  package provenance.
- Import discovery reads local folder metadata and read-only SQLite snapshots.
  It does not copy external app credentials or transcripts into CIQ projects.
  Imported project configuration is discovered when the engine opens that folder.
- Update archives are verified with release SHA-256 checksums, including a
  second file verification before installing. Checksums establish file integrity,
  not a separate developer signature. macOS/Linux installers keep the previous
  app in a sibling staging folder for recovery.

The current validation scope and build-tool audit findings are documented in
[docs/VALIDATION.md](docs/VALIDATION.md).

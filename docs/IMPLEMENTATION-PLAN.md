# CIQ Developer Terminal

Kind: software — an installed developer workspace, not a marketing landing page.

## Product direction

- One left sidebar: projects, conversations, MCP connections, memory, models and settings.
- A quiet, readable chat canvas and command composer; neon accents, not neon body text.
- Official assets: CollectivIQ mark and Inter / Plex Mono from www.collectiviq.ai.
- Brand source: https://www.collectiviq.ai/assets/css/site.css?v=36f3d079 and the product stylesheet at https://collectiviq.ai.
- Official blue #0284c7, pink #d6336c, purple #7048a8 and deep blue #1c5a87; bright product accents #f6339a and #ad46ff. The user's explicit branding takes precedence over generic palette suggestions.
- The UI/UX search returned an irrelevant FAQ landing pattern twice. That pattern is rejected; its dark-mode, visible-focus and reduced-motion recommendations fit a developer app. No generated landing system is persisted.

## Architecture

Electron with sandboxed renderer + narrowly scoped preload IPC. React is bundled locally; no remote renderer scripts or analytics. Pinned, MIT-licensed OpenCode 2.2.6 engine runs as an owned child process, with an app-specific config/data/cache/state tree. Never alter the installed OpenCode app or its configuration. Keep model credentials in Electron safeStorage and never send them to the renderer after saving. Reject Linux's insecure basic_text fallback; offer session-only credentials instead.

The sole required onboarding credential is a CollectivIQ Developer/Gateway API key. Endpoint: https://api.prod.collectiviq.ai/v1. GET /models is authoritative; no fabricated model catalog or Best of the Best capability. Standard keys are a distinct platform API and not assumed compatible. Additional provider credentials are optional.

Model refresh: manual, daily or weekly while the app is open, plus catch-up on next launch. Never silently switch an existing conversation's model. Persistent project notes are explicit and editable, scoped to the project, and sent only with that project's prompts.

## Packaging

- macOS: ~/Applications/CIQ Developer Terminal.app; no system /Applications write.
- Debian/Linux: portable tarball installed under ~/.local/opt/ciq-developer-terminal, launcher and desktop entry under ~/.local. No .deb install or sudo requirement. Chromium sandbox must remain enabled; do not recommend --no-sandbox.
- Windows: per-user NSIS (perMachine:false, allowElevation:false), or portable executable. Existing OS WebView/runtime/Chromium support can still impose platform prerequisites.
- OS builds must run on their respective CI runners. macOS can be tested locally; Linux/Windows are not verified by a successful macOS build.

## Validation boundary

No live model generation without a user-supplied key. Validate gateway behavior with local fixtures. Test real engine startup, API schemas, sessions, memory, MCP persistence and permission controls without paid requests. No claim of full OpenCode feature parity or better memory/performance until measured.

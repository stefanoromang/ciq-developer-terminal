# Bounded REA inspection of installed OpenCode

The installed app was inspected read-only to confirm artifact identity and desktop bridge shape. It was not patched, executed by REA, rebranded or redistributed.

- Target: a locally installed OpenCode desktop `app.asar` (read-only inspection).
- SHA-256: `a95223726f8524440019cba5f7c24056912d4a09aa5c8bf67e2db27cfc8a6161`
- Selected sources: `package.json`, `out/preload/index.cjs` only.
- Parent Evidence: `ev_1e341ea2242d38e0f752b685172fb230bec3ab6054155f1aba3d54abf4132e2c`
- Summary Evidence: `ev_7b83fe625801138da796bb4ccecb7617deecab79450b7b511d4276cf000c8679`
- Observed manifest: `@opencode/desktop` 2.2.5, Electron main entry `./out/main/index.js`, MIT license declaration.
- Static observation: one context bridge API, five exposed members, three dynamic-channel IPC operations. This does not establish runtime enforcement or full application behavior.
- Coverage: one JavaScript file parsed, 1,667 text bytes read; 11,222 other inventoried files were outside selected source analysis. Complete app relationships remain unknown.
- Integrity caveat: two unpacked native companion files (`pty.node` and `spawn-helper`) differed from declared ASAR integrity metadata. REA recorded the contradictions with `record-and-continue`, marking those observed bytes untrusted. Signing/stripping can produce this, but the cause was not established. CIQ does **not** reuse those files.
- Full evidence exported locally to `docs/opencode-rea-evidence.json` (approximately 183 MiB, excluded from source/package). The REA session was closed after export.

## Design choice, not a reverse-engineering finding

The new app uses its own sandboxed renderer and narrow allowlisted IPC rather than copying the installed app's renderer or bridge. Public V2 documentation and the published pinned engine API establish the integration contract. No claim of behavioral equivalence or performance improvement follows from the bounded REA inspection.

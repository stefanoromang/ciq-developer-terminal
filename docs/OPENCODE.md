# Where to read and obtain the original OpenCode

CIQ Developer Terminal is an **independent application interface created by
Stefano Roman Gunness**. It uses the **OpenCode 2.2.6 engine**, rather than
claiming to have invented that engine.

## Original project

- **Read or download the original source:** https://github.com/anomalyco/opencode
- **Official website:** https://opencode.ai/
- **V2 documentation:** https://opencode.ai/v2/docs/
- **V2 HTTP API:** https://opencode.ai/v2/docs/api
- **Published engine used by this application:** https://www.npmjs.com/package/@opencode/cli/v/2.2.6
- **Upstream license:** https://github.com/anomalyco/opencode/blob/master/LICENSE
- **License text retained here:** [OpenCode MIT license](../assets/licenses/OpenCode-MIT.txt)

To make your own checkout of the original repository:

```sh
git clone https://github.com/anomalyco/opencode.git
```

Follow that repository's instructions to build or install OpenCode itself.
Its current default branch may differ from the specific **2.2.6** package
pinned by CIQ Developer Terminal.

## What Stefano's application adds

- A separately implemented desktop interface with a left-side workspace.
- CollectivIQ gateway onboarding and an API-derived model catalog.
- Project/conversation organization and explicit local project notes.
- MCP setup controls, tool approval UI and a command-output panel.
- User-level installation and platform packaging configuration.

## What remains OpenCode's work

The underlying agent execution, session storage, context compaction, tool
execution and MCP runtime are provided by OpenCode. CIQ launches an owned
instance of the published engine and uses its local V2 API. This is not a
full source fork or a claim of feature parity.

The installed OpenCode application on the developer's machine was not
modified or redistributed. The CIQ package includes the pinned, separately
licensed npm engine instead. See [third-party notices](../THIRD-PARTY-NOTICES.md).

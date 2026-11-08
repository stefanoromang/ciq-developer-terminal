const { contextBridge } = require('electron')
const state = {
  projects: [{ id: 'project-fixture', name: 'Saved project', directory: '/fixture', memory: '', memoryEnabled: true,
    sessions: [{ id: 'session-fixture', title: 'Conversation with failed tool', model: 'opencode/fixture', created: 1 }], activeSessionID: 'session-fixture' }],
  activeProjectID: 'project-fixture', connected: false, secureStorage: false,
  models: [{ id: 'fixture', providerID: 'opencode', provider: 'OpenCode', name: 'Fixture', tools: true, context: null, free: true }],
  selectedModel: 'opencode/fixture', cadence: 'manual', lastRefresh: 1, toolsConfirmed: false, mcps: [],
  gateway: '', freeProvider: 'opencode', freeEnabled: true, modelsAvailable: true, providers: [],
  updates: { currentVersion: 'fixture', lastCheck: 1, intervalDays: 3.5, skippedVersion: '', autoDownload: false,
    downloading: false, progress: 0, ready: false, installing: false, error: '', downloaded: null, latest: null },
}
// Matches OpenCode's persisted structured tool error. No real user data.
const messages = [
  { id: 'assistant-fixture', type: 'assistant', time: { created: 2 }, model: { id: 'fixture' },
    error: { type: 'ProviderError', message: 'Provider fixture error', response: { private: 'DO-NOT-RENDER-RESPONSE' } },
    content: [
      { id: 'tool-fixture', type: 'tool', name: 'read', state: { status: 'error', input: { path: 'fixture.txt' },
        error: { type: 'ToolError', message: 'Fixture file could not be read' } } },
      { id: 'legacy-error', type: 'tool', name: 'legacy', state: { status: 'error', error: 'Legacy tool error' } },
      { type: 'text', text: 'Your previous conversation is available.' },
    ] },
  { id: 'user-fixture', type: 'user', text: 'Read the fixture file', time: { created: 1 } },
]
contextBridge.exposeInMainWorld('ciq', {
  async invoke(command) {
    if (command === 'state') return state
    if (command === 'session.messages') return { data: messages, active: false, cursor: { next: null } }
    if (command === 'permission.list' || command === 'form.list') return { data: [] }
    throw new Error(`Unsupported history-test command: ${command}`)
  },
  onEvent() { return () => {} },
})

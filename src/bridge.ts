import type { Bridge, Workspace } from './types'

// Browser mode is an honest, offline UI preview. Native and credential operations
// are deliberately unavailable; it never simulates a connected model or agent.
const preview: Workspace = {
  projects: [], connected: false, secureStorage: false, models: [], selectedModel: '',
  cadence: 'daily', lastRefresh: 0, toolsConfirmed: false, mcps: [], gateway: 'https://api.prod.collectiviq.ai/v1',
  freeProvider: 'opencode', freeEnabled: false, modelsAvailable: false, providers: [],
  updates: {
    currentVersion: '0.2.0', lastCheck: 0, intervalDays: 3.5, skippedVersion: '', autoDownload: true,
    downloading: false, progress: 0, ready: false, installing: false, error: '', downloaded: null, latest: null,
  },
}
export const isDesktop = Boolean(window.ciq)
export const bridge: Bridge = window.ciq || {
  async invoke(command, payload) {
    if (command === 'state') return structuredClone(preview)
    if (command === 'external.open' && typeof payload?.url === 'string') { window.open(payload.url, '_blank', 'noopener,noreferrer'); return }
    throw new Error('This is the browser preview. Open the desktop app to use free models, connect providers, open local projects, and run the coding engine.')
  },
  onEvent() { return () => {} },
}

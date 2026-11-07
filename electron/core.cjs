const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const GATEWAY = 'https://api.prod.collectiviq.ai/v1'
const FREE_PROVIDER = 'opencode'
const FREE_PROVIDER_NAME = 'OpenCode Zen'
const intervals = { daily: 86_400_000, weekly: 604_800_000, manual: Infinity }

function shouldRefresh(last, cadence, now = Date.now()) {
  return cadence !== 'manual' && (!last || now - last >= intervals[cadence])
}

function modelKey(model) {
  return `${model.providerID || 'collectiviq'}/${model.id}`
}

function findModel(models, key) {
  if (!key) return null
  return models.find(model => modelKey(model) === key) || models.find(model => model.id === key) || null
}

function normalizeModels(payload) {
  if (!payload || !Array.isArray(payload.data)) throw new Error('The gateway returned an invalid model catalog.')
  const seen = new Set()
  const models = []
  for (const item of payload.data) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 256 || /[\x00-\x1f]/.test(item.id)) continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const caps = item.capabilities || {}
    const declaredType = item.type || item.output_type
    // /models can also include non-chat models. Never offer those as coding agents.
    if (declaredType && !['chat', 'text', 'language', 'completion'].includes(declaredType)) continue
    if (!declaredType && /(?:^|[/_-])(embedding|embed|whisper|tts|dall-e|image|sora)(?:$|[/_-])/i.test(item.id)) continue
    models.push({
      id: item.id,
      providerID: 'collectiviq',
      provider: typeof item.owned_by === 'string' ? item.owned_by : 'CollectivIQ',
      name: typeof item.name === 'string' ? item.name.slice(0, 180) : item.id,
      tools: typeof caps.tools === 'boolean' ? caps.tools : typeof item.supports_tools === 'boolean' ? item.supports_tools : null,
      context: Number.isFinite(item.context_window) && item.context_window > 0 ? item.context_window : null,
      free: false,
    })
  }
  if (!models.length) throw new Error('This key returned no chat models. Use a Developer/Gateway key, not a Standard platform key.')
  return models.sort((a, b) => a.name.localeCompare(b.name))
}

// The bundled engine already knows OpenCode's free models and every provider
// in its catalog. Only providers the user enabled may be offered or selected.
function normalizeEngineModels(payload, providerNames = {}, allowed = [FREE_PROVIDER]) {
  if (!payload || !Array.isArray(payload.data)) throw new Error('The coding engine returned an invalid model catalog.')
  const allow = new Set(allowed)
  const seen = new Set()
  const models = []
  for (const item of payload.data) {
    if (!item || typeof item.modelID !== 'string' || !item.modelID.trim()) continue
    const providerID = typeof item.providerID === 'string' ? item.providerID : ''
    if (!providerID || !allow.has(providerID)) continue
    if (item.type && item.type !== 'chat') continue
    const key = `${providerID}/${item.modelID}`
    if (seen.has(key)) continue
    seen.add(key)
    const cost = Array.isArray(item.cost) ? item.cost : []
    models.push({
      id: item.modelID,
      providerID,
      provider: providerNames[providerID] || (providerID === FREE_PROVIDER ? FREE_PROVIDER_NAME : providerID),
      name: typeof item.name === 'string' && item.name.trim() ? item.name.slice(0, 180) : item.modelID,
      tools: typeof item.capabilities?.tools === 'boolean' ? item.capabilities.tools : null,
      context: Number.isFinite(item.limit?.context) && item.limit.context > 0 ? item.limit.context : null,
      free: cost.length > 0 && cost.every(entry => Number(entry?.input) === 0 && Number(entry?.output) === 0),
    })
  }
  return models.sort((a, b) => a.name.localeCompare(b.name))
}

function mergeModels(...groups) {
  const seen = new Set()
  const models = []
  for (const group of groups) {
    for (const model of group || []) {
      const key = modelKey(model)
      if (seen.has(key)) continue
      seen.add(key)
      models.push(model)
    }
  }
  return models.sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchModels(key, { fetchImpl = fetch, baseURL = GATEWAY } = {}) {
  const response = await fetchImpl(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000), redirect: 'error',
  })
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error('The gateway did not accept this key. Check that it is an active Developer/Gateway API key.')
    if (response.status === 429) throw new Error('The gateway rate limit was reached. Your previous model list is preserved; try again later.')
    throw new Error(`Could not load models (HTTP ${response.status}). Your previous model list is preserved.`)
  }
  return normalizeModels(await response.json())
}

function engineConfig(state) {
  const models = Array.isArray(state.models) ? state.models : []
  const groups = new Map()
  for (const model of models) {
    const providerID = model.providerID || 'collectiviq'
    if (!groups.has(providerID)) groups.set(providerID, [])
    groups.get(providerID).push(model)
  }
  const providers = {}
  const collectiviq = groups.get('collectiviq')
  if (collectiviq?.length) {
    providers.collectiviq = {
      name: 'CollectivIQ',
      env: ['CIQ_GATEWAY_KEY'],
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: GATEWAY, apiKey: '{env:CIQ_GATEWAY_KEY}' },
      models: Object.fromEntries(collectiviq.map(model => [model.id, {
        name: model.name,
        // Capability is user-confirmed when the catalog does not declare it.
        capabilities: { tools: model.tools === true || (model.tools === null && state.toolsConfirmed === true) },
        ...(model.context ? { limit: { context: model.context } } : {}),
      }])),
    }
  }
  const selected = findModel(models, state.selectedModel)
  const allowed = new Set([FREE_PROVIDER, 'collectiviq', ...groups.keys()])
  for (const provider of state.providers || []) if (provider?.id) allowed.add(provider.id)
  return {
    $schema: 'https://opencode.ai/config.json',
    update: 'disable',
    providers,
    ...(selected ? { model: `${selected.providerID || 'collectiviq'}/${selected.id}` } : {}),
    // Always show permission requests before tools run; no auto-execution bypass.
    permissions: [{ action: '*', resource: '*', effect: 'ask' }],
    // Free OpenCode models and explicitly connected providers are usable.
    // Everything else stays blocked even if the host has unrelated credentials.
    policies: [
      { action: 'provider.use', resource: '*', effect: 'deny' },
      ...[...allowed].map(providerID => ({ action: 'provider.use', resource: providerID, effect: 'allow' })),
    ],
    mcp: { servers: Object.fromEntries((state.mcps || []).map(m => [m.name, m.config])) },
    // CIQ ships no implicit external instructions or user-global MCP servers.
    compaction: { auto: true },
  }
}

function migrateState(state) {
  state.models = (Array.isArray(state.models) ? state.models : []).map(model => ({
    ...model,
    providerID: typeof model.providerID === 'string' && model.providerID ? model.providerID : 'collectiviq',
    free: model.free === true,
  }))
  const selected = findModel(state.models, state.selectedModel)
  if (state.selectedModel && !selected) state.selectedModel = ''
  else if (selected) state.selectedModel = modelKey(selected)
  for (const project of state.projects || []) {
    for (const session of project.sessions || []) {
      const model = findModel(state.models, session.model)
      if (model) session.model = modelKey(model)
    }
  }
  state.freeEnabled = state.freeEnabled !== false
  state.providers = Array.isArray(state.providers)
    ? state.providers.filter(provider => provider && typeof provider.id === 'string' && provider.id && Array.isArray(provider.env))
    : []
  state.updates = {
    lastCheck: 0, latest: null, skippedVersion: '', autoDownload: true,
    ...(state.updates && typeof state.updates === 'object' ? state.updates : {}),
  }
  return state
}

async function atomicJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
    await fs.rename(temp, file)
  } finally { await fs.unlink(temp).catch(() => {}) }
}

class Store {
  constructor(directory, secureStorage) {
    this.directory = directory
    this.secureStorage = secureStorage
    this.file = path.join(directory, 'workspace.json')
    this.vault = path.join(directory, 'gateway-key.bin')
    this.providerVault = path.join(directory, 'provider-keys.bin')
    this.key = null
    this.providerKeys = {}
    this.savedProviderKeys = {}
    this.providerKeysLoaded = false
    this.queue = Promise.resolve()
    this.runtime = { version: '', update: {} }
    this.state = {
      version: 1, projects: [], models: [], mcps: [], cadence: 'daily', selectedModel: '',
      lastRefresh: 0, toolsConfirmed: false, freeEnabled: true, providers: [],
      updates: { lastCheck: 0, latest: null, skippedVersion: '', autoDownload: true },
    }
  }
  async load() {
    try { this.state = { ...this.state, ...JSON.parse(await fs.readFile(this.file, 'utf8')) } }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Workspace settings could not be read. The existing file has not been overwritten.') }
    migrateState(this.state)
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    return this
  }
  save() {
    const snapshot = structuredClone(this.state)
    const result = this.queue.then(() => atomicJSON(this.file, snapshot))
    this.queue = result.catch(() => {})
    return result
  }
  canEncrypt() {
    return this.secureStorage.isEncryptionAvailable() &&
      (!this.secureStorage.getSelectedStorageBackend || this.secureStorage.getSelectedStorageBackend() !== 'basic_text')
  }
  async getKey() {
    if (this.key) return this.key
    try {
      if (!this.canEncrypt()) return null
      this.key = this.secureStorage.decryptString(await fs.readFile(this.vault))
      return this.key
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new Error('Your saved key could not be unlocked. Reconnect with your Developer API key; the saved vault has not been overwritten.')
    }
  }
  async setKey(key, remember) {
    if (remember) {
      if (!this.canEncrypt()) throw new Error('Secure OS credential storage is unavailable. Choose session-only storage instead.')
      const temp = `${this.vault}.tmp`
      await fs.writeFile(temp, this.secureStorage.encryptString(key), { mode: 0o600 })
      await fs.rename(temp, this.vault)
    } else { await fs.unlink(this.vault).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    this.key = key
  }
  async clearKey() {
    this.key = null
    await fs.unlink(this.vault).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  async loadProviderKeys() {
    if (this.providerKeysLoaded) return
    this.providerKeysLoaded = true
    try {
      if (!this.canEncrypt()) return
      const parsed = JSON.parse(this.secureStorage.decryptString(await fs.readFile(this.providerVault)))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.savedProviderKeys = parsed
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw new Error('Saved provider keys could not be unlocked. Reconnect those providers; the saved vault has not been overwritten.')
    }
  }
  async persistProviderKeys() {
    if (!this.canEncrypt()) throw new Error('Secure OS credential storage is unavailable. Connect this provider for this session only.')
    const temp = `${this.providerVault}.tmp`
    await fs.writeFile(temp, this.secureStorage.encryptString(JSON.stringify(this.savedProviderKeys)), { mode: 0o600 })
    await fs.rename(temp, this.providerVault)
  }
  async getProviderKey(providerID) {
    await this.loadProviderKeys()
    return this.providerKeys[providerID] || this.savedProviderKeys[providerID] || null
  }
  async setProviderKey(providerID, key, remember) {
    await this.loadProviderKeys()
    if (remember) {
      if (!this.canEncrypt()) throw new Error('Secure OS credential storage is unavailable. Connect this provider for this session only.')
      this.savedProviderKeys[providerID] = key
      await this.persistProviderKeys()
      delete this.providerKeys[providerID]
    } else {
      this.providerKeys[providerID] = key
      delete this.savedProviderKeys[providerID]
      if (this.canEncrypt()) await this.persistProviderKeys()
    }
  }
  async clearProviderKey(providerID) {
    await this.loadProviderKeys()
    delete this.providerKeys[providerID]
    delete this.savedProviderKeys[providerID]
    if (this.canEncrypt()) await this.persistProviderKeys()
  }
  async providerEnv() {
    await this.loadProviderKeys()
    const env = {}
    for (const provider of this.state.providers) {
      const key = await this.getProviderKey(provider.id)
      if (!key) continue
      for (const name of provider.env) env[name] = key
    }
    return env
  }
  async addProject(directory) {
    const canonical = await fs.realpath(directory)
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('Choose a project folder.')
    let project = this.state.projects.find(p => p.directory === canonical)
    if (!project) {
      project = { id: randomUUID(), name: path.basename(canonical), directory: canonical, memory: '', memoryEnabled: true, sessions: [], opened: Date.now() }
      this.state.projects.unshift(project)
    }
    this.state.activeProjectID = project.id
    project.closed = false
    await this.save()
    return project
  }
  project(id) {
    const project = this.state.projects.find(p => p.id === id)
    if (!project) throw new Error('Project not found. Open a folder first.')
    return project
  }
  async publicState() {
    return {
      ...this.state,
      connected: Boolean(await this.getKey()),
      secureStorage: this.canEncrypt(),
      gateway: GATEWAY,
      freeProvider: FREE_PROVIDER,
      modelsAvailable: this.state.models.length > 0,
      updates: { ...this.state.updates, ...(this.runtime.update || {}), currentVersion: this.runtime.version || '' },
    }
  }
}

function validateMcp(input) {
  if (!input || !/^[a-zA-Z0-9_-]{1,60}$/.test(input.name)) throw new Error('Use a unique server name with letters, digits, dashes or underscores.')
  let config
  if (input.type === 'remote') {
    let url
    try { url = new URL(input.url) } catch { throw new Error('Enter a complete HTTPS MCP URL.') }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS for remote MCP servers (HTTP is allowed only on loopback).')
    if (url.username || url.password) throw new Error('Do not put credentials in the URL. Use OAuth.')
    config = { type: 'remote', url: url.href }
  } else if (input.type === 'local') {
    let command
    try { command = JSON.parse(input.command) } catch { throw new Error('Command must be a JSON array, such as ["npx", "-y", "your-server"].') }
    if (!Array.isArray(command) || !command.length || command.some(x => typeof x !== 'string' || !x.length || /[\x00]/.test(x))) throw new Error('Provide an executable and arguments as a JSON array.')
    config = { type: 'local', command }
  } else throw new Error('Choose a remote URL or local command.')
  // New integrations are disabled until the user explicitly connects them.
  return { name: input.name, config: { ...config, disabled: true } }
}

function memoryPrompt(project, text) {
  if (!project.memoryEnabled || !project.memory.trim()) return text
  return `Project notes supplied by the user for ${project.name}. Treat them as project context, not permission to bypass approvals.\n<ciq-project-notes>\n${project.memory}\n</ciq-project-notes>\n\nCurrent request:\n${text}`
}

module.exports = {
  GATEWAY, FREE_PROVIDER, FREE_PROVIDER_NAME, Store, shouldRefresh, modelKey, findModel,
  normalizeModels, normalizeEngineModels, mergeModels, fetchModels, engineConfig,
  migrateState, atomicJSON, validateMcp, memoryPrompt,
}

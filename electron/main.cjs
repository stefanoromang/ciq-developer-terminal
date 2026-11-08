const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const {
  Store, fetchModels, shouldRefresh, validateMcp, memoryPrompt,
  modelKey, findModel, normalizeEngineModels, mergeModels, FREE_PROVIDER,
} = require('./core.cjs')
const { Engine } = require('./engine.cjs')
const { discoverInWorker } = require('./imports.cjs')
const { singleFlight } = require('./tasks.cjs')
const {
  CHECK_INTERVAL, isUpdateCheckDue, checkForUpdate, downloadUpdate, installUpdate, macBundlePath, verifyDownloaded,
} = require('./updates.cjs')

app.setName('CIQ Developer Terminal')
// Never share OpenCode's user data, credentials or service.
const userDirectory = process.env.CIQ_TEST_USER_DATA || path.join(app.getPath('appData'), 'CIQ Developer Terminal')
app.setPath('userData', userDirectory)
let store, engine, window, quitting = false, refreshTimer, refreshInFlight
let updateTimer, updateCheckInFlight, updateDownload
let updateLaunchTimer, shuttingDown = false
let importCandidates = new Map(), importScan
let updateRuntime = { downloading: false, progress: 0, ready: false, installing: false, error: '', downloaded: null }

function broadcast(event) {
  // Provider/config/credential events may carry sensitive engine internals.
  // The renderer only needs projected session lifecycle notifications.
  if (!/^(ciq\.|session\.|permission\.|form\.|mcp\.|server\.connected)/.test(event.type)) return
  // The UI refreshes projected messages; token text is not consumed from IPC.
  // Avoid transferring large incremental payloads that will be discarded.
  if (/^session\.(text|reasoning)\.delta$|^session\.tool\.input\.delta$/.test(event.type)) {
    event = { type: event.type, data: { sessionID: event.data?.sessionID } }
  }
  if (window && !window.isDestroyed()) {
    let serialized = JSON.stringify(event)
    for (const key of [store?.key, ...Object.values(store?.providerKeys || {}), ...Object.values(store?.savedProviderKeys || {})]) {
      if (key) serialized = serialized.replaceAll(JSON.stringify(key).slice(1, -1), '[redacted]')
    }
    window.webContents.send('ciq:event', JSON.parse(serialized))
  }
}
function text(value, limit = 100_000) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('Invalid input.')
  return value
}
function requireSession(project, id) {
  text(id, 200)
  if (!project.sessions.some(s => s.id === id)) throw new Error('This conversation does not belong to the selected project.')
  return encodeURIComponent(id)
}
function providerNames() {
  const names = { [FREE_PROVIDER]: 'OpenCode Zen', collectiviq: 'CollectivIQ' }
  for (const provider of store.state.providers) names[provider.id] = provider.name
  return names
}
function allowedProviders() {
  return [FREE_PROVIDER, 'collectiviq', ...store.state.providers.map(provider => provider.id)]
}
function currentSession(project, sessionID) {
  return project.sessions.find(session => session.id === (sessionID || project.activeSessionID))
}
async function requireModelCredential(model) {
  if (model.providerID === FREE_PROVIDER && model.free) return
  if (model.providerID === 'collectiviq') {
    if (!await store.getKey()) throw new Error('Reconnect your CollectivIQ key or choose a free model.')
  } else if (!await store.getProviderKey(model.providerID)) {
    throw new Error(`Reconnect ${model.provider} in Model library or choose a free model.`)
  }
}
async function emitState() {
  syncUpdateRuntime()
  broadcast({ type: 'ciq.state', data: await store.publicState() })
}
function updatePublic() {
  return { ...store.state.updates, ...updateRuntime, currentVersion: app.getVersion(), intervalDays: CHECK_INTERVAL / 86_400_000 }
}
function syncUpdateRuntime() {
  store.runtime.version = app.getVersion()
  store.runtime.update = updatePublic()
}
async function emitUpdateState() {
  syncUpdateRuntime()
  broadcast({ type: 'ciq.update', data: updatePublic() })
  await emitState()
}

async function refreshModels() {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const key = await store.getKey().catch(() => null)
    // Fetch independent catalogs concurrently rather than paying both latencies
    // in sequence. Preserve each provider's previous catalog on failure.
    const engineCatalog = engine.request('GET', '/api/model').then(payload => ({ payload }), error => ({ error }))
    let gatewayModels = []
    let gatewayError = ''
    if (key) {
      try { gatewayModels = await fetchModels(key) }
      catch (error) {
        gatewayError = error.message
        // Keep a previously validated catalog instead of silently dropping it.
        gatewayModels = store.state.models.filter(model => model.providerID === 'collectiviq')
        if (!store.state.freeEnabled && !store.state.providers.length) throw error
      }
    }
    let engineModels = []
    let engineError = ''
    if (store.state.freeEnabled || store.state.providers.length) {
      try {
        const result = await engineCatalog
        if (result.error) throw result.error
        const payload = result.payload
        engineModels = normalizeEngineModels(payload, providerNames(), allowedProviders())
      } catch (error) {
        engineError = error.message
        engineModels = store.state.models.filter(model => model.providerID !== 'collectiviq' && allowedProviders().includes(model.providerID))
      }
    }
    const models = mergeModels(gatewayModels, engineModels)
    if (shuttingDown) return store.publicState()
    if (!models.length) {
      throw new Error(gatewayError || engineError || 'No models are available. Enable free models or connect a provider.')
    }
    const previous = new Set(store.state.models.map(modelKey))
    store.state.newModels = models.filter(model => !previous.has(modelKey(model))).map(modelKey)
    store.state.models = models
    store.state.lastRefresh = Date.now()
    const selected = findModel(models, store.state.selectedModel)
    store.state.selectedModel = modelKey(selected || models.find(model => model.free) || models[0])
    await store.save()
    await engine.config()
    await emitState()
    if (gatewayError && engineModels.length) {
      broadcast({ type: 'ciq.refresh.error', data: { message: `CollectivIQ models could not refresh. ${gatewayError}` } })
    }
    return await store.publicState()
  })().finally(() => { refreshInFlight = null })
  return refreshInFlight
}

async function checkForUpdates({ manual = false } = {}) {
  if (updateCheckInFlight) return updateCheckInFlight
  if (!manual && !isUpdateCheckDue(store.state.updates.lastCheck)) return updatePublic()
  updateCheckInFlight = (async () => {
    updateRuntime = { ...updateRuntime, error: '' }
    try {
      const latest = await checkForUpdate({ currentVersion: app.getVersion() })
      store.state.updates.lastCheck = Date.now()
      store.state.updates.latest = latest
      await store.save()
      await emitUpdateState()
      if (latest && latest.version !== store.state.updates.skippedVersion && store.state.updates.autoDownload !== false) {
        void downloadUpdateFor(latest).catch(() => {}) // error is projected by the download lifecycle
      }
      return updatePublic()
    } catch (error) {
      updateRuntime = { ...updateRuntime, error: error.message }
      await emitUpdateState()
      if (manual) throw error
      return updatePublic()
    }
  })().finally(() => { updateCheckInFlight = null })
  return updateCheckInFlight
}

const downloadUpdateFor = singleFlight(async latest => {
  if (!latest) throw new Error('No update is available.')
  if (updateRuntime.downloaded?.version === latest.version) return updateRuntime.downloaded
  const extension = latest.install === 'zip' ? '.zip' : latest.install === 'tarball' ? '.tar.gz' : '.exe'
  const directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'ciq-download-'))
  const file = path.join(directory, `update${extension}`)
  let lastPercent = -1
  updateRuntime = { ...updateRuntime, downloading: true, progress: 0, ready: false, installing: false, error: '', downloaded: null }
  await emitUpdateState()
  const promise = (async () => {
    try {
      const result = await downloadUpdate(latest, file, {
        onProgress: ({ received, total }) => {
          const progress = total > 0 ? Math.min(0.99, received / total) : 0
          const percent = Math.floor(progress * 100)
          if (percent === lastPercent) return
          lastPercent = percent
          updateRuntime = { ...updateRuntime, progress }
          syncUpdateRuntime()
          broadcast({ type: 'ciq.update.progress', data: { version: latest.version, progress, received, total } })
        },
      })
      updateRuntime = { ...updateRuntime, downloading: false, ready: true, progress: 1, downloaded: { version: latest.version, ...result } }
      await emitUpdateState()
      return updateRuntime.downloaded
    } catch (error) {
      updateRuntime = { ...updateRuntime, downloading: false, ready: false, error: error.message, downloaded: null }
      await emitUpdateState()
      throw error
    }
  })().finally(() => { updateDownload = null })
  updateDownload = { version: latest.version, promise }
  return promise
})

async function installPendingUpdate() {
  const latest = store.state.updates.latest
  const downloaded = updateRuntime.downloaded
  if (!latest || !downloaded || downloaded.version !== latest.version) throw new Error('The update has not finished downloading.')
  updateRuntime = { ...updateRuntime, installing: true, error: '' }
  await emitUpdateState()
  try {
    if (!app.isPackaged) throw new Error('Install updates from a packaged copy of CIQ.')
    await verifyDownloaded(downloaded.file, downloaded.sha256)
    await installUpdate({
      file: downloaded.file,
      update: latest,
      targetPath: process.platform === 'darwin' ? macBundlePath() : undefined,
    })
    setTimeout(() => app.quit(), 500)
    return { installing: true, version: latest.version }
  } catch (error) {
    updateRuntime = { ...updateRuntime, installing: false, error: error.message }
    await emitUpdateState()
    throw error
  }
}

async function action(command, p = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid action payload.')
  if (command === 'state') return store.publicState()
  if (command === 'engine.info') return engine.request('GET', '/api/info')
  if (command === 'engine.restart') {
    if (refreshInFlight) await refreshInFlight.catch(() => {})
    await engine.stop()
    await engine.ensure()
    await refreshModels()
    return store.publicState()
  }
  if (command === 'diagnostics') {
    const started = performance.now()
    let info, error = ''
    try { info = await engine.request('GET', '/api/info') } catch (failure) { error = failure.message }
    return {
      version: app.getVersion(), platform: process.platform, arch: process.arch,
      engine: { status: engine.status, version: info?.version || '', responseMs: Math.round(performance.now() - started), error },
      runtime: { electron: process.versions.electron, node: process.versions.node },
      models: store.state.models.length, freeModels: store.state.models.filter(model => model.free).length,
      secureStorage: store.canEncrypt(), rendererSandbox: window?.webContents.getLastWebPreferences().sandbox === true,
    }
  }
  if (command === 'external.open') {
    const url = new URL(text(p.url, 8192))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only web links can be opened.')
    await shell.openExternal(url.href); return
  }
  if (command === 'project.discover') {
    if (importScan) return importScan
    importScan = discoverInWorker({ existing: store.state.projects, tempRoot: app.getPath('temp'), ...(process.env.CIQ_TEST_USER_DATA && process.env.CIQ_TEST_IMPORT_HOME ? { home: process.env.CIQ_TEST_IMPORT_HOME, env: {} } : {}) }).then(result => {
      importCandidates = new Map(result.candidates.map(item => [item.id, item]))
      return result
    }).finally(() => { importScan = null })
    return importScan
  }
  if (command === 'project.import') {
    if (!Array.isArray(p.ids) || !p.ids.length || p.ids.length > 10_000 || p.ids.some(id => typeof id !== 'string' || !importCandidates.has(id))) throw new Error('Scan and select projects to import first.')
    const selected = [...new Set(p.ids)].map(id => importCandidates.get(id))
    const result = await store.importProjects(selected)
    return { ...result, state: await store.publicState() }
  }
  if (command === 'project.importFolders') {
    const choice = await dialog.showOpenDialog(window, { title: 'Import project folders', properties: ['openDirectory', 'multiSelections'], buttonLabel: 'Import folders' })
    if (choice.canceled) return { canceled: true }
    const result = await store.importProjects(choice.filePaths.map(directory => ({ directory, sources: ['Folders'] })))
    return { ...result, state: await store.publicState() }
  }
  if (command === 'project.open') {
    const choice = await dialog.showOpenDialog(window, { title: 'Open a project', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Open project' })
    if (choice.canceled) return store.publicState()
    await store.addProject(choice.filePaths[0])
    return store.publicState()
  }
  if (command === 'project.select') {
    const project = store.project(p.projectID)
    store.state.activeProjectID = project.id; await store.save(); return store.publicState()
  }
  if (command === 'project.close') {
    const project = store.project(p.projectID)
    const confirmed = await dialog.showMessageBox(window, { type: 'question', buttons: ['Cancel', 'Close project'], defaultId: 0, cancelId: 0, message: `Close ${project.name}?`, detail: 'This only removes it from the sidebar. Files and engine conversations are not deleted. Reopening restores saved notes and conversation links.' })
    if (confirmed.response !== 1) return store.publicState()
    project.closed = true
    store.state.activeProjectID = store.state.projects.find(x => !x.closed)?.id
    await store.save(); return store.publicState()
  }
  if (command === 'free.enable') {
    store.state.freeEnabled = true
    await store.save(); await engine.config()
    return refreshModels()
  }
  if (command === 'key.connect') {
    if (p.type !== 'developer') throw new Error('Use a Developer/Gateway key for model access. Standard keys are for the separate platform API.')
    const key = text(p.key, 4096).trim()
    if (key.length < 8 || /\s/.test(key)) throw new Error('Paste a valid Developer API key.')
    // Validate before replacing any existing key or model inventory.
    const gateway = await fetchModels(key)
    await engine.stop()
    await store.setKey(key, p.remember === true)
    store.state.models = mergeModels(gateway, store.state.models.filter(model => model.providerID !== 'collectiviq'))
    const selected = findModel(store.state.models, store.state.selectedModel)
    store.state.selectedModel = selected ? modelKey(selected) : modelKey(gateway[0])
    store.state.lastRefresh = Date.now()
    store.state.toolsConfirmed = p.toolsConfirmed === true
    await store.save(); await engine.config()
    return refreshModels()
  }
  if (command === 'key.disconnect') {
    await engine.stop(); await store.clearKey()
    store.state.models = store.state.models.filter(model => model.providerID !== 'collectiviq')
    const selected = findModel(store.state.models, store.state.selectedModel)
    store.state.selectedModel = selected ? modelKey(selected) : store.state.models[0] ? modelKey(store.state.models[0]) : ''
    await store.save(); await engine.config()
    return refreshModels().catch(() => store.publicState())
  }
  if (command === 'models.refresh') return refreshModels()
  if (command === 'settings.save') {
    if (p.cadence !== undefined) {
      if (!['daily', 'weekly', 'manual'].includes(p.cadence)) throw new Error('Choose daily, weekly or manual refresh.')
      store.state.cadence = p.cadence
    }
    if (p.toolsConfirmed !== undefined) store.state.toolsConfirmed = p.toolsConfirmed === true
    if (p.selectedModel !== undefined) {
      const selected = findModel(store.state.models, p.selectedModel)
      if (!selected) throw new Error('Choose a currently available model.')
      store.state.selectedModel = modelKey(selected)
    }
    await store.save(); await engine.config(); return store.publicState()
  }
  if (command === 'provider.list') {
    const payload = await engine.request('GET', '/api/integration')
    const connected = new Set((await store.publicState()).providers.filter(provider => provider.connected).map(provider => provider.id))
    const data = (payload.data || [])
      .filter(integration => integration?.methods?.some(method => method.type === 'env' && method.names?.length))
      .map(integration => ({
        id: integration.id,
        name: integration.name || integration.id,
        env: integration.methods.find(method => method.type === 'env').names,
        connected: connected.has(integration.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { data }
  }
  if (command === 'provider.connect') {
    const providerID = text(p.providerID, 100)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(providerID)) throw new Error('Choose a provider from the list.')
    const key = text(p.key, 8192).trim()
    if (key.length < 8 || /\s/.test(key)) throw new Error('Paste a valid provider API key.')
    const payload = await engine.request('GET', '/api/integration')
    const integration = (payload.data || []).find(item => item.id === providerID)
    const method = integration?.methods?.find(item => item.type === 'env')
    if (!method?.names?.length) throw new Error('This provider does not expose a key-based connection in this engine.')
    await store.setProviderKey(providerID, key, p.remember === true)
    const existing = store.state.providers.find(item => item.id === providerID)
    if (existing) { existing.name = integration.name || providerID; existing.env = method.names }
    else store.state.providers.push({ id: providerID, name: integration.name || providerID, env: method.names })
    await store.save()
    await engine.stop(); await engine.config()
    return refreshModels()
  }
  if (command === 'provider.disconnect') {
    const providerID = text(p.providerID, 100)
    await store.clearProviderKey(providerID)
    store.state.providers = store.state.providers.filter(provider => provider.id !== providerID)
    store.state.models = store.state.models.filter(model => model.providerID !== providerID)
    const selected = findModel(store.state.models, store.state.selectedModel)
    store.state.selectedModel = selected ? modelKey(selected) : store.state.models[0] ? modelKey(store.state.models[0]) : ''
    await store.save()
    await engine.stop(); await engine.config()
    return refreshModels().catch(() => store.publicState())
  }
  if (command === 'updates.check') return checkForUpdates({ manual: true })
  if (command === 'updates.download') {
    if (!store.state.updates.latest) throw new Error('Check for updates first.')
    return downloadUpdateFor(store.state.updates.latest)
  }
  if (command === 'updates.install') return installPendingUpdate()
  if (command === 'updates.skip') {
    const version = text(p.version, 40)
    store.state.updates.skippedVersion = version
    await store.save(); await emitUpdateState()
    return store.publicState()
  }
  if (command === 'updates.settings') {
    if (p.autoDownload !== undefined) store.state.updates.autoDownload = p.autoDownload === true
    await store.save(); await emitUpdateState()
    return store.publicState()
  }
  if (command === 'mcp.add') {
    const mcp = validateMcp(p)
    if (store.state.mcps.some(m => m.name === mcp.name)) throw new Error('A server already uses that name.')
    store.state.mcps.push(mcp); await store.save(); await engine.config(); return store.publicState()
  }
  if (command === 'mcp.remove') {
    if (!store.state.mcps.some(m => m.name === p.name)) throw new Error('Server not found.')
    store.state.mcps = store.state.mcps.filter(m => m.name !== p.name)
    await store.save(); await engine.config()
    for (const project of store.state.projects) {
      if (engine.url) await engine.request('DELETE', `/api/experimental/mcp/${encodeURIComponent(p.name)}`, undefined, project.directory).catch(() => {})
    }
    return store.publicState()
  }
  const project = store.project(p.projectID || store.state.activeProjectID)
  if (command === 'memory.save') {
    project.memory = text(p.memory, 16_000)
    project.memoryEnabled = p.enabled === true
    await store.save(); return store.publicState()
  }
  if (command === 'session.create') {
    const selected = findModel(store.state.models, p.model || store.state.selectedModel)
    if (!selected) throw new Error('Choose an available model first.')
    await requireModelCredential(selected)
    const response = await engine.request('POST', '/api/session', {
      title: 'New conversation',
      model: { providerID: selected.providerID, id: selected.id },
      location: { directory: project.directory },
      permissions: [{ action: '*', resource: '*', effect: 'ask' }],
    })
    const session = response.data
    project.sessions.unshift({ id: session.id, title: session.title || 'New conversation', model: modelKey(selected), created: Date.now() })
    project.activeSessionID = session.id
    await store.save(); return store.publicState()
  }
  if (command === 'mcp.list') return engine.request('GET', '/api/mcp', undefined, project.directory)
  if (command === 'shell.run') {
    const commandText = text(p.command, 8192).trim()
    if (!commandText) throw new Error('Enter a command first.')
    return engine.request('POST', '/api/shell', { command: commandText, cwd: project.directory, timeout: 120_000 }, project.directory)
  }
  if (command === 'shell.output' || command === 'shell.stop') {
    const shellID = encodeURIComponent(text(p.shellID, 200))
    // Verify ownership through the engine's location-scoped shell lookup.
    const info = await engine.request('GET', `/api/shell/${shellID}`, undefined, project.directory)
    if (info.data.cwd !== project.directory) throw new Error('This command belongs to another project.')
    if (command === 'shell.stop') return engine.request('DELETE', `/api/shell/${shellID}`, undefined, project.directory)
    const output = await engine.request('GET', `/api/shell/${shellID}/output?limit=32768&cursor=${Number.isSafeInteger(p.cursor) && p.cursor >= 0 ? p.cursor : 0}`, undefined, project.directory)
    return { ...output, status: info.data.status }
  }
  if (command === 'mcp.toggle') {
    const mcp = store.state.mcps.find(m => m.name === p.name)
    if (!mcp) throw new Error('Server not found.')
    mcp.config.disabled = p.enabled !== true
    await store.save(); await engine.config()
    await engine.request('PUT', `/api/experimental/mcp/${encodeURIComponent(mcp.name)}`, { config: mcp.config }, project.directory)
    return store.publicState()
  }
  if (command === 'mcp.auth') {
    const list = await engine.request('GET', '/api/integration', undefined, project.directory)
    const integration = list.data.find(i => i.id === p.integrationID)
    const method = integration?.methods.find(m => m.type === 'oauth')
    if (!method) throw new Error('This server does not advertise an OAuth sign-in method.')
    return engine.request('POST', `/api/integration/${encodeURIComponent(integration.id)}/connect/oauth`, { methodID: method.id }, project.directory)
  }
  if (command === 'mcp.authStatus' || command === 'mcp.authComplete') {
    const route = `/api/integration/${encodeURIComponent(text(p.integrationID, 300))}/connect/oauth/${encodeURIComponent(text(p.attemptID, 300))}`
    return engine.request(command === 'mcp.authStatus' ? 'GET' : 'POST', command === 'mcp.authStatus' ? route : `${route}/complete`, command === 'mcp.authStatus' ? undefined : { code: text(p.code, 8192) }, project.directory)
  }
  const session = requireSession(project, p.sessionID || project.activeSessionID)
  const route = `/api/session/${session}`
  if (command === 'session.select') { project.activeSessionID = p.sessionID; await store.save(); return store.publicState() }
  if (command === 'session.messages') {
    const [messages, active] = await Promise.all([
      engine.request('GET', `${route}/message?limit=80&${p.cursor ? `cursor=${encodeURIComponent(text(p.cursor, 8192))}` : 'order=desc'}`),
      engine.request('GET', '/api/session/active'),
    ])
    return { ...messages, active: Boolean(active.data[p.sessionID || project.activeSessionID]) }
  }
  if (command === 'permission.list') return engine.request('GET', `${route}/permission`)
  if (command === 'form.list') return engine.request('GET', `${route}/form`)
  if (command === 'session.prompt') {
    const saved = currentSession(project, p.sessionID)
    const selected = findModel(store.state.models, saved?.model || store.state.selectedModel)
    if (!selected) throw new Error('Choose an available model in Model library before sending.')
    await requireModelCredential(selected)
    const message = text(p.text).trim()
    if (!message) throw new Error('Write a prompt first.')
    const result = await engine.request('POST', `${route}/prompt`, { text: memoryPrompt(project, message), metadata: { ciqDisplayText: message } })
    if (saved && saved.title === 'New conversation') {
      // Prompt acceptance must not be reported as a failure if cosmetic title
      // saving fails afterward: retrying would send the same prompt twice.
      try {
        const title = message.slice(0, 70)
        await engine.request('PATCH', route, { title })
        saved.title = title
        await store.save(); await emitState()
      } catch { broadcast({ type: 'ciq.refresh.error', data: { message: 'Your prompt was sent, but its conversation title could not be saved.' } }) }
    }
    return result
  }
  if (command === 'session.interrupt') return engine.request('POST', `${route}/interrupt`, {})
  if (command === 'session.agent') {
    if (!['build', 'plan'].includes(p.agent)) throw new Error('Choose Build or Plan mode.')
    return engine.request('POST', `${route}/agent`, { agent: p.agent })
  }
  if (command === 'session.model') {
    const selected = findModel(store.state.models, p.model)
    if (!selected) throw new Error('That model is no longer available. Refresh and choose another.')
    await requireModelCredential(selected)
    await engine.request('POST', `${route}/model`, { model: { providerID: selected.providerID, id: selected.id } })
    const saved = currentSession(project, p.sessionID)
    if (saved) saved.model = modelKey(selected)
    await store.save(); return store.publicState()
  }
  if (command === 'session.rename') {
    const title = text(p.title, 140).trim()
    if (!title) throw new Error('Provide a conversation title.')
    await engine.request('PATCH', route, { title })
    const saved = currentSession(project, p.sessionID)
    if (saved) saved.title = title
    await store.save(); return store.publicState()
  }
  if (command === 'session.archive') {
    await engine.request('PATCH', route, { archived: true })
    const saved = currentSession(project, p.sessionID)
    if (saved) saved.archived = true
    project.activeSessionID = project.sessions.find(s => !s.archived)?.id
    await store.save(); return store.publicState()
  }
  if (command === 'permission.reply') {
    if (!['once', 'reject'].includes(p.decision)) throw new Error('Choose allow once or reject.')
    return engine.request('POST', `${route}/permission/${encodeURIComponent(text(p.requestID, 200))}/reply`, { decision: p.decision })
  }
  if (command === 'form.reply') return engine.request('POST', `${route}/form/${encodeURIComponent(text(p.formID, 200))}/reply`, { answer: p.answer })
  if (command === 'form.cancel') return engine.request('DELETE', `${route}/form/${encodeURIComponent(text(p.formID, 200))}`)
  throw new Error('Unsupported action.')
}

async function createWindow() {
  window = new BrowserWindow({
    title: 'CIQ Developer Terminal', width: 1380, height: 920, minWidth: 760, minHeight: 600,
    backgroundColor: '#0b0e15',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'), show: false,
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('render-process-gone', async (_event, details) => {
    if (shuttingDown || details.reason === 'clean-exit') return
    const choice = await dialog.showMessageBox(window, { type: 'error', buttons: ['Reload workspace', 'Quit'], defaultId: 0, message: 'The workspace display stopped.', detail: 'Saved projects and conversations are intact. Reload the display to reconnect.' })
    if (choice.response === 0) window.webContents.reload()
    else app.quit()
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (target !== window.webContents.getURL()) event.preventDefault()
  })
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  window.once('ready-to-show', () => window.show())
  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  if (process.env.CIQ_SMOKE_SCREENSHOT) {
    const image = await window.webContents.capturePage()
    await fs.writeFile(process.env.CIQ_SMOKE_SCREENSHOT, image.toPNG())
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.whenReady().then(async () => {
    store = await new Store(userDirectory, safeStorage).load()
    store.runtime.version = app.getVersion()
    engine = new Engine(store, broadcast)
    syncUpdateRuntime()
    ipcMain.handle('ciq:action', async (event, command, payload) => {
      if (shuttingDown) throw new Error('CIQ is shutting down.')
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unauthorized sender.')
      return action(command, payload)
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'CIQ Developer Terminal', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
    ]))
    await createWindow()
    if (process.env.CIQ_TEST_USER_DATA && process.env.CIQ_SMOKE_REPORT) {
      await refreshModels()
      const report = await action('diagnostics')
      await fs.writeFile(process.env.CIQ_SMOKE_REPORT, JSON.stringify(report))
      app.quit(); return
    }
    const catchUp = async () => {
      if (shuttingDown) return
      const key = await store.getKey().catch(() => null)
      const hasFree = store.state.models.some(model => model.providerID === FREE_PROVIDER)
      const needsFree = store.state.freeEnabled && !hasFree
      const needsModels = !store.state.models.length
      const due = shouldRefresh(store.state.lastRefresh, store.state.cadence)
      if (needsFree || needsModels || (due && (key || store.state.freeEnabled || store.state.providers.length))) {
        await refreshModels().catch(error => broadcast({ type: 'ciq.refresh.error', data: { message: error.message } }))
      }
    }
    const backgroundError = error => broadcast({ type: 'ciq.refresh.error', data: { message: error.message } })
    void catchUp().catch(backgroundError)
    refreshTimer = setInterval(() => { void catchUp().catch(backgroundError) }, 60_000)
    updateLaunchTimer = setTimeout(() => { void checkForUpdates().catch(backgroundError) }, 6000)
    updateTimer = setInterval(() => { void checkForUpdates().catch(backgroundError) }, 6 * 60 * 60 * 1000)
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
  }).catch(error => { dialog.showErrorBox('CIQ could not start', error.message); app.quit() })
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault(); quitting = true; shuttingDown = true
    clearInterval(refreshTimer); clearInterval(updateTimer); clearTimeout(updateLaunchTimer)
    Promise.allSettled([engine?.stop(), store?.queue, store?.vaultQueue]).finally(() => app.quit())
  })
}

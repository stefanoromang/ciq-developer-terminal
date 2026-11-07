const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { Store, fetchModels, shouldRefresh, validateMcp, memoryPrompt } = require('./core.cjs')
const { Engine } = require('./engine.cjs')

app.setName('CIQ Developer Terminal')
// Never share OpenCode's user data, credentials or service.
const userDirectory = process.env.CIQ_TEST_USER_DATA || path.join(app.getPath('appData'), 'CIQ Developer Terminal')
app.setPath('userData', userDirectory)
let store, engine, window, quitting = false, refreshTimer, refreshInFlight

function broadcast(event) {
  // Provider/config/credential events may carry sensitive engine internals.
  // The renderer only needs projected session lifecycle notifications.
  if (!/^(ciq\.|session\.|permission\.|form\.|mcp\.|server\.connected)/.test(event.type)) return
  if (window && !window.isDestroyed()) window.webContents.send('ciq:event', event)
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
async function emitState() { broadcast({ type: 'ciq.state', data: await store.publicState() }) }

async function refreshModels() {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const key = await store.getKey()
    if (!key) throw new Error('Connect your CollectivIQ Developer API key first.')
    const models = await fetchModels(key)
    const old = new Set(store.state.models.map(m => m.id))
    store.state.newModels = models.filter(m => !old.has(m.id)).map(m => m.id)
    store.state.models = models
    store.state.lastRefresh = Date.now()
    if (!store.state.selectedModel) store.state.selectedModel = models[0].id
    await store.save()
    await engine.config()
    await emitState()
    return await store.publicState()
  })().finally(() => { refreshInFlight = null })
  return refreshInFlight
}

async function action(command, p = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid action payload.')
  if (command === 'state') return store.publicState()
  if (command === 'engine.info') return engine.request('GET', '/api/info')
  if (command === 'external.open') {
    const url = new URL(text(p.url, 8192))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only web links can be opened.')
    await shell.openExternal(url.href); return
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
  if (command === 'key.connect') {
    if (p.type !== 'developer') throw new Error('Use a Developer/Gateway key for model access. Standard keys are for the separate platform API.')
    const key = text(p.key, 4096).trim()
    if (key.length < 8 || /\s/.test(key)) throw new Error('Paste a valid Developer API key.')
    // Validate before replacing any existing key or model inventory.
    const models = await fetchModels(key)
    await engine.stop()
    await store.setKey(key, p.remember === true)
    store.state.models = models
    store.state.selectedModel = models.some(m => m.id === store.state.selectedModel) ? store.state.selectedModel : models[0].id
    store.state.lastRefresh = Date.now()
    store.state.toolsConfirmed = p.toolsConfirmed === true
    await store.save(); await engine.config()
    return store.publicState()
  }
  if (command === 'key.disconnect') {
    await engine.stop(); await store.clearKey(); return store.publicState()
  }
  if (command === 'models.refresh') return refreshModels()
  if (command === 'settings.save') {
    if (p.cadence !== undefined) {
      if (!['daily', 'weekly', 'manual'].includes(p.cadence)) throw new Error('Choose daily, weekly or manual refresh.')
      store.state.cadence = p.cadence
    }
    if (p.toolsConfirmed !== undefined) store.state.toolsConfirmed = p.toolsConfirmed === true
    if (p.selectedModel !== undefined) {
      if (!store.state.models.some(m => m.id === p.selectedModel)) throw new Error('Choose a currently available gateway model.')
      store.state.selectedModel = p.selectedModel
    }
    await store.save(); await engine.config(); return store.publicState()
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
    const model = p.model || store.state.selectedModel
    if (!store.state.models.some(m => m.id === model)) throw new Error('Connect a key and select an available model first.')
    if (!await store.getKey()) throw new Error('Connect your Developer API key first.')
    const response = await engine.request('POST', '/api/session', { title: 'New conversation', model: { providerID: 'collectiviq', id: model }, location: { directory: project.directory }, permissions: [{ action: '*', resource: '*', effect: 'ask' }] })
    const session = response.data
    project.sessions.unshift({ id: session.id, title: session.title || 'New conversation', model, created: Date.now() })
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
    if (!await store.getKey()) throw new Error('Connect your Developer API key first.')
    const message = text(p.text).trim()
    if (!message) throw new Error('Write a prompt first.')
    const result = await engine.request('POST', `${route}/prompt`, { text: memoryPrompt(project, message), metadata: { ciqDisplayText: message } })
    const saved = project.sessions.find(s => s.id === (p.sessionID || project.activeSessionID))
    if (saved.title === 'New conversation') {
      saved.title = message.slice(0, 70)
      await engine.request('PATCH', route, { title: saved.title }); await store.save(); await emitState()
    }
    return result
  }
  if (command === 'session.interrupt') return engine.request('POST', `${route}/interrupt`, {})
  if (command === 'session.agent') {
    if (!['build', 'plan'].includes(p.agent)) throw new Error('Choose Build or Plan mode.')
    return engine.request('POST', `${route}/agent`, { agent: p.agent })
  }
  if (command === 'session.model') {
    if (!store.state.models.some(m => m.id === p.model)) throw new Error('That model is no longer in the gateway catalog. Refresh and choose another.')
    await engine.request('POST', `${route}/model`, { model: { providerID: 'collectiviq', id: p.model } })
    project.sessions.find(s => s.id === (p.sessionID || project.activeSessionID)).model = p.model
    await store.save(); return store.publicState()
  }
  if (command === 'session.rename') {
    const title = text(p.title, 140).trim()
    if (!title) throw new Error('Provide a conversation title.')
    await engine.request('PATCH', route, { title })
    project.sessions.find(s => s.id === (p.sessionID || project.activeSessionID)).title = title
    await store.save(); return store.publicState()
  }
  if (command === 'session.archive') {
    await engine.request('PATCH', route, { archived: true })
    project.sessions.find(s => s.id === (p.sessionID || project.activeSessionID)).archived = true
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
    backgroundColor: '#0b0e15', titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'), show: false,
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
    engine = new Engine(store, broadcast)
    ipcMain.handle('ciq:action', async (event, command, payload) => {
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
    const catchUp = async () => {
      if (shouldRefresh(store.state.lastRefresh, store.state.cadence) && await store.getKey()) {
        await refreshModels().catch(error => broadcast({ type: 'ciq.refresh.error', data: { message: error.message } }))
      }
    }
    await catchUp()
    refreshTimer = setInterval(() => { void catchUp() }, 60_000)
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
  }).catch(error => { dialog.showErrorBox('CIQ could not start', error.message); app.quit() })
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault(); quitting = true; clearInterval(refreshTimer)
    Promise.resolve(engine?.stop()).finally(() => app.quit())
  })
}

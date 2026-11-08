const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { fileURLToPath } = require('node:url')
const { createHash } = require('node:crypto')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')

const MAX_FILE = 8 * 1024 * 1024
const MAX_ENTRIES = 10_000
const SOURCES = ['Claude', 'Codex', 'Cursor', 'OpenCode', 'VS Code', 'Windsurf']

function localPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null
  try {
    if (value.startsWith('file:')) value = fileURLToPath(value)
    else if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return null
    if (path.isAbsolute(value)) return path.normalize(value)
    return base ? path.resolve(base, value) : null
  } catch { return null }
}

// Only metadata fields identifying folders are consumed. Transcript text,
// credentials and instructions are never copied into CIQ workspace state.
async function discoverProjects({ home = os.homedir(), platform = process.platform, env = process.env, existing = [], tempRoot = os.tmpdir() } = {}) {
  const found = new Map(), warnings = new Set(), scanned = new Set()
  const read = async file => {
    try {
      if ((await fs.stat(file)).size > MAX_FILE) { warnings.add('An oversized metadata file was skipped. Use Choose folders for any missing project.'); return null }
      return await fs.readFile(file, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') warnings.add('Some app metadata could not be read. You can still choose its folders manually.')
      return null
    }
  }
  const json = async file => { const text = await read(file); if (!text) return null; try { return JSON.parse(text) } catch { warnings.add('An app metadata file could not be parsed. Other sources are still available.'); return null } }
  const entries = async directory => {
    try {
      const result = await fs.readdir(directory, { withFileTypes: true })
      if (result.length > MAX_ENTRIES) warnings.add('A large source was limited to 10,000 entries. Choose missing folders manually.')
      return result.slice(0, MAX_ENTRIES)
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') warnings.add('A source folder could not be read. Choose project folders manually if needed.')
      return []
    }
  }
  const add = (value, source, base) => {
    const directory = localPath(value, base)
    if (!directory || directory === path.parse(directory).root) return
    if (found.size >= MAX_ENTRIES) { warnings.add('Discovery reached 10,000 folders. Choose additional folders manually.'); return }
    const key = platform === 'win32' ? directory.toLowerCase() : directory
    const entry = found.get(key) || { directory, sources: new Set() }
    entry.sources.add(source); found.set(key, entry)
  }
  const workspace = async (value, source) => {
    const file = localPath(value)
    if (!file || !file.endsWith('.code-workspace')) return
    const text = await read(file)
    if (!text) return
    const { parse } = require('jsonc-parser')
    const errors = []
    const data = parse(text, errors, { allowTrailingComma: true })
    if (errors.length) { warnings.add(`${source}: a workspace file could not be parsed.`); return }
    for (const folder of data?.folders || []) add(folder.path || folder.uri, source, path.dirname(file))
  }
  const recent = async (data, source) => {
    for (const entry of data?.entries || []) {
      add(entry.folderUri, source)
      await workspace(entry.workspace?.configPath || entry.workspaceUri, source)
    }
  }
  const sessionHeader = async (file, source) => {
    let handle
    try {
      handle = await fs.open(file, 'r')
      const buffer = Buffer.alloc(64 * 1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
        try {
          const row = JSON.parse(line)
          const cwd = source === 'Codex' ? (row.type === 'session_meta' ? row.payload?.cwd : null) : row.cwd
          if (cwd) { add(cwd, source); break }
        } catch { /* partial final JSONL line */ }
      }
    } catch (error) { if (error.code !== 'ENOENT') warnings.add(`${source}: some session headers could not be read.`) }
    finally { await handle?.close() }
  }
  let walked = 0
  const headers = async (directory, source, depth = 0) => {
    if (depth > 4) return
    for (const entry of await entries(directory)) {
      if (++walked > MAX_ENTRIES) { warnings.add('Session header scan was limited to 10,000 entries. Choose missing folders manually.'); return }
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await headers(file, source, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) await sessionHeader(file, source)
    }
  }
  // Use SQLite's online backup API to include WAL data in a coherent snapshot.
  // Neither the live database nor its schema is changed.
  const database = async (file, source, consume) => {
    try { await fs.access(file) } catch { return }
    let original, snapshot, temporary
    try {
      const { DatabaseSync, backup } = require('node:sqlite')
      original = new DatabaseSync(file, { readOnly: true, timeout: 1000 })
      temporary = await fs.mkdtemp(path.join(tempRoot, 'ciq-import-'))
      const copy = path.join(temporary, 'snapshot.db')
      await backup(original, copy)
      original.close(); original = null
      snapshot = new DatabaseSync(copy, { readOnly: true })
      await consume(snapshot)
    } catch { warnings.add(`${source}: a local database could not be read. Use Choose folders for any missing project.`) }
    finally { snapshot?.close(); original?.close(); if (temporary) await fs.rm(temporary, { recursive: true, force: true }) }
  }
  const column = (db, table, field, source) => {
    if (!db.prepare(`PRAGMA table_info("${table}")`).all().some(item => item.name === field)) return
    for (const row of db.prepare(`SELECT DISTINCT "${field}" AS folder FROM "${table}" LIMIT ${MAX_ENTRIES}`).all()) add(row.folder, source)
  }

  scanned.add('Claude')
  const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  for (const file of [path.join(home, '.claude.json'), path.join(claudeHome, '.claude.json')]) {
    const config = await json(file)
    for (const directory of Object.keys(config?.projects || {})) add(directory, 'Claude')
  }
  for (const entry of await entries(path.join(claudeHome, 'projects'))) {
    if (!entry.isDirectory()) continue
    const dir = path.join(claudeHome, 'projects', entry.name)
    const index = await json(path.join(dir, 'sessions-index.json'))
    add(index?.originalPath, 'Claude')
    for (const session of index?.entries || []) add(session.projectPath, 'Claude')
    if (!index) await headers(dir, 'Claude')
  }

  scanned.add('Codex')
  const codexHome = env.CODEX_HOME || path.join(home, '.codex')
  const codex = await json(path.join(codexHome, '.codex-global-state.json'))
  for (const key of ['electron-saved-workspace-roots', 'active-workspace-roots']) {
    for (const directory of Array.isArray(codex?.[key]) ? codex[key] : []) add(directory, 'Codex')
  }
  const config = await read(path.join(codexHome, 'config.toml'))
  for (const match of (config || '').matchAll(/^\[projects\.("(?:[^"\\]|\\.)*"|'[^']*')\]\s*$/gm)) {
    try { add(match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1), 'Codex') } catch { /* invalid TOML path */ }
  }
  for (const entry of await entries(codexHome)) if (/^state_\d+\.sqlite$/.test(entry.name)) await database(path.join(codexHome, entry.name), 'Codex', db => column(db, 'threads', 'cwd', 'Codex'))
  await headers(path.join(codexHome, 'sessions'), 'Codex')
  await headers(path.join(codexHome, 'archived_sessions'), 'Codex')

  const appData = platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : env.XDG_CONFIG_HOME || path.join(home, '.config')
  for (const [source, app] of [['Cursor', 'Cursor'], ['VS Code', 'Code'], ['Windsurf', 'Windsurf']]) {
    scanned.add(source)
    const user = path.join(appData, app, 'User')
    const global = path.join(user, 'globalStorage')
    const storage = await json(path.join(global, 'storage.json'))
    for (const directory of storage?.openedPathsList?.folders || []) add(directory, source)
    await recent(storage?.['history.recentlyOpenedPathsList'], source)
    for (const window of [storage?.windowsState?.lastActiveWindow, ...(storage?.windowsState?.openedWindows || [])]) {
      add(window?.folderUri, source)
      await workspace(window?.workspace?.configPath, source)
    }
    await database(path.join(global, 'state.vscdb'), source, async db => {
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('history.recentlyOpenedPathsList')
      if (row) await recent(JSON.parse(row.value), source)
    })
    for (const entry of await entries(path.join(user, 'workspaceStorage'))) {
      if (!entry.isDirectory()) continue
      const data = await json(path.join(user, 'workspaceStorage', entry.name, 'workspace.json'))
      add(data?.folder, source)
      await workspace(data?.workspace, source)
    }
  }

  scanned.add('OpenCode')
  const openData = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode')
  await database(path.join(openData, 'opencode.db'), 'OpenCode', db => {
    for (const [table, field] of [['project', 'worktree'], ['project_directory', 'directory'], ['session', 'directory'], ['session_v2', 'directory']]) column(db, table, field, 'OpenCode')
  })
  for (const entry of await entries(path.join(openData, 'storage', 'project'))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const data = await json(path.join(openData, 'storage', 'project', entry.name))
    add(data?.worktree, 'OpenCode')
    for (const dir of data?.sandboxes || []) add(dir, 'OpenCode')
  }

  const canonical = new Map()
  for (const entry of found.values()) {
    let directory = entry.directory, available = false
    try { directory = await fs.realpath(directory); available = (await fs.stat(directory)).isDirectory() } catch { /* show unavailable folders */ }
    const key = platform === 'win32' ? directory.toLowerCase() : directory
    const previous = canonical.get(key)
    if (previous) { for (const source of entry.sources) previous.sources.add(source); continue }
    canonical.set(key, { directory, available, sources: entry.sources })
  }
  const existingPaths = new Set(existing.filter(item => !item.closed).map(item => platform === 'win32' ? item.directory.toLowerCase() : item.directory))
  const candidates = [...canonical.entries()].map(([key, item]) => ({
    id: createHash('sha256').update(key).digest('hex'), directory: item.directory,
    name: path.basename(item.directory), sources: [...item.sources].sort(), available: item.available,
    added: existingPaths.has(key),
  })).sort((a, b) => a.name.localeCompare(b.name) || a.directory.localeCompare(b.directory))
  return { candidates, warnings: [...warnings], sources: [...scanned] }
}

function discoverInWorker(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: options })
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Project discovery took too long. Use Choose folders or try scanning again.')) }, 60_000)
    worker.once('message', result => { clearTimeout(timer); result.error ? reject(new Error(result.error)) : resolve(result) })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Project discovery stopped. Use Choose folders to import manually.')) })
  })
}
if (!isMainThread) discoverProjects(workerData).then(result => parentPort.postMessage(result)).catch(() => parentPort.postMessage({ error: 'Project discovery failed. You can still choose folders manually.' }))
module.exports = { discoverProjects, discoverInWorker, localPath, SOURCES }

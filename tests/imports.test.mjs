import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { discoverProjects, discoverInWorker, localPath } = require('../electron/imports.cjs')
const { Store } = require('../electron/core.cjs')

test('imports discover all supported sources, deduplicate, report missing folders and preserve files', async t => {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-import-fixture-')))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const write = async (relative, value) => {
    const file = path.join(home, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value))
    return file
  }
  const project = path.join(home, 'Projects', 'Shared folder')
  const other = path.join(home, 'Projects', 'Other')
  const missing = path.join(home, 'Missing')
  await fs.mkdir(project, { recursive: true }); await fs.mkdir(other, { recursive: true })
  const sentinel = await write('Projects/Shared folder/README.md', 'original project contents')
  await write('.claude.json', { projects: { [project]: {} }, mcpServers: { ignored: { secret: 'not imported' } } })
  await write('.claude/projects/index/sessions-index.json', { entries: [{ projectPath: other }] })
  await write('.claude/projects/header/session.jsonl', JSON.stringify({ cwd: project, text: 'not imported' }) + '\n')
  await write('.codex/.codex-global-state.json', { 'electron-saved-workspace-roots': [project, missing] })
  await write('.codex/config.toml', `[projects.${JSON.stringify(other)}]\ntrust_level="trusted"\n`)
  await write('.codex/sessions/2026/11/07/a.jsonl', JSON.stringify({ type: 'session_meta', payload: { cwd: other } }) + '\n')
  const workspace = await write('Projects/both.code-workspace', '{// JSONC workspace\n"folders":[{"path":"Shared folder"},{"path":"Other"},],}')
  await write('apps/Cursor/User/workspaceStorage/one/workspace.json', { folder: pathToFileURL(project).href })
  await write('apps/Code/User/globalStorage/storage.json', { windowsState: { lastActiveWindow: { workspace: { configPath: workspace } } } })
  await write('apps/Windsurf/User/workspaceStorage/one/workspace.json', { workspace: pathToFileURL(workspace).href })
  const databaseFile = path.join(home, 'data/opencode/opencode.db')
  await fs.mkdir(path.dirname(databaseFile), { recursive: true })
  const db = new DatabaseSync(databaseFile)
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE project (worktree TEXT); CREATE TABLE project_directory (directory TEXT); CREATE TABLE session_v2 (directory TEXT)')
  db.prepare('INSERT INTO project VALUES (?)').run(project)
  db.prepare('INSERT INTO project_directory VALUES (?)').run(other)
  db.prepare('INSERT INTO session_v2 VALUES (?)').run(missing)
  // Keep WAL open during discovery: its online snapshot must include these rows.
  const options = { home, platform: 'linux', env: { XDG_CONFIG_HOME: path.join(home, 'apps'), XDG_DATA_HOME: path.join(home, 'data') }, existing: [{ directory: other }], tempRoot: home }
  const before = await fs.readFile(databaseFile)
  const result = await discoverInWorker(options)
  assert.deepEqual(result.warnings, [])
  assert.equal(result.candidates.length, 3)
  const shared = result.candidates.find(item => item.directory === project)
  assert.deepEqual(shared.sources, ['Claude', 'Codex', 'Cursor', 'OpenCode', 'VS Code', 'Windsurf'])
  assert.equal(shared.available, true)
  assert.equal(result.candidates.find(item => item.directory === other).added, true)
  assert.equal(result.candidates.find(item => item.directory === missing).available, false)
  assert.deepEqual(await fs.readFile(databaseFile), before)
  db.close()
  assert.equal(JSON.stringify(result).includes('not imported'), false)
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'original project contents')

  const store = await new Store(path.join(home, 'ciq'), { isEncryptionAvailable: () => false }).load()
  const saved = await store.addProject(project)
  saved.memory = 'keep my notes'; saved.sessions.push({ id: 'saved-session', model: 'opencode/test' }); saved.closed = true
  const imported = await store.importProjects(result.candidates)
  assert.equal(imported.imported, 2)
  assert.equal(imported.failed.length, 1)
  assert.equal(store.project(saved.id).memory, 'keep my notes')
  assert.equal(store.project(saved.id).sessions[0].id, 'saved-session')
  assert.equal(store.project(saved.id).closed, false)
  assert.equal((await store.importProjects([shared])).existing, 1)
  assert.equal((await new Store(store.directory, store.secureStorage).load()).state.projects.length, 2)
})

test('unavailable sources and malformed metadata do not abort the scan', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-import-empty-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  await fs.writeFile(path.join(home, '.claude.json'), '{broken')
  const result = await discoverProjects({ home, env: {}, tempRoot: home })
  assert.equal(result.candidates.length, 0)
  assert.match(result.warnings[0], /could not be parsed/)
  assert.equal(localPath('vscode-remote://ssh-remote/host/project'), null)
  assert.equal(localPath('relative-only'), null)
})

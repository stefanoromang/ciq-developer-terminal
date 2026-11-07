import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Store } = require('../electron/core.cjs')
const { Engine } = require('../electron/engine.cjs')

test('real pinned engine starts privately, persists sessions, guards API, and runs local shell', { timeout: 90_000 }, async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ciq-engine-test-'))
  const directory = path.join(root, 'project')
  await fs.mkdir(directory)
  const store = await new Store(path.join(root, 'user'), { isEncryptionAvailable: () => false }).load()
  store.state.models = [{ id: 'fixture-model', name: 'Fixture model', tools: false }]
  store.state.selectedModel = 'fixture-model'
  const events = []
  const engine = new Engine(store, event => events.push(event.type))
  try {
    const info = await engine.request('GET', '/api/info')
    assert.equal(info.version, '2.2.6')
    assert.equal((await fetch(`${engine.url}/api/info`)).status, 401)
    const config = await engine.request('GET', '/api/config')
    assert.ok(config.every(c => c.path.startsWith(root)))
    const created = await engine.request('POST', '/api/session', { title: 'CIQ integration fixture', location: { directory }, model: { providerID: 'collectiviq', id: 'fixture-model' }, permissions: [{ action: '*', resource: '*', effect: 'ask' }] })
    assert.ok(created.data.id.startsWith('ses'))
    const id = created.data.id
    const messages = await engine.request('GET', `/api/session/${id}/message?limit=80&order=desc`)
    assert.ok(Array.isArray(messages.data))
    const permissions = await engine.request('GET', `/api/session/${id}/permission`)
    assert.ok(Array.isArray(permissions.data))
    const forms = await engine.request('GET', `/api/session/${id}/form`)
    assert.ok(Array.isArray(forms.data))
    await engine.request('POST', `/api/session/${id}/prompt`, { text: 'This fixture is queued only. No generation.', resume: false, metadata: { ciqDisplayText: 'Fixture' } })
    const projected = await engine.request('GET', `/api/session/${id}/message?limit=80&order=desc`)
    console.log('queued message shape:', JSON.stringify(projected).slice(0, 1500))
    const mcp = await engine.request('GET', '/api/mcp', undefined, directory)
    assert.ok(Array.isArray(mcp.data))
    const shell = await engine.request('POST', '/api/shell', { command: 'node -e "process.stdout.write(\'ciq-local-shell-ok\')"', cwd: directory, timeout: 5000 }, directory)
    const shellID = shell.data.id
    let shellInfo
    for (let count = 0; count < 50; count++) {
      shellInfo = await engine.request('GET', `/api/shell/${shellID}`, undefined, directory)
      if (shellInfo.data.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal(shellInfo.data.exit, 0)
    const output = await engine.request('GET', `/api/shell/${shellID}/output?limit=4096`, undefined, directory)
    assert.match(output.data.output, /ciq-local-shell-ok/)
    const pid = engine.child.pid
    await engine.stop()
    assert.throws(() => process.kill(pid, 0))
    const restored = await engine.request('GET', `/api/session/${id}`)
    assert.equal(restored.data.title, 'CIQ integration fixture')
    assert.ok(events.length > 0)
    console.log('engine events observed:', [...new Set(events)])
  } finally { await engine.stop() }
})

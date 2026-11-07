import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Store } = require('../electron/core.cjs')
const { Engine } = require('../electron/engine.cjs')

test('local MCP connects explicitly, reports status, and persists across engine restart', { timeout: 90_000 }, async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ciq-mcp-test-'))
  const directory = path.join(root, 'project')
  await fs.mkdir(directory)
  const store = await new Store(path.join(root, 'user'), { isEncryptionAvailable: () => false }).load()
  const config = { type: 'local', command: [process.execPath, fileURLToPath(new URL('./fixtures/mcp-server.cjs', import.meta.url))], disabled: true }
  store.state.mcps = [{ name: 'local-fixture', config }]
  await store.save()
  const engine = new Engine(store)
  const status = async () => (await engine.request('GET', '/api/mcp', undefined, directory)).data.find(m => m.name === 'local-fixture')
  const until = async expected => {
    for (let n = 0; n < 100; n++) {
      const current = await status()
      if (current?.status.status === expected) return current
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`MCP did not reach ${expected}: ${JSON.stringify(await status())}`)
  }
  try {
    await until('disabled')
    config.disabled = false
    await store.save(); await engine.config()
    await engine.request('PUT', '/api/experimental/mcp/local-fixture', { config }, directory)
    await until('connected')
    await engine.stop()
    await until('connected')
    config.disabled = true
    await store.save(); await engine.config()
    await engine.request('PUT', '/api/experimental/mcp/local-fixture', { config }, directory)
    await until('disabled')
  } finally { await engine.stop() }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Store, normalizeModels, fetchModels, shouldRefresh, engineConfig, validateMcp, memoryPrompt } = require('../electron/core.cjs')
const temporary = () => fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ciq-core-test-'))
const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`encrypted:${value}`), decryptString: value => value.toString().slice(10) }

test('catalog is dynamic, deduplicated and excludes non-chat models', () => {
  assert.deepEqual(normalizeModels({ data: [{ id: 'coder-a', supports_tools: true }, { id: 'coder-a' }, { id: 'embed-one', type: 'embedding' }, { id: 'tts-voice' }, { id: '' }, { id: 'coder-b', name: 'B', capabilities: { tools: false }, context_window: 200000 }] }), [
    { id: 'coder-b', name: 'B', provider: 'CollectivIQ', tools: false, context: 200000 },
    { id: 'coder-a', name: 'coder-a', provider: 'CollectivIQ', tools: true, context: null },
  ])
  assert.throws(() => normalizeModels({ data: [] }), /no chat models/)
  assert.throws(() => normalizeModels({ models: [] }), /invalid model catalog/)
})
test('gateway fetch sends credentials only to the exact endpoint and rejects redirects', async () => {
  let request
  const models = await fetchModels('test-fixture-not-a-secret', { fetchImpl: async (url, init) => { request = { url, init }; return { ok: true, json: async () => ({ data: [{ id: 'fixture-model' }] }) } } })
  assert.equal(request.url, 'https://api.prod.collectiviq.ai/v1/models')
  assert.equal(request.init.redirect, 'error')
  assert.equal(request.init.headers.Authorization, 'Bearer test-fixture-not-a-secret')
  assert.equal(models[0].id, 'fixture-model')
  assert.equal(models[0].tools, null)
})
test('authentication and rate-limit failures never leak the key or response body', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(fetchModels('secret-fixture', { fetchImpl: async () => ({ ok: false, status, text: async () => 'secret-fixture' }) }), error => !error.message.includes('secret-fixture'))
  }
})
test('refresh cadence catches up without checking early or running manual checks', () => {
  assert.equal(shouldRefresh(0, 'daily', 100), true)
  assert.equal(shouldRefresh(100, 'daily', 86_400_099), false)
  assert.equal(shouldRefresh(100, 'daily', 86_400_100), true)
  assert.equal(shouldRefresh(100, 'weekly', 604_800_100), true)
  assert.equal(shouldRefresh(0, 'manual'), false)
})
test('key storage encrypts, isolates public state, supports session-only, and disconnects', async () => {
  const root = await temporary()
  const store = await new Store(root, encryption).load()
  await store.setKey('fixture-key', true)
  await store.save()
  assert.equal((await fs.readFile(store.vault)).toString(), 'encrypted:fixture-key')
  assert.equal(JSON.stringify(await store.publicState()).includes('fixture-key'), false)
  assert.equal((await new Store(root, encryption).load()).key, null)
  assert.equal(await (await new Store(root, encryption).load()).getKey(), 'fixture-key')
  await store.setKey('session-fixture', false)
  await assert.rejects(fs.stat(store.vault), { code: 'ENOENT' })
  assert.equal(await store.getKey(), 'session-fixture')
  await store.clearKey()
  assert.equal(await store.getKey(), null)
})
test('Linux basic_text fallback is never accepted as secure storage', async () => {
  const store = await new Store(await temporary(), { ...encryption, getSelectedStorageBackend: () => 'basic_text' }).load()
  assert.equal(store.canEncrypt(), false)
  await assert.rejects(store.setKey('fixture-key', true), /Secure OS/)
  await store.setKey('fixture-key', false)
  assert.equal(await store.getKey(), 'fixture-key')
})
test('corrupt workspace settings are preserved, never reset', async () => {
  const root = await temporary()
  await fs.writeFile(path.join(root, 'workspace.json'), '{broken')
  await assert.rejects(new Store(root, encryption).load(), /not been overwritten/)
  assert.equal(await fs.readFile(path.join(root, 'workspace.json'), 'utf8'), '{broken')
})
test('projects use canonical paths, keep independent notes, and reopen cleanly', async () => {
  const root = await temporary(), a = await temporary(), b = await temporary()
  const store = await new Store(root, encryption).load()
  const projectA = await store.addProject(a)
  projectA.memory = 'A-only notes'; projectA.closed = true
  const projectB = await store.addProject(b)
  assert.equal(projectB.memory, '')
  const reopened = await store.addProject(a)
  assert.equal(reopened.id, projectA.id)
  assert.equal(reopened.closed, false)
  assert.equal(store.state.projects.length, 2)
  assert.equal(memoryPrompt(projectB, 'hello'), 'hello')
  assert.match(memoryPrompt(projectA, 'hello'), /A-only notes/)
  projectA.memoryEnabled = false
  assert.equal(memoryPrompt(projectA, 'hello'), 'hello')
})
test('MCP setup validates transport, saves disabled, and does not shell-expand commands', () => {
  assert.deepEqual(validateMcp({ name: 'docs', type: 'remote', url: 'https://mcp.example/mcp' }), { name: 'docs', config: { type: 'remote', url: 'https://mcp.example/mcp', disabled: true } })
  assert.throws(() => validateMcp({ name: 'docs', type: 'remote', url: 'http://remote.example/mcp' }), /HTTPS/)
  assert.throws(() => validateMcp({ name: 'docs', type: 'remote', url: 'https://user:secret@mcp.example' }), /credentials/)
  assert.throws(() => validateMcp({ name: '__bad name', type: 'local', command: 'npx server' }), /unique server name/)
  assert.throws(() => validateMcp({ name: 'docs', type: 'local', command: 'npx server' }), /JSON array/)
  assert.deepEqual(validateMcp({ name: 'docs', type: 'local', command: '["node","$HOME/server.js"]' }).config.command, ['node', '$HOME/server.js'])
})
test('engine config uses V2 shape, no literal secret, and explicit tools capability', () => {
  const config = engineConfig({ models: [{ id: 'unknown', name: 'Unknown', tools: null }, { id: 'chat', name: 'Chat', tools: false }], mcps: [], toolsConfirmed: true, selectedModel: 'unknown' })
  assert.equal(config.providers.collectiviq.settings.apiKey, '{env:CIQ_GATEWAY_KEY}')
  assert.equal(config.providers.collectiviq.models.unknown.capabilities.tools, true)
  assert.equal(config.providers.collectiviq.models.chat.capabilities.tools, false)
  assert.equal(config.permissions[0].effect, 'ask')
  assert.deepEqual(config.mcp, { servers: {} })
})

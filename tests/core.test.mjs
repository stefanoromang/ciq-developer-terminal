import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Store, normalizeModels, normalizeEngineModels, mergeModels, modelKey, findModel, migrateState, fetchModels, shouldRefresh, engineConfig, validateMcp, memoryPrompt, FREE_PROVIDER } = require('../electron/core.cjs')
const temporary = () => fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ciq-core-test-'))
const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`encrypted:${value}`), decryptString: value => value.toString().slice(10) }

test('catalog is dynamic, deduplicated and excludes non-chat models', () => {
  assert.deepEqual(normalizeModels({ data: [{ id: 'coder-a', supports_tools: true }, { id: 'coder-a' }, { id: 'embed-one', type: 'embedding' }, { id: 'tts-voice' }, { id: '' }, { id: 'coder-b', name: 'B', capabilities: { tools: false }, context_window: 200000 }] }), [
    { id: 'coder-b', name: 'B', providerID: 'collectiviq', provider: 'CollectivIQ', tools: false, context: 200000, free: false },
    { id: 'coder-a', name: 'coder-a', providerID: 'collectiviq', provider: 'CollectivIQ', tools: true, context: null, free: false },
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
  await fs.writeFile(path.join(root, 'workspace.json'), '{"projects":null}')
  await assert.rejects(new Store(root, encryption).load(), /not been overwritten/)
  assert.equal(await fs.readFile(path.join(root, 'workspace.json'), 'utf8'), '{"projects":null}')
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
  const config = engineConfig({ models: [{ id: 'unknown', name: 'Unknown', tools: null }, { id: 'chat', name: 'Chat', tools: false }], mcps: [], toolsConfirmed: true, selectedModel: 'collectiviq/unknown' })
  assert.equal(config.providers.collectiviq.settings.apiKey, '{env:CIQ_GATEWAY_KEY}')
  assert.equal(config.providers.collectiviq.models.unknown.capabilities.tools, true)
  assert.equal(config.providers.collectiviq.models.chat.capabilities.tools, false)
  assert.equal(config.permissions[0].effect, 'ask')
  assert.deepEqual(config.mcp, { servers: {} })
  assert.equal(config.model, 'collectiviq/unknown')
  const allowed = config.policies.filter(policy => policy.effect === 'allow').map(policy => policy.resource)
  assert.deepEqual(allowed.sort(), ['collectiviq', 'opencode'])
})
test('engine model catalog filters to allowed providers and marks zero-cost models free', () => {
  const payload = { data: [
    { providerID: 'opencode', modelID: 'big-pickle', name: 'Big Pickle', type: 'chat', cost: [{ input: 0, output: 0 }], capabilities: { tools: true }, limit: { context: 200000 } },
    { providerID: 'opencode', modelID: 'paid-model', name: 'Paid', type: 'chat', cost: [{ input: 1, output: 2 }] },
    { providerID: 'openai', modelID: 'gpt-x', name: 'GPT X', type: 'chat', cost: [{ input: 0, output: 0 }] },
    { providerID: 'opencode', modelID: 'image-one', name: 'Image', type: 'image' },
  ] }
  const models = normalizeEngineModels(payload, {}, ['opencode'])
  assert.deepEqual(models.map(model => model.id), ['big-pickle', 'paid-model'])
  assert.equal(models[0].free, true)
  assert.equal(models[0].provider, 'OpenCode Zen')
  assert.equal(models[0].tools, true)
  assert.equal(models[0].context, 200000)
  assert.equal(models[1].free, false)
})
test('model keys are provider-qualified and legacy bare ids still resolve', () => {
  const models = [
    { id: 'shared', providerID: 'opencode', name: 'Shared free' },
    { id: 'shared', providerID: 'collectiviq', name: 'Shared gateway' },
  ]
  assert.equal(modelKey(models[1]), 'collectiviq/shared')
  assert.equal(findModel(models, 'collectiviq/shared').name, 'Shared gateway')
  assert.equal(findModel(models, 'shared').providerID, 'opencode')
  assert.deepEqual(mergeModels([models[0]], [models[0], models[1]]).map(modelKey), ['opencode/shared', 'collectiviq/shared'])
})
test('migration upgrades legacy workspaces without resetting projects or selections', () => {
  const state = {
    projects: [{ id: 'p', name: 'P', directory: '/tmp/p', memory: 'keep me', sessions: [{ id: 's', title: 'S', model: 'legacy-model', created: 1 }] }],
    models: [{ id: 'legacy-model', name: 'Legacy', tools: true, context: null }],
    selectedModel: 'legacy-model', mcps: [], cadence: 'daily',
  }
  const migrated = migrateState(state)
  assert.equal(migrated.projects[0].memory, 'keep me')
  assert.equal(migrated.projects[0].sessions[0].model, 'collectiviq/legacy-model')
  assert.equal(migrated.selectedModel, 'collectiviq/legacy-model')
  assert.equal(migrated.models[0].providerID, 'collectiviq')
  assert.equal(migrated.freeEnabled, true)
  assert.deepEqual(migrated.providers, [])
  assert.equal(migrated.updates.autoDownload, true)
})
test('provider keys are encrypted, isolated from public state, and scoped per provider', async () => {
  const root = await temporary()
  const store = await new Store(root, encryption).load()
  await store.setProviderKey('groq', 'groq-fixture', true)
  await store.setProviderKey('anthropic', 'anthropic-fixture', true)
  store.state.providers = [
    { id: 'groq', name: 'Groq', env: ['GROQ_API_KEY'] },
    { id: 'anthropic', name: 'Anthropic', env: ['ANTHROPIC_API_KEY'] },
  ]
  assert.equal(await store.getProviderKey('groq'), 'groq-fixture')
  assert.deepEqual(await store.providerEnv(), { GROQ_API_KEY: 'groq-fixture', ANTHROPIC_API_KEY: 'anthropic-fixture' })
  assert.equal(JSON.stringify(await store.publicState()).includes('fixture'), false)
  const raw = await fs.readFile(store.providerVault, 'utf8')
  assert.equal(raw.startsWith('encrypted:'), true)
  await store.clearProviderKey('groq')
  assert.equal(await store.getProviderKey('groq'), null)
  assert.deepEqual(await store.providerEnv(), { ANTHROPIC_API_KEY: 'anthropic-fixture' })
  const reloaded = await new Store(root, encryption).load()
  assert.equal(await reloaded.getProviderKey('anthropic'), 'anthropic-fixture')
})
test('public state exposes free mode and update defaults without secrets', async () => {
  const store = await new Store(await temporary(), encryption).load()
  const state = await store.publicState()
  assert.equal(state.freeProvider, FREE_PROVIDER)
  assert.equal(state.freeEnabled, true)
  assert.equal(state.connected, false)
  assert.equal(state.gateway, 'https://api.prod.collectiviq.ai/v1')
  assert.equal(state.updates.autoDownload, true)
  assert.equal(state.updates.intervalDays, undefined)
})
test('provider vault survives restart, distinguishes session keys, and preserves corrupt data', async () => {
  const root = await temporary()
  const store = await new Store(root, encryption).load()
  store.state.providers = [{ id: 'groq', name: 'Groq', env: ['GROQ_API_KEY'] }]
  await store.setProviderKey('groq', 'saved-key-fixture', true)
  await store.save()
  const restored = await new Store(root, encryption).load()
  assert.equal(await restored.getProviderKey('groq'), 'saved-key-fixture')
  assert.equal((await restored.publicState()).providers[0].credentialStatus, 'saved')
  await restored.setProviderKey('groq', 'session-key-fixture', false)
  assert.equal((await restored.publicState()).providers[0].credentialStatus, 'session')
  assert.equal(await (await new Store(root, encryption).load()).getProviderKey('groq'), null)
  await fs.writeFile(store.providerVault, 'corrupt vault bytes')
  const broken = await new Store(root, encryption).load()
  await assert.rejects(broken.setProviderKey('groq', 'replacement-fixture', true), /not been overwritten/)
  await assert.rejects(broken.setProviderKey('groq', 'replacement-fixture', true), /not been overwritten/)
  assert.equal(await fs.readFile(store.providerVault, 'utf8'), 'corrupt vault bytes')
})

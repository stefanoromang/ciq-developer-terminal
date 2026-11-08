import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { coalescedRefresh } from '../src/refresh.ts'
const require = createRequire(import.meta.url)
const { Store } = require('../electron/core.cjs')
const { Engine } = require('../electron/engine.cjs')
const { serialTask } = require('../electron/tasks.cjs')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('stream refresh bursts do not overlap and always fetch trailing changes', async () => {
  const gate = deferred()
  let calls = 0, active = 0, maximum = 0
  const refresh = coalescedRefresh(async () => {
    calls++; active++; maximum = Math.max(maximum, active)
    if (calls === 1) await gate.promise
    active--
  })
  const first = refresh()
  for (let n = 0; n < 100; n++) refresh()
  gate.resolve(); await first
  assert.equal(calls, 2); assert.equal(maximum, 1)
})

test('failed serialized tasks do not poison later writes', async () => {
  const calls = []
  const task = serialTask(async value => { calls.push(value); if (value === 1) throw new Error('fixture') })
  await Promise.all([assert.rejects(task(1), /fixture/), task(2), task(3)])
  assert.deepEqual(calls, [1, 2, 3])
})

test('locked credentials do not block free-model engine startup or public state', { timeout: 90_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-locked-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = await new Store(root, { isEncryptionAvailable: () => true, decryptString() { throw new Error('locked') } }).load()
  await fs.writeFile(store.vault, 'locked gateway')
  await fs.writeFile(store.providerVault, 'locked providers')
  store.state.providers = [{ id: 'groq', name: 'Groq', env: ['GROQ_API_KEY'] }]
  const state = await store.publicState()
  assert.equal(state.connected, false)
  assert.equal(state.providers[0].credentialStatus, 'unavailable')
  assert.match(state.credentialError, /could not be unlocked/)
  const engine = new Engine(store)
  try {
    const [one, two] = await Promise.all([engine.request('GET', '/api/info'), engine.request('GET', '/api/info')])
    assert.equal(one.pid, two.pid)
    assert.equal(engine.status, 'ready')
    assert.equal(await fs.readFile(store.vault, 'utf8'), 'locked gateway')
  } finally { await engine.stop() }
})

test('stop during startup cancels cleanly, then a new engine starts', { timeout: 90_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-race-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = await new Store(root, { isEncryptionAvailable: () => false }).load()
  const engine = new Engine(store)
  const gate = deferred(), entered = deferred()
  const original = engine.config
  engine.config = async () => { entered.resolve(); await gate.promise; return original() }
  const startup = engine.ensure()
  const rejected = assert.rejects(startup, /canceled/)
  await entered.promise
  const stopped = engine.stop()
  gate.resolve(); await Promise.all([stopped, rejected])
  assert.equal(engine.child, null)
  engine.config = original
  try {
    await engine.ensure()
    const pid = engine.child.pid
    await Promise.all([engine.stop(), engine.stop()])
    assert.throws(() => process.kill(pid, 0))
    assert.equal(engine.status, 'stopped')
  } finally { await engine.stop() }
})

test('unchanged config does not trigger repeated disk writes and reloads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-config-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = await new Store(root, { isEncryptionAvailable: () => false }).load()
  const engine = new Engine(store)
  const file = await engine.config()
  await fs.utimes(file, new Date(1000), new Date(1000))
  await Promise.all([engine.config(), engine.config(), engine.config()])
  assert.equal((await fs.stat(file)).mtimeMs, 1000)
})

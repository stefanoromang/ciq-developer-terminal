import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Store, engineConfig, atomicJSON } = require('../electron/core.cjs')
const { Engine } = require('../electron/engine.cjs')

test('real engine consumes fixture streaming chat, gates tool execution, and projects messages', { timeout: 90_000 }, async () => {
  const requests = []
  let calls = 0
  const server = http.createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    let body
    try { body = JSON.parse(text) } catch { body = {} }
    requests.push({ url: request.url, body })
    if (!request.url.includes('chat/completions')) { response.writeHead(404).end(); return }
    calls++
    const isToolTurn = body.messages?.some(m => m.role === 'tool')
    const delta = isToolTurn ? { content: 'CIQ fixture completed after permission.' } : { tool_calls: [{ index: 0, id: 'fixture_call_1', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: path.join(directory, 'fixture.txt') }) } }] }
    const finish = isToolTurn ? 'stop' : 'tool_calls'
    if (body.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const item of [
        { id: `chatcmpl-fixture-${calls}`, object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
        { id: `chatcmpl-fixture-${calls}`, object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: null }] },
        { id: `chatcmpl-fixture-${calls}`, object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: finish }] },
      ]) response.write(`data: ${JSON.stringify(item)}\n\n`)
      response.end('data: [DONE]\n\n')
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion', model: 'fixture-model', choices: [{ index: 0, message: { role: 'assistant', content: 'CIQ fixture text.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'ciq-generation-test-'))
  const directory = path.join(root, 'project')
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'fixture.txt'), 'harmless local fixture')
  const store = await new Store(path.join(root, 'user'), { isEncryptionAvailable: () => false }).load()
  await store.setKey('local-fixture-not-a-real-key', false)
  store.state.models = [{ id: 'fixture-model', name: 'Fixture model', tools: true }]
  store.state.selectedModel = 'fixture-model'
  const events = []
  const engine = new Engine(store, event => events.push(event))
  engine.config = async () => {
    const file = path.join(store.directory, 'engine', 'config', 'opencode', 'opencode.json')
    const config = engineConfig(store.state)
    config.providers.collectiviq.settings.baseURL = `http://127.0.0.1:${server.address().port}/v1`
    await atomicJSON(file, config)
    return file
  }
  const until = async (condition, label) => {
    for (let n = 0; n < 250; n++) {
      const value = await condition()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out waiting for ${label}. Events: ${events.map(e => e.type).join(', ')}`)
  }
  try {
    const created = await engine.request('POST', '/api/session', { location: { directory }, model: { providerID: 'collectiviq', id: 'fixture-model' }, permissions: [{ action: '*', resource: '*', effect: 'ask' }] })
    const id = created.data.id
    await engine.request('POST', `/api/session/${id}/prompt`, { text: 'Read the harmless fixture, then reply.', metadata: { ciqDisplayText: 'Read the fixture.' } })
    const permission = await until(async () => {
      const result = await engine.request('GET', `/api/session/${id}/permission`)
      return result.data[0]
    }, 'tool permission')
    assert.ok(permission.action)
    assert.equal(events.some(e => e.type === 'session.tool.success'), false)
    await engine.request('POST', `/api/session/${id}/permission/${permission.id}/reply`, { decision: 'once' })
    await until(() => events.find(e => e.type === 'session.execution.succeeded' && e.data.sessionID === id), 'successful generation')
    const projected = await engine.request('GET', `/api/session/${id}/message?limit=80&order=desc`)
    const user = projected.data.find(m => m.type === 'user')
    assert.equal(user.metadata.ciqDisplayText, 'Read the fixture.')
    const text = projected.data.filter(m => m.type === 'assistant').flatMap(m => m.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
    assert.match(text, /CIQ fixture completed/)
    assert.ok(requests.some(r => r.body.tools?.length))
    assert.ok(events.some(e => e.type === 'session.text.delta'))
    console.log('Fixture generation verified with permission:', permission.action, 'API calls:', requests.length)
  } finally {
    await engine.stop()
    await new Promise(resolve => server.close(resolve))
  }
})

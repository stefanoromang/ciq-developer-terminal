// Inert, local-only MCP fixture. No filesystem, network or external tools.
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.id === undefined) return
  let result
  if (request.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'ciq-local-fixture', version: '1.0.0' } }
  else if (request.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Return a harmless fixture value.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] }
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: String(request.params.arguments.value) }] }
  else if (request.method === 'resources/list') result = { resources: [] }
  else if (request.method === 'resources/templates/list') result = { resourceTemplates: [] }
  else if (request.method === 'prompts/list') result = { prompts: [] }
  else if (request.method === 'ping') result = {}
  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n'); return }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
})
lines.on('close', () => process.exit(0))

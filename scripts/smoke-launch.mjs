import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

const executable = process.argv[2]
if (!executable) throw new Error('Pass the actual packaged executable path.')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-launch-'))
const report = path.join(root, 'report.json')
const env = { ...process.env, CIQ_TEST_USER_DATA: path.join(root, 'user'), CIQ_SMOKE_REPORT: report }
delete env.ELECTRON_RUN_AS_NODE
const start = performance.now()
const child = spawn(executable, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let errors = ''
child.stdout.resume()
child.stderr.on('data', value => { errors = (errors + value).slice(-8000) })
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Packaged launch timed out: ${errors}`)) }, 90_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Packaged launch exited ${code}: ${errors}`)) })
  })
  const result = JSON.parse(await fs.readFile(report, 'utf8'))
  assert.equal(result.engine.status, 'ready')
  assert.equal(result.engine.version, '2.2.6')
  assert.equal(result.rendererSandbox, true)
  assert.ok(result.freeModels > 0)
  console.log(JSON.stringify({ ...result, packagedLaunchMs: Math.round(performance.now() - start) }, null, 2))
} finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }

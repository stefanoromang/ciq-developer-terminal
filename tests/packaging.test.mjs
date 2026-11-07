import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

test('Windows installers and portable launch stay at user privilege level', async () => {
  const { build } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(build.nsis.perMachine, false)
  assert.equal(build.nsis.allowElevation, false)
  assert.equal(build.win.requestedExecutionLevel, 'asInvoker')
  assert.equal(build.portable.requestExecutionLevel, 'user')
  assert.notEqual(build.nsis.artifactName, build.portable.artifactName)
  assert.match(build.nsis.artifactName, /setup\.exe$/)
  assert.match(build.portable.artifactName, /portable\.exe$/)
})

test('Linux download is extractable without a root package manager', async () => {
  const { build } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(build.linux.target, ['tar.gz'])
  assert.equal(build.linux.executableName, 'ciq-developer-terminal')
  const installer = await fs.readFile(new URL('../scripts/install-user.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(installer, /Exec=.*--no-sandbox/)
  const main = await fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /app\.disableSandbox\s*\(/)
  assert.doesNotMatch(main, /sandbox:\s*false/)
  assert.equal(installer.includes('sudo '), false)
})

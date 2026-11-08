import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const {
  CHECK_INTERVAL, parseVersion, compareVersions, isUpdateCheckDue, assetCandidates,
  selectRelease, checkForUpdate, checksumFor, downloadUpdate, installUpdate, macBundlePath, verifyDownloaded,
} = require('../electron/updates.cjs')

test('semantic versions compare including prereleases', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: '' })
  assert.equal(parseVersion('not-a-version'), null)
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1)
})

test('update checks are due at most twice a week and catch up on launch', () => {
  const now = 10_000_000_000
  assert.equal(isUpdateCheckDue(0, now), true)
  assert.equal(isUpdateCheckDue(now - CHECK_INTERVAL + 1, now), false)
  assert.equal(isUpdateCheckDue(now - CHECK_INTERVAL, now), true)
  assert.equal(isUpdateCheckDue(now + 1000, now), false)
  assert.ok(CHECK_INTERVAL >= 3.5 * 24 * 60 * 60 * 1000)
})

test('asset names follow the published platform conventions', () => {
  assert.deepEqual(assetCandidates('0.2.0', 'darwin', 'arm64').map(item => item.name), [
    'CIQ-Developer-Terminal-0.2.0-mac-arm64.zip',
    'CIQ-Developer-Terminal-0.2.0-arm64-mac.zip',
  ])
  assert.equal(assetCandidates('0.2.0', 'win32', 'x64')[0].name, 'CIQ-Developer-Terminal-0.2.0-windows-x64-setup.exe')
  assert.equal(assetCandidates('0.2.0', 'linux', 'x64')[0].name, 'CIQ-Developer-Terminal-0.2.0-linux-x64.tar.gz')
  assert.deepEqual(assetCandidates('0.2.0', 'freebsd', 'x64'), [])
  assert.equal(assetCandidates('0.3.0', 'win32', 'x64', true)[0].install, 'portable')
})

test('release selection ignores drafts, older tags, and releases without a matching asset', () => {
  const releases = [
    { tag_name: 'v0.1.2', draft: false, assets: [{ name: 'CIQ-Developer-Terminal-0.1.2-mac-arm64.zip', browser_download_url: 'https://example/old.zip' }] },
    { tag_name: 'v0.3.0', draft: true, assets: [{ name: 'CIQ-Developer-Terminal-0.3.0-mac-arm64.zip', browser_download_url: 'https://example/draft.zip' }] },
    { tag_name: 'v0.2.1', draft: false, body: 'Notes', html_url: 'https://example/release', assets: [] },
    { tag_name: 'v0.2.0', draft: false, body: 'New', published_at: '2026-01-01', html_url: 'https://example/v020', assets: [
      { name: 'CIQ-Developer-Terminal-0.2.0-mac-arm64.zip', browser_download_url: 'https://example/app.zip', size: 42 },
      { name: 'SHA256SUMS.txt', browser_download_url: 'https://example/SHA256SUMS.txt' },
    ] },
  ]
  const update = selectRelease(releases, { currentVersion: '0.1.2', platform: 'darwin', arch: 'arm64' })
  assert.equal(update.version, '0.2.0')
  assert.equal(update.install, 'zip')
  assert.equal(update.asset.url, 'https://example/app.zip')
  assert.equal(update.checksums.name, 'SHA256SUMS.txt')
  assert.equal(update.notes, 'New')
  assert.equal(selectRelease(releases, { currentVersion: '0.2.0', platform: 'darwin', arch: 'arm64' }), null)
})

test('release selection picks the checksum file for the target platform', () => {
  const releases = [{
    tag_name: 'v0.3.0', draft: false, assets: [
      { name: 'CIQ-Developer-Terminal-0.3.0-mac-arm64.zip', browser_download_url: 'https://example/mac.zip' },
      { name: 'SHA256SUMS-linux-x64.txt', browser_download_url: 'https://example/linux.txt' },
      { name: 'SHA256SUMS-darwin-arm64.txt', browser_download_url: 'https://example/mac.txt' },
      { name: 'SHA256SUMS-win32-x64.txt', browser_download_url: 'https://example/win.txt' },
    ],
  }]
  const update = selectRelease(releases, { currentVersion: '0.2.0', platform: 'darwin', arch: 'arm64' })
  assert.equal(update.checksums.name, 'SHA256SUMS-darwin-arm64.txt')
  const combined = [{ tag_name: 'v0.3.0', draft: false, assets: [
    { name: 'CIQ-Developer-Terminal-0.3.0-mac-arm64.zip', browser_download_url: 'https://example/mac.zip' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example/all.txt' },
  ] }]
  assert.equal(selectRelease(combined, { currentVersion: '0.2.0', platform: 'darwin', arch: 'arm64' }).checksums.name, 'SHA256SUMS.txt')
})
test('checksum parsing only accepts exact asset matches', () => {
  const text = `${'a'.repeat(64)}  CIQ-Developer-Terminal-0.2.0-mac-arm64.zip\n${'b'.repeat(64)} *CIQ-Developer-Terminal-0.2.0-windows-x64-setup.exe\n`
  assert.equal(checksumFor(text, 'CIQ-Developer-Terminal-0.2.0-mac-arm64.zip'), 'a'.repeat(64))
  assert.equal(checksumFor(text, 'CIQ-Developer-Terminal-0.2.0-windows-x64-setup.exe'), 'b'.repeat(64))
  assert.equal(checksumFor(text, 'other.zip'), null)
})

test('update downloads verify SHA-256 and delete mismatches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-update-test-'))
  const body = Buffer.from('fixture update payload')
  const digest = createHash('sha256').update(body).digest('hex')
  const update = {
    asset: { name: 'app.zip', url: 'https://example/app.zip', size: body.length },
    checksums: { name: 'SHA256SUMS.txt', url: 'https://example/SHA256SUMS.txt' },
  }
  const fetchImpl = async url => {
    if (String(url).includes('SHA256SUMS')) return { ok: true, text: async () => `${digest}  app.zip\n` }
    return { ok: true, headers: new Map([['content-length', String(body.length)]]), body: new Response(body).body }
  }
  const progress = []
  const result = await downloadUpdate(update, path.join(root, 'app.zip'), { fetchImpl, onProgress: event => progress.push(event.received) })
  assert.equal(result.sha256, digest)
  assert.equal((await fs.readFile(result.file)).toString(), 'fixture update payload')
  assert.equal(progress.at(-1), body.length)
  await verifyDownloaded(result.file, digest)
  await fs.appendFile(result.file, 'changed')
  await assert.rejects(verifyDownloaded(result.file, digest), /changed after download/)

  const bad = { ...update, checksums: { ...update.checksums } }
  const badFetch = async url => String(url).includes('SHA256SUMS')
    ? { ok: true, text: async () => `${'c'.repeat(64)}  app.zip\n` }
    : { ok: true, headers: new Map([['content-length', String(body.length)]]), body: new Response(body).body }
  await assert.rejects(downloadUpdate(bad, path.join(root, 'bad.zip'), { fetchImpl: badFetch }), /checksum/)
  await assert.rejects(fs.stat(path.join(root, 'bad.zip')), { code: 'ENOENT' })
})

test('GitHub checksum redirects are followed before validating the payload', async t => {
  const { createServer } = await import('node:http')
  const body = 'fixture redirect download'
  const digest = createHash('sha256').update(body).digest('hex')
  const server = createServer((req, res) => {
    if (req.url === '/checksums') res.writeHead(302, { Location: '/asset-checksums' }).end()
    else res.end(req.url === '/asset-checksums' ? `${digest}  app.zip\n` : body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-redirect-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const base = `http://127.0.0.1:${server.address().port}`
  const result = await downloadUpdate({ asset: { name: 'app.zip', url: `${base}/app.zip` }, checksums: { url: `${base}/checksums` } }, path.join(root, 'app.zip'))
  assert.equal(result.sha256, digest)
})

test('directory updater stages a complete replacement and preserves the previous app', { skip: process.platform === 'win32' }, async t => {
  const { execFile: exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFile = promisify(exec)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ciq-replace-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const target = path.join(root, 'installed'), source = path.join(root, 'new')
  await fs.mkdir(target); await fs.mkdir(source)
  await fs.writeFile(path.join(target, 'app'), 'old')
  await fs.writeFile(path.join(source, 'app'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  await fs.writeFile(path.join(source, 'version'), 'new')
  const archive = path.join(root, 'update.tar.gz')
  await execFile('/usr/bin/tar', ['-czf', archive, '-C', source, '.'])
  let helper
  await installUpdate({ platform: 'linux', file: archive, update: { install: 'tarball' }, targetPath: target, execPath: path.join(target, 'app'), pid: 99999999, tempRoot: root,
    spawnImpl: (file, args, options) => { helper = { file, args, options }; return { unref() {} } } })
  assert.equal(await fs.readFile(path.join(target, 'app'), 'utf8'), 'old')
  await execFile(helper.file, helper.args, { env: helper.options.env })
  assert.equal(await fs.readFile(path.join(target, 'version'), 'utf8'), 'new')
  assert.equal(await fs.readFile(path.join(helper.options.env.BACKUP, 'app'), 'utf8'), 'old')
})

test('update downloads require a checksum file', async () => {
  await assert.rejects(downloadUpdate({ asset: { name: 'x', url: 'https://example/x' } }, path.join(os.tmpdir(), 'ciq-no-checksum')), /checksum file/)
})

test('macOS bundle path is derived from the executable inside the bundle', () => {
  assert.equal(macBundlePath('/Applications/CIQ Developer Terminal.app/Contents/MacOS/CIQ Developer Terminal'), '/Applications/CIQ Developer Terminal.app')
  assert.equal(macBundlePath('C:\\Apps\\CIQ Developer Terminal.app\\Contents\\MacOS\\CIQ Developer Terminal.exe'), 'C:\\Apps\\CIQ Developer Terminal.app')
  assert.throws(() => macBundlePath('/usr/local/bin/ciq'), /not inside a macOS application bundle/)
})

test('install helpers launch detached and never request elevation', async () => {
  const calls = []
  const spawnImpl = (file, args, options) => { calls.push({ file, args, options }); return { unref() {} } }
  const result = await installUpdate({
    platform: 'win32', file: 'C:\\Temp\\setup.exe', update: { install: 'nsis' },
    targetPath: 'C:\\Users\\me\\AppData\\Local\\CIQ', pid: 4321, spawnImpl,
  })
  assert.equal(result.mode, 'installer')
  assert.deepEqual(calls[0].args, ['/S', '/currentuser', '/D=C:\\Users\\me\\AppData\\Local\\CIQ'])
  assert.equal(calls[0].options.detached, true)
  assert.equal(calls[0].options.windowsHide, true)
})
test('installer spawn failures are returned before the app quits', async () => {
  const { EventEmitter } = await import('node:events')
  await assert.rejects(installUpdate({ platform: 'win32', file: 'missing.exe', update: { install: 'nsis' }, pid: 1234,
    spawnImpl: () => { const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('error', new Error('installer not found'))); return child } }), /installer not found/)
})

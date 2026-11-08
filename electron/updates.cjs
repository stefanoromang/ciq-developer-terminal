const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const REPOSITORY = 'stefanoromang/ciq-developer-terminal'
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`
const USER_AGENT = 'CIQ-Developer-Terminal'
const CHECK_INTERVAL = 3.5 * 24 * 60 * 60 * 1000 // twice a week

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value || '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] || '' }
}

function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b)
  if (!left || !right) return 0
  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) return left[part] > right[part] ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  const leftParts = left.pre.split('.'), rightParts = right.pre.split('.')
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const one = leftParts[index], two = rightParts[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    if (one === two) continue
    const oneNumber = /^\d+$/.test(one), twoNumber = /^\d+$/.test(two)
    if (oneNumber && twoNumber) return Number(one) > Number(two) ? 1 : -1
    if (oneNumber) return -1
    if (twoNumber) return 1
    return one > two ? 1 : -1
  }
  return 0
}

function isUpdateCheckDue(last, now = Date.now(), interval = CHECK_INTERVAL) {
  if (!Number.isFinite(last) || last <= 0) return true
  if (last > now) return false
  return now - last >= interval
}

function assetCandidates(version, platform, arch, portable = false) {
  if (platform === 'win32') {
    if (portable) return [{ name: `CIQ-Developer-Terminal-${version}-windows-${arch}-portable.exe`, install: 'portable' }]
    return [
      { name: `CIQ-Developer-Terminal-${version}-windows-${arch}-setup.exe`, install: 'nsis' },
      { name: `CIQ-Developer-Terminal-${version}-windows-${arch}-portable.exe`, install: 'portable' },
    ]
  }
  if (platform === 'darwin') {
    return [
      { name: `CIQ-Developer-Terminal-${version}-mac-${arch}.zip`, install: 'zip' },
      { name: `CIQ-Developer-Terminal-${version}-${arch}-mac.zip`, install: 'zip' },
    ]
  }
  if (platform === 'linux') {
    return [{ name: `CIQ-Developer-Terminal-${version}-linux-${arch}.tar.gz`, install: 'tarball' }]
  }
  return []
}

function selectRelease(releases, { currentVersion, platform = process.platform, arch = process.arch, portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE) }) {
  if (!Array.isArray(releases)) throw new Error('The update service returned an invalid response.')
  const candidates = releases
    .filter(release => release && !release.draft && typeof release.tag_name === 'string' && Array.isArray(release.assets))
    .map(release => ({ release, version: String(release.tag_name).replace(/^v/, ''), order: parseVersion(release.tag_name) }))
    .filter(entry => entry.order && compareVersions(entry.version, currentVersion) > 0)
    .sort((a, b) => compareVersions(b.version, a.version))
  for (const entry of candidates) {
    for (const candidate of assetCandidates(entry.version, platform, arch, portable)) {
      const asset = entry.release.assets.find(item => item && item.name === candidate.name && item.state !== 'new')
      if (!asset || typeof asset.browser_download_url !== 'string') continue
      // A release can carry one checksum file per platform. Prefer the file for
      // this platform/architecture; fall back to a combined file, then any.
      const checksumAssets = entry.release.assets.filter(item =>
        item && /^SHA256SUMS/i.test(item.name) && typeof item.browser_download_url === 'string')
      const platformToken = platform.toLowerCase()
      const checksums = checksumAssets.find(item => item.name.toLowerCase().includes(platformToken) && item.name.includes(arch))
        || checksumAssets.find(item => item.name.toLowerCase().includes(platformToken))
        || checksumAssets[0] || null
      return {
        version: entry.version,
        tag: entry.release.tag_name,
        notes: typeof entry.release.body === 'string' ? entry.release.body.slice(0, 12_000) : '',
        publishedAt: entry.release.published_at || '',
        page: entry.release.html_url || '',
        install: candidate.install,
        asset: { name: asset.name, url: asset.browser_download_url, size: Number(asset.size) || 0 },
        checksums: checksums ? { name: checksums.name, url: checksums.browser_download_url } : null,
      }
    }
  }
  return null
}

async function checkForUpdate({ fetchImpl = fetch, currentVersion, platform = process.platform, arch = process.arch, portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE), apiURL = RELEASES_API } = {}) {
  const response = await fetchImpl(apiURL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${USER_AGENT}/${currentVersion || '0'}` },
    signal: AbortSignal.timeout(20_000), redirect: 'error',
  })
  if (!response.ok) {
    if ([403, 429].includes(response.status)) throw new Error('The update check was rate-limited by GitHub. CIQ will try again later.')
    throw new Error(`Could not check for updates (HTTP ${response.status}). CIQ will try again later.`)
  }
  return selectRelease(await response.json(), { currentVersion, platform, arch, portable })
}

function checksumFor(text, name) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (match && path.basename(match[2]) === name) return match[1].toLowerCase()
  }
  return null
}

async function downloadUpdate(update, destination, { fetchImpl = fetch, onProgress = () => {} } = {}) {
  if (!update?.asset?.url) throw new Error('This update has no downloadable file for this platform.')
  if (!update.checksums?.url) throw new Error('This release has no checksum file. The update was not installed.')
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  const response = await fetchImpl(update.asset.url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30 * 60_000),
  })
  if (!response.ok || !response.body) throw new Error(`The update download failed (HTTP ${response.status}).`)
  const total = Number(response.headers.get('content-length')) || update.asset.size || 0
  const hash = createHash('sha256')
  let received = 0
  const output = createWriteStream(destination, { mode: 0o600 })
  try {
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      hash.update(chunk); received += chunk.length
      onProgress({ received, total }); callback(null, chunk)
    } })
    await pipeline(Readable.fromWeb(response.body), meter, output)
  } catch (error) {
    await fs.unlink(destination).catch(() => {})
    throw error
  }
  if (total > 0 && received !== total) {
    await fs.unlink(destination).catch(() => {})
    throw new Error('The update download was incomplete. Try again.')
  }
  const sha256 = hash.digest('hex')
  let sums
  try { sums = await fetchImpl(update.checksums.url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000), redirect: 'follow',
  }) } catch (error) { await fs.unlink(destination).catch(() => {}); throw error }
  if (!sums.ok) {
    await fs.unlink(destination).catch(() => {})
    throw new Error('The checksum file could not be downloaded. The update was not installed.')
  }
  const expected = checksumFor(await sums.text(), update.asset.name)
  if (!expected) {
    await fs.unlink(destination).catch(() => {})
    throw new Error('The release checksum does not list this download. The update was not installed.')
  }
  if (expected !== sha256) {
    await fs.unlink(destination).catch(() => {})
    throw new Error('The downloaded update failed its checksum. The file was deleted.')
  }
  return { file: destination, sha256, size: received }
}

async function verifyDownloaded(file, expected) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (!expected || hash.digest('hex') !== expected) throw new Error('The update file changed after download. Download it again before installing.')
}

function macBundlePath(execPath = process.execPath) {
  const match = /[\\/]Contents[\\/]MacOS[\\/]/.exec(execPath)
  if (!match) throw new Error('This copy of CIQ is not inside a macOS application bundle.')
  return execPath.slice(0, match.index)
}

async function installUpdate({
  platform = process.platform, file, update, targetPath, execPath = process.execPath,
  pid = process.pid, tempRoot = os.tmpdir(), spawnImpl = spawn, portable = process.env.PORTABLE_EXECUTABLE_FILE,
}) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid application process for the update helper.')
  if (platform === 'win32') {
    if (update.install === 'nsis') {
      const directory = targetPath || path.dirname(execPath)
      spawnImpl(file, ['/S', '/currentuser', `/D=${directory}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      return { mode: 'installer' }
    }
    const target = portable || execPath
    const work = await fs.mkdtemp(path.join(tempRoot, 'ciq-update-'))
    const script = path.join(work, 'install.cmd')
    await fs.writeFile(script, [
      '@echo off',
      ':wait',
      `tasklist /FI "PID eq ${pid}" 2>NUL | find "${pid}" >NUL`,
      'if not errorlevel 1 (',
      '  timeout /t 1 /nobreak >NUL',
      '  goto wait',
      ')',
      'copy /Y "%SOURCE%" "%TARGET%.new" >NUL || exit /b 1',
      'move /Y "%TARGET%" "%TARGET%.previous" >NUL || exit /b 1',
      'move /Y "%TARGET%.new" "%TARGET%" >NUL || (move /Y "%TARGET%.previous" "%TARGET%" >NUL & exit /b 1)',
      'start "" "%TARGET%"',
      '',
    ].join('\r\n'))
    spawnImpl('cmd.exe', ['/c', script], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, SOURCE: file, TARGET: target },
    }).unref()
    return { mode: 'portable-replace' }
  }
  if (platform === 'darwin') {
    const target = targetPath || macBundlePath(execPath)
    const work = await fs.mkdtemp(path.join(tempRoot, 'ciq-update-'))
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', file, work])
    const apps = (await fs.readdir(work)).filter(name => name.endsWith('.app'))
    if (apps.length !== 1) throw new Error('The update archive did not contain exactly one application.')
    const source = path.join(work, apps[0])
    await fs.access(path.join(source, 'Contents', 'Info.plist'))
    await fs.access(path.dirname(target), require('node:fs').constants.W_OK)
    const stage = await fs.mkdtemp(path.join(path.dirname(target), '.ciq-update-'))
    const staged = path.join(stage, path.basename(target))
    await execFileAsync('/usr/bin/ditto', [source, staged])
    const script = path.join(work, 'install.sh')
    await fs.writeFile(script, [
      '#!/bin/sh',
      `while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done`,
      'set -eu',
      'mv "$TARGET" "$BACKUP"',
      'if ! mv "$SOURCE" "$TARGET"; then mv "$BACKUP" "$TARGET"; exit 1; fi',
      '/usr/bin/open "$TARGET"',
      '',
    ].join('\n'), { mode: 0o700 })
    spawnImpl('/bin/sh', [script], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, TARGET: target, SOURCE: staged, BACKUP: path.join(stage, 'previous.app') },
    }).unref()
    return { mode: 'bundle-replace', target }
  }
  if (platform === 'linux') {
    const target = targetPath || path.dirname(execPath)
    const work = await fs.mkdtemp(path.join(tempRoot, 'ciq-update-'))
    await execFileAsync('/usr/bin/tar', ['-xzf', file, '-C', work])
    const entries = await fs.readdir(work)
    const source = entries.length === 1 && (await fs.stat(path.join(work, entries[0]))).isDirectory()
      ? path.join(work, entries[0])
      : work
    const launch = path.join(target, path.basename(execPath))
    await fs.access(path.join(source, path.basename(execPath)))
    await fs.access(path.dirname(target), require('node:fs').constants.W_OK)
    const stage = await fs.mkdtemp(path.join(path.dirname(target), '.ciq-update-'))
    const staged = path.join(stage, 'application')
    await fs.cp(source, staged, { recursive: true, verbatimSymlinks: true })
    const script = path.join(work, 'install.sh')
    await fs.writeFile(script, [
      '#!/bin/sh',
      `while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done`,
      'set -eu',
      'mv "$TARGET" "$BACKUP"',
      'if ! mv "$SOURCE" "$TARGET"; then mv "$BACKUP" "$TARGET"; exit 1; fi',
      'chmod +x "$LAUNCH"',
      '"$LAUNCH" >/dev/null 2>&1 &',
      '',
    ].join('\n'), { mode: 0o700 })
    spawnImpl('/bin/sh', [script], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, TARGET: target, SOURCE: staged, BACKUP: path.join(stage, 'previous'), LAUNCH: launch },
    }).unref()
    return { mode: 'directory-replace', target }
  }
  throw new Error(`Automatic updates are not supported on ${platform}.`)
}

module.exports = {
  REPOSITORY, CHECK_INTERVAL, parseVersion, compareVersions, isUpdateCheckDue,
  assetCandidates, selectRelease, checkForUpdate, checksumFor, downloadUpdate,
  installUpdate, macBundlePath, verifyDownloaded,
}

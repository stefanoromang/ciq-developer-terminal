const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { engineConfig, atomicJSON } = require('./core.cjs')
const { serialTask } = require('./tasks.cjs')

class Engine {
  constructor(store, onEvent = () => {}, { spawnImpl = spawn, startupTimeout = 45_000 } = {}) {
    this.store = store
    this.onEvent = onEvent
    this.child = null
    this.url = null
    this.starting = null
    this.stopping = false
    this.eventAbort = null
    this.reconnectTimer = null
    this.stopTask = null
    this.epoch = 0
    this.spawn = spawnImpl
    this.startupTimeout = startupTimeout
    this.config = serialTask(this.writeConfig.bind(this))
    this.lastConfig = ''
    this.status = 'stopped'
  }
  binary() {
    // electron-builder excludes npm's installed bin shim. Resolve the actual
    // platform package so the installed app is self-contained on a clean host.
    const platform = process.platform === 'win32' ? 'windows' : process.platform
    const candidates = process.arch === 'x64' ? [`@opencode/cli-${platform}-x64-baseline`, `@opencode/cli-${platform}-x64`] : [`@opencode/cli-${platform}-${process.arch}`]
    for (const name of candidates) {
      try {
        const manifest = require.resolve(`${name}/package.json`)
        return path.join(path.dirname(manifest), 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
      } catch { /* try the installed alternative */ }
    }
    throw new Error(`The bundled coding engine is missing for ${process.platform}/${process.arch}. Rebuild on the target platform.`)
  }
  async writeConfig() {
    const file = path.join(this.store.directory, 'engine', 'config', 'opencode', 'opencode.json')
    const config = engineConfig(this.store.state)
    const serialized = JSON.stringify(config)
    if (serialized !== this.lastConfig) {
      await atomicJSON(file, config)
      this.lastConfig = serialized
    }
    return file
  }
  async ensure() {
    if (this.stopTask) await this.stopTask
    if (this.starting) return this.starting
    if (this.url) return this.url
    this.starting = this.start(this.epoch).finally(() => { this.starting = null })
    return this.starting
  }
  async start(epoch) {
    this.status = 'starting'
    await this.config()
    this.stopping = false
    const root = path.join(this.store.directory, 'engine')
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENCODE_') && !/^(ELECTRON_|CIQ_)/.test(key)))
    for (const name of ['CONFIG', 'DATA', 'CACHE', 'STATE']) {
      env[`XDG_${name}_HOME`] = path.join(root, name.toLowerCase())
      await fs.mkdir(env[`XDG_${name}_HOME`], { recursive: true, mode: 0o700 })
    }
    const key = await this.store.getKey().catch(() => null)
    if (key) env.CIQ_GATEWAY_KEY = key
    // Third-party provider keys stay in CIQ's encrypted vault and are handed to
    // the isolated engine only for this process. The engine never persists them.
    Object.assign(env, await this.store.providerEnv())
    if (epoch !== this.epoch) throw new Error('Coding engine startup was canceled.')
    // Local API credentials are random per app launch and never exposed to the renderer.
    this.password = randomBytes(32).toString('hex')
    env.OPENCODE_SERVER_PASSWORD = this.password
    const child = this.spawn(this.binary(), ['serve', '--hostname', '127.0.0.1', '--port', '0', '--stdio'], {
      cwd: this.store.directory, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    // Keep stderr drained but never persist provider errors, prompts or secrets in a log.
    child.stderr.on('data', () => {})
    child.stdin.on('error', () => {}) // a process exiting during shutdown may close stdin first
    try {
    const url = await new Promise((resolve, reject) => {
      let buffer = ''
      let announced = false
      const timer = setTimeout(() => { child.kill(); reject(new Error('The coding engine did not start in time. Try Restart engine in Settings.')) }, this.startupTimeout)
      const fail = error => { clearTimeout(timer); reject(error) }
      child.once('error', () => fail(new Error('The bundled coding engine could not be launched on this system.')))
      child.once('exit', code => {
        if (!announced) fail(new Error(`The coding engine exited during startup (${code}).`))
        if (this.child === child) {
          this.url = null; this.child = null; this.status = 'stopped'
          this.eventAbort?.abort(); clearTimeout(this.reconnectTimer)
          if (!this.stopping) this.onEvent({ type: 'ciq.engine.error', data: { message: 'The coding engine stopped. Your saved conversations are intact. Try again or restart the engine in Settings.' } })
        }
      })
      child.stdout.on('data', data => {
        if (announced) return
        buffer += data.toString()
        if (buffer.length > 1024 * 1024) { child.kill(); fail(new Error('The coding engine returned invalid startup output.')); return }
        let newline
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          try {
            const info = JSON.parse(line)
            const endpoint = new URL(info.url)
            if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') continue
            announced = true; clearTimeout(timer); resolve(endpoint.origin)
          } catch { /* stdio readiness is the only stdout frame consumed */ }
        }
      })
    })
    if (epoch !== this.epoch) throw new Error('Coding engine startup was canceled.')
    this.url = url
    // Verify readiness and authentication, not just process spawn.
    await this.send('GET', '/api/info')
    if (epoch !== this.epoch) throw new Error('Coding engine startup was canceled.')
    this.status = 'ready'
    this.subscribe()
    return this.url
    } catch (error) {
      if (this.child === child) { this.url = null; this.status = 'stopped' }
      if (child.exitCode === null && child.signalCode === null) child.kill()
      throw error
    }
  }
  async request(method, route, body, directory, timeout = 30_000) {
    await this.ensure()
    return this.send(method, route, body, directory, timeout)
  }
  async send(method, route, body, directory, timeout = 30_000) {
    const url = new URL(route, this.url)
    if (directory) url.searchParams.set('location[directory]', directory)
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout), redirect: 'error',
    })
    if (response.status === 204) return null
    let data
    try { data = await response.json() } catch { throw new Error(`The engine returned an invalid response (HTTP ${response.status}).`) }
    if (!response.ok) {
      let message = data.message || data.error?.message || `Engine request failed (HTTP ${response.status}).`
      for (const key of [this.store.key, ...Object.values(this.store.providerKeys), ...Object.values(this.store.savedProviderKeys)]) {
        if (key) message = String(message).replaceAll(key, '[redacted]')
      }
      if (/free usage limit|FreeUsageLimitError/i.test(String(message))) {
        message = 'OpenCode’s free-model limit was reached. Try again later or connect another provider in Model library.'
      }
      throw new Error(String(message).slice(0, 700))
    }
    return data
  }
  subscribe() {
    clearTimeout(this.reconnectTimer)
    this.eventAbort?.abort()
    this.eventAbort = new AbortController()
    const signal = this.eventAbort.signal
    const stream = async () => {
      try {
        const response = await fetch(new URL('/api/event', this.url), {
          headers: { Authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}` }, signal,
        })
        if (!response.ok) throw new Error('Event stream unavailable')
        let buffer = ''
        const decoder = new TextDecoder()
        for await (const bytes of response.body) {
          buffer = (buffer + decoder.decode(bytes, { stream: true })).replace(/\r\n/g, '\n')
          if (buffer.length > 8 * 1024 * 1024) throw new Error('Event frame too large')
          let boundary
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
            const payload = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
            if (!payload) continue
            try { this.onEvent(JSON.parse(payload)) } catch { /* keep malformed frames out of the UI */ }
          }
        }
      } catch { /* reconnect below; projected session data is reloaded on connection */ }
      if (!signal.aborted && !this.stopping && this.url) {
        this.onEvent({ type: 'ciq.events.reconnecting', data: {} })
        this.reconnectTimer = setTimeout(() => this.subscribe(), 1500)
      }
    }
    void stream()
  }
  stop() {
    if (this.stopTask) return this.stopTask
    this.epoch++
    this.stopping = true
    this.status = 'stopping'
    clearTimeout(this.reconnectTimer)
    this.eventAbort?.abort()
    const child = this.child
    this.url = null
    const starting = this.starting
    this.stopTask = (async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise(resolve => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 5000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
          child.stdin.end(); child.kill('SIGTERM')
        })
      }
      await starting?.catch(() => {})
      if (this.child === child) this.child = null
    })().finally(() => { this.status = 'stopped'; this.stopTask = null })
    return this.stopTask
  }
}

module.exports = { Engine }

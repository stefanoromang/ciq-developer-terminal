const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { engineConfig, atomicJSON } = require('./core.cjs')

class Engine {
  constructor(store, onEvent = () => {}) {
    this.store = store
    this.onEvent = onEvent
    this.child = null
    this.url = null
    this.starting = null
    this.stopping = false
    this.eventAbort = null
    this.reconnectTimer = null
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
  async config() {
    const file = path.join(this.store.directory, 'engine', 'config', 'opencode', 'opencode.json')
    await atomicJSON(file, engineConfig(this.store.state))
    return file
  }
  async ensure() {
    if (this.url) return this.url
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => { this.starting = null })
    return this.starting
  }
  async start() {
    await this.config()
    this.stopping = false
    const root = path.join(this.store.directory, 'engine')
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENCODE_') && !/^(ELECTRON_|CIQ_)/.test(key)))
    for (const name of ['CONFIG', 'DATA', 'CACHE', 'STATE']) {
      env[`XDG_${name}_HOME`] = path.join(root, name.toLowerCase())
      await fs.mkdir(env[`XDG_${name}_HOME`], { recursive: true, mode: 0o700 })
    }
    const key = await this.store.getKey()
    if (key) env.CIQ_GATEWAY_KEY = key
    // Third-party provider keys stay in CIQ's encrypted vault and are handed to
    // the isolated engine only for this process. The engine never persists them.
    Object.assign(env, await this.store.providerEnv())
    // Local API credentials are random per app launch and never exposed to the renderer.
    this.password = randomBytes(32).toString('hex')
    env.OPENCODE_SERVER_PASSWORD = this.password
    const child = spawn(this.binary(), ['serve', '--hostname', '127.0.0.1', '--port', '0', '--stdio'], {
      cwd: this.store.directory, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    // Keep stderr drained but never persist provider errors, prompts or secrets in a log.
    child.stderr.on('data', () => {})
    const url = await new Promise((resolve, reject) => {
      let buffer = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error('The coding engine did not start within 45 seconds.')) }, 45_000)
      const fail = error => { clearTimeout(timer); reject(error) }
      child.once('error', () => fail(new Error('The bundled coding engine could not be launched on this system.')))
      child.once('exit', code => {
        if (!this.url) fail(new Error(`The coding engine exited during startup (${code}).`))
        this.url = null
        if (!this.stopping) this.onEvent({ type: 'ciq.engine.error', data: { message: 'The coding engine stopped. Try the action again to reconnect.' } })
      })
      child.stdout.on('data', data => {
        buffer += data.toString()
        let newline
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          try {
            const info = JSON.parse(line)
            const endpoint = new URL(info.url)
            if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') continue
            clearTimeout(timer); resolve(endpoint.origin)
          } catch { /* stdio readiness is the only stdout frame consumed */ }
        }
      })
    })
    this.url = url
    // Verify readiness and authentication, not just process spawn.
    await this.request('GET', '/api/info')
    this.subscribe()
    return this.url
  }
  async request(method, route, body, directory, timeout = 30_000) {
    await this.ensure()
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
          buffer += decoder.decode(bytes, { stream: true }).replace(/\r\n/g, '\n')
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
  async stop() {
    this.stopping = true
    clearTimeout(this.reconnectTimer)
    this.eventAbort?.abort()
    const child = this.child
    this.child = null
    this.url = null
    if (!child || child.exitCode !== null) return
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 5000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      // Closing stdio is the engine's documented desktop-owned lifetime boundary.
      child.stdin.end()
      child.kill('SIGTERM')
    })
  }
}

module.exports = { Engine }

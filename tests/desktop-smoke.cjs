const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
let window
app.whenReady().then(async () => {
  await fs.mkdir(path.join(__dirname, '..', 'test-results'), { recursive: true })
  window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const errors = []
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await window.webContents.executeJavaScript('document.fonts.ready')
  const waitFor = async expression => {
    for (let n = 0; n < 80; n++) {
      if (await window.webContents.executeJavaScript(expression)) return
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  await waitFor('Boolean(document.querySelector("h1"))')
  const screenshots = []
  for (const [width, height] of [[1440, 960], [1024, 800], [768, 1024], [390, 844]]) {
    window.setContentSize(width, height)
    await new Promise(resolve => setTimeout(resolve, 80))
    if (width < 900) await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Collapse sidebar"]')?.click()`)
    await new Promise(resolve => setTimeout(resolve, 80))
    const layout = await window.webContents.executeJavaScript(`(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, heading: document.querySelector('h1').innerText, fonts: document.fonts.check('12px Inter'), hasNode: typeof require !== 'undefined' }))()`)
    assert.equal(layout.scrollWidth, layout.width)
    assert.equal(layout.hasNode, false)
    assert.equal(layout.fonts, true)
    const target = path.join(__dirname, '..', 'test-results', `workspace-${width}.png`)
    await fs.writeFile(target, (await window.webContents.capturePage()).toPNG())
    screenshots.push(target)
  }
  window.setContentSize(1440, 960)
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Open sidebar"]')?.click()`)
  for (const [label, heading] of [['MCP connections', 'MCP connections'], ['Project memory', 'Project memory'], ['Model library', 'Model library'], ['Settings', 'Settings']]) {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.main-nav>button,.settings-link')).find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`)
    await waitFor(`document.querySelector('h1')?.textContent === ${JSON.stringify(heading)}`)
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await fs.writeFile(path.join(__dirname, '..', 'test-results', `${label.toLowerCase().replaceAll(' ', '-')}.png`), (await window.webContents.capturePage()).toPNG())
  }
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Connect key').click()`)
  await waitFor('Boolean(document.querySelector("dialog[open]"))')
  await fs.writeFile(path.join(__dirname, '..', 'test-results', 'onboarding-free.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent.includes('CollectivIQ Developer key'))?.click()`)
  await waitFor('Boolean(document.querySelector("dialog input[type=\\"password\\"]"))')
  const modal = await window.webContents.executeJavaScript(`({label: document.querySelector('dialog').getAttribute('aria-labelledby'), focusedInside: document.querySelector('dialog').contains(document.activeElement), title: document.querySelector('dialog h2').textContent, password: Boolean(document.querySelector('dialog input[type="password"]'))})`)
  assert.equal(modal.focusedInside, true)
  assert.equal(modal.password, true)
  await fs.writeFile(path.join(__dirname, '..', 'test-results', 'onboarding.png'), (await window.webContents.capturePage()).toPNG())
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ success: true, screenshots, modal, consoleErrors: errors }, null, 2))
  app.quit()
}).catch(error => { console.error(error); process.exitCode = 1; app.exit(1) })

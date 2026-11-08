const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
if (process.platform === 'linux') app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: true, width: 1100, height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'fixtures', 'history-preload.cjs') } })
  const errors = []
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  const document = path.join(process.env.CIQ_PACKAGE_APP_ROOT || path.join(__dirname, '..'), 'dist', 'index.html')
  for (const pass of ['open', 'reopen']) {
    await window.loadFile(document)
    let result
    for (let n = 0; n < 150; n++) {
      result = await window.webContents.executeJavaScript(`({ crashed: Boolean(document.querySelector('.recovery-screen')), messages: document.querySelectorAll('.message').length, text: document.body.textContent })`)
      if (result.crashed || result.messages === 2) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(result.crashed, false, `Saved history must render on ${pass}: ${errors.join('\n')}`)
    assert.equal(result.messages, 2)
    assert.match(result.text, /Fixture file could not be read/)
    assert.match(result.text, /Legacy tool error/)
    assert.match(result.text, /Provider fixture error/)
    assert.match(result.text, /Your previous conversation is available/)
    assert.doesNotMatch(result.text, /DO-NOT-RENDER-RESPONSE|\[object Object\]/)
  }
  assert.deepEqual(errors, [])
  console.log('Saved conversation opens and reopens with structured and legacy tool errors; no renderer crash.')
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })

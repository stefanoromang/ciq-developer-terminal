const { contextBridge, ipcRenderer } = require('electron')

const commands = new Set([
  'state', 'project.open', 'project.select', 'project.close', 'memory.save',
  'project.discover', 'project.import', 'project.importFolders',
  'free.enable', 'key.connect', 'key.disconnect', 'models.refresh', 'settings.save',
  'provider.list', 'provider.connect', 'provider.disconnect',
  'updates.check', 'updates.download', 'updates.install', 'updates.skip', 'updates.settings',
  'session.create', 'session.select', 'session.messages', 'session.prompt',
  'session.interrupt', 'session.model', 'session.rename', 'session.archive',
  'mcp.list', 'mcp.add', 'mcp.toggle', 'mcp.remove', 'mcp.auth', 'mcp.authStatus', 'mcp.authComplete',
  'permission.list', 'permission.reply', 'form.list', 'form.reply', 'form.cancel',
  'external.open', 'engine.info',
  'engine.restart', 'diagnostics',
  'shell.run', 'shell.output', 'shell.stop', 'session.agent',
])
contextBridge.exposeInMainWorld('ciq', {
  invoke(command, payload = {}) {
    if (!commands.has(command)) return Promise.reject(new Error('Unsupported action'))
    return ipcRenderer.invoke('ciq:action', command, payload)
  },
  onEvent(callback) {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ciq:event', listener)
    return () => ipcRenderer.removeListener('ciq:event', listener)
  },
})

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const home = os.homedir()
if (typeof process.getuid === 'function' && process.getuid() === 0) throw new Error('Run this installer as your regular user, not root.')
const exists = async file => fs.access(file).then(() => true, () => false)
const ensureNew = async file => { if (await exists(file)) throw new Error(`${file} already exists. This installer will not overwrite it. Move or rename it before installing a replacement.`) }

if (process.platform === 'darwin') {
  const source = path.join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'CIQ Developer Terminal.app')
  const destination = path.join(home, 'Applications', 'CIQ Developer Terminal.app')
  if (!await exists(source)) throw new Error('Build the macOS app first with npm run package:mac on a Mac with the same architecture.')
  await ensureNew(destination)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false })
  console.log(`Installed for your user only:\n${destination}\nOpen it from Finder. No admin privileges were requested.`)
} else if (process.platform === 'linux') {
  const source = process.env.CIQ_PORTABLE_SOURCE || path.join(root, 'release', process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked')
  const destination = path.join(home, '.local', 'opt', 'ciq-developer-terminal')
  const bin = path.join(home, '.local', 'bin', 'ciq-developer-terminal')
  const desktop = path.join(home, '.local', 'share', 'applications', 'ciq-developer-terminal.desktop')
  if (!await exists(path.join(source, 'ciq-developer-terminal'))) throw new Error('Build with npm run package:linux or set CIQ_PORTABLE_SOURCE to an extracted Linux release.')
  await Promise.all([ensureNew(destination), ensureNew(bin), ensureNew(desktop)])
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false })
  await fs.mkdir(path.dirname(bin), { recursive: true })
  await fs.symlink(path.join(destination, 'ciq-developer-terminal'), bin)
  await fs.mkdir(path.dirname(desktop), { recursive: true })
  const quoted = `"${path.join(destination, 'ciq-developer-terminal').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('`', '\\`').replaceAll('$', '\\$')}"`
  const icon = path.join(home, '.local', 'share', 'icons', 'hicolor', '1024x1024', 'apps', 'ciq-developer-terminal.png')
  await fs.mkdir(path.dirname(icon), { recursive: true })
  await fs.copyFile(path.join(root, 'assets', 'icon.png'), icon)
  await fs.writeFile(desktop, `[Desktop Entry]\nType=Application\nName=CIQ Developer Terminal\nExec=${quoted}\nIcon=ciq-developer-terminal\nTerminal=false\nCategories=Development;\nStartupNotify=true\n`, { flag: 'wx', mode: 0o644 })
  console.log(`Installed without root:\n${destination}\nLauncher: ${bin}\nRequires desktop libraries and unprivileged user namespaces for Chromium's sandbox. No sandbox bypass is installed.`)
} else if (process.platform === 'win32') {
  console.log('Use the per-user NSIS installer from release, or the portable executable. The installer has perMachine:false and allowElevation:false. It does not request administrator privileges.')
} else throw new Error(`Unsupported platform: ${process.platform}`)

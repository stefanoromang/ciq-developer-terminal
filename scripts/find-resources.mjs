import fs from 'node:fs'
import path from 'node:path'

// Locate the packaged app.asar regardless of the runner architecture or
// electron-builder's platform output directory naming.
const root = path.join(process.cwd(), 'release')
const found = []
function walk(directory, depth) {
  if (depth > 5 || !fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full, depth + 1)
    else if (entry.name === 'app.asar') found.push(full)
  }
}
walk(root, 0)

const asar = found.find(file => file.split(path.sep).includes('resources')) || found[0]
if (!asar) {
  console.error('No packaged app.asar found under release/.')
  process.exit(1)
}
const resources = path.dirname(asar)
const output = { CIQ_PACKAGE_RESOURCES: resources, CIQ_PACKAGE_APP_ROOT: asar }
for (const [name, value] of Object.entries(output)) {
  console.log(`${name}=${value}`)
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`)
}

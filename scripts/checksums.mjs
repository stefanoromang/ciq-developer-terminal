import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
const names = (await fs.readdir('release')).filter(name => /\.(zip|tar\.gz|exe)$/.test(name)).sort()
if (!names.length) throw new Error('No release downloads found.')
const lines = []
for (const name of names) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path.join('release', name))) hash.update(bytes)
  lines.push(`${hash.digest('hex')}  ${name}`)
}
await fs.writeFile(`release/SHA256SUMS-${process.platform}-${process.arch}.txt`, lines.join('\n') + '\n')
console.log(lines.join('\n'))

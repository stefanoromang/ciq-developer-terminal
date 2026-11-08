import { useState } from 'react'
import { ArrowClockwise, FolderOpen, MagnifyingGlass } from '@phosphor-icons/react'
import { bridge, isDesktop } from './bridge'
import { Modal } from './components'
import type { Workspace } from './types'

type Candidate = { id: string; name: string; directory: string; sources: string[]; available: boolean; added: boolean }
type Result = { imported: number; existing: number; failed: { directory: string; message: string }[]; state: Workspace; canceled?: boolean }
export function ImportDialog({ close, update }: { close: () => void; update: (state: Workspace) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState(''), [source, setSource] = useState('All sources')
  const [working, setWorking] = useState(false), [scanned, setScanned] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([]), [error, setError] = useState(''), [summary, setSummary] = useState('')
  const visible = candidates.filter(item => (source === 'All sources' || item.sources.includes(source)) && `${item.name} ${item.directory}`.toLowerCase().includes(query.toLowerCase()))
  const eligible = visible.filter(item => item.available && !item.added)
  const run = async (task: () => Promise<void>) => {
    setWorking(true); setError(''); setSummary('')
    try { await task() } catch (error) { setError(String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')) }
    finally { setWorking(false) }
  }
  const apply = (result: Result) => {
    if (result.canceled) return
    update(result.state)
    setSummary(`${result.imported} imported · ${result.existing} already open${result.failed.length ? ` · ${result.failed.length} unavailable` : ''}`)
    const open = new Set(result.state.projects.filter(item => !item.closed).map(item => item.directory))
    setCandidates(items => items.map(item => ({ ...item, added: open.has(item.directory) })))
    setSelected(new Set())
    if (result.failed.length) setWarnings(result.failed.map(item => `${item.directory}: ${item.message}`))
  }
  return <Modal wide title="Import your projects" close={() => { if (!working) close() }}>
    <p className="modal-description">Find local project folders from Claude Code, Codex, Cursor, OpenCode, VS Code and Windsurf. Import selected folders together, or choose folders from any other app.</p>
    <p className="muted import-scope">CIQ opens projects in their existing location, with their files and Git history. Chat histories and cloud-only Claude Projects are not imported.</p>
    <div className="button-row import-toolbar">
      <button className="button primary" disabled={working || !isDesktop} onClick={() => void run(async () => {
        const result = await bridge.invoke('project.discover')
        setCandidates(result.candidates); setWarnings(result.warnings); setSelected(new Set()); setScanned(true)
      })}><ArrowClockwise size={16} />{working ? 'Working…' : scanned ? 'Scan again' : 'Find projects'}</button>
      <button className="button" disabled={working || !isDesktop} onClick={() => void run(async () => apply(await bridge.invoke('project.importFolders')))}><FolderOpen size={16} />Choose folders…</button>
    </div>
    {!isDesktop && <p className="muted">Open the desktop app to find and import local projects.</p>}
    {scanned && <>
      <div className="import-filters"><label className="model-search"><MagnifyingGlass size={17} /><input aria-label="Search importable projects" placeholder="Search names or paths…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="Project source" value={source} onChange={event => setSource(event.target.value)}>{['All sources', 'Claude', 'Codex', 'Cursor', 'OpenCode', 'VS Code', 'Windsurf'].map(name => <option key={name}>{name}</option>)}</select></div>
      <div className="import-selection"><button className="text-button" disabled={working || !eligible.length} onClick={() => setSelected(value => new Set([...value, ...eligible.map(item => item.id)]))}>Select all shown ({eligible.length})</button><button className="text-button" disabled={working || !selected.size} onClick={() => setSelected(new Set())}>Clear selection</button><span aria-live="polite">{selected.size} selected</span></div>
      <div className="import-list">{visible.map(item => <label className={`import-row ${!item.available ? 'unavailable' : ''}`} key={item.id}>
        <input type="checkbox" disabled={working || !item.available || item.added} checked={selected.has(item.id)} onChange={event => setSelected(value => { const next = new Set(value); event.target.checked ? next.add(item.id) : next.delete(item.id); return next })} />
        <span><strong>{item.name}</strong><code>{item.directory}</code><small>{item.sources.join(' · ')}{item.added ? ' · Already open' : !item.available ? ' · Folder unavailable' : ''}</small></span>
      </label>)}{!visible.length && <p className="muted">{candidates.length ? 'No matching projects.' : 'No local projects found. Use Choose folders to bring your projects in.'}</p>}</div>
      <div className="button-row"><button className="button primary" disabled={working || !selected.size} onClick={() => void run(async () => apply(await bridge.invoke('project.import', { ids: [...selected] })))}>Import {selected.size || ''} selected</button></div>
    </>}
    {summary && <p className="import-summary" role="status">{summary}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {warnings.length > 0 && <details className="import-warnings"><summary>{warnings.length} discovery or import note{warnings.length > 1 ? 's' : ''}</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
  </Modal>
}

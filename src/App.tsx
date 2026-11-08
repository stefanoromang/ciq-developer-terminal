import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUp, ArrowClockwise, ArrowSquareOut, Archive, Brain, CaretDown, CaretRight,
  ChatCircle, Check, CheckCircle, Circle, Code, Command, Cube, DownloadSimple, Folder, FolderOpen, FolderPlus,
  GearSix, GitBranch, Key, Lightning, MagnifyingGlass, PencilSimple, PlugsConnected, Plus, ShieldCheck,
  SidebarSimple, Sparkle, Square, TerminalWindow, Trash, WarningCircle, X,
} from '@phosphor-icons/react'
import { bridge, isDesktop } from './bridge'
import { AgentQuestion, Mark, MessageView, Modal } from './components'
import { ImportDialog } from './ImportDialog'
import { coalescedRefresh } from './refresh'
import { Diagnostics } from './Diagnostics'
import type { AgentForm, McpStatus, Message, Model, Permission, ProviderOption, Workspace } from './types'

type Page = 'chat' | 'connections' | 'memory' | 'models' | 'settings'
const emptyUpdate = {
  currentVersion: '0.3.1', lastCheck: 0, intervalDays: 3.5, skippedVersion: '', autoDownload: true,
  downloading: false, progress: 0, ready: false, installing: false, error: '', downloaded: null, latest: null,
}
const empty: Workspace = {
  projects: [], connected: false, secureStorage: false, models: [], selectedModel: '', cadence: 'daily',
  lastRefresh: 0, toolsConfirmed: false, mcps: [], gateway: '', freeProvider: 'opencode', freeEnabled: true,
  modelsAvailable: false, providers: [], updates: emptyUpdate,
}
const titles: Record<Page, string> = { chat: 'Workspace', connections: 'MCP connections', memory: 'Project memory', models: 'Model library', settings: 'Settings' }
const modelKey = (model: Model) => `${model.providerID}/${model.id}`
const findModel = (models: Model[], key: string) => models.find(model => modelKey(model) === key) || models.find(model => model.id === key)


function niceError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')
  if (/free usage limit|FreeUsageLimitError/i.test(message)) {
    return 'OpenCode’s free-model limit was reached. Try again later or connect another provider in Model library.'
  }
  if (/spend_limit/i.test(message)) return 'Your provider’s spending limit was reached. Check your account quota or choose a model from another provider.'
  return message
}
function relativeDate(time: number) {
  const days = Math.floor((Date.now() - time) / 86_400_000)
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function Button({ children, onClick, primary, disabled = false, className = '', type = 'button' }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; className?: string; type?: 'button' | 'submit' }) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`button ${primary ? 'primary' : ''} ${className}`}>{children}</button>
}

export default function App() {
  const [state, setState] = useState<Workspace>(empty)
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState<Page>('chat')
  const [onboarding, setOnboarding] = useState(false)
  const [mcpModal, setMcpModal] = useState(false)
  const [searchModal, setSearchModal] = useState(false)
  const [rename, setRename] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const [sidebar, setSidebar] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [forms, setForms] = useState<AgentForm[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [prompt, setPrompt] = useState('')
  const [agent, setAgent] = useState<'build' | 'plan'>('build')
  const [modelSearch, setModelSearch] = useState('')
  const [memory, setMemory] = useState('')
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [mcpStatuses, setMcpStatuses] = useState<McpStatus[]>([])
  const [terminal, setTerminal] = useState(false)
  const [terminalCommand, setTerminalCommand] = useState('')
  const [terminalOutput, setTerminalOutput] = useState('')
  const [terminalRun, setTerminalRun] = useState<{ id: string; projectID: string } | null>(null)
  const [oauth, setOauth] = useState<{ integrationID: string; attemptID: string; url: string; instructions: string; mode: string; paste?: boolean; projectID: string } | null>(null)
  const [oauthCode, setOauthCode] = useState('')
  const [providerModal, setProviderModal] = useState(false)
  const [importModal, setImportModal] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const [search, setSearch] = useState('')
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const pagedHistory = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state
  const project = state.projects.find(p => p.id === state.activeProjectID && !p.closed)
  const session = project?.sessions.find(s => s.id === project.activeSessionID && !s.archived)
  const activeRef = useRef({ projectID: project?.id, sessionID: session?.id })
  activeRef.current = { projectID: project?.id, sessionID: session?.id }
  const currentModel = session?.model || state.selectedModel
  const model = findModel(state.models, currentModel)
  const canChat = state.modelsAvailable && state.models.length > 0
  const freeCount = state.models.filter(m => m.free).length
  const visibleModels = state.models.filter(m => (!freeOnly || m.free) && `${m.id} ${m.name} ${m.provider} ${m.providerID}`.toLowerCase().includes(modelSearch.toLowerCase()))
  const isBusy = Boolean(session && busy[session.id])

  const run = useCallback(async (task: () => Promise<any>) => {
    setError(''); setPending(true)
    try { return await task() }
    catch (e) { setError(niceError(e)); return undefined }
    finally { setPending(false) }
  }, [])
  const callState = useCallback(async (command: string, payload: Record<string, unknown> = {}) => {
    const next = await bridge.invoke(command, payload)
    if (next?.projects) setState(next)
    return next
  }, [])
  const historySession = useRef<string | undefined>(undefined)
  const refreshConversation = useMemo(() => coalescedRefresh(async () => {
    const selected = { ...activeRef.current }
    if (!selected.sessionID) return
    const [result, perms, questions] = await Promise.all([
      bridge.invoke('session.messages', selected),
      bridge.invoke('permission.list', selected), bridge.invoke('form.list', selected),
    ])
    if (activeRef.current.sessionID !== selected.sessionID) return
    const retainHistory = historySession.current === selected.sessionID
    historySession.current = selected.sessionID
    setMessages(previous => {
      const incoming: Message[] = [...(result.data || [])].reverse()
      if (!retainHistory) return incoming
      const ids = new Set(incoming.map(message => message.id))
      return [...previous.filter(message => !ids.has(message.id) && (!incoming.length || (message.time?.created || 0) < (incoming[0].time?.created || 0))), ...incoming]
    })
    setBusy(value => ({ ...value, [selected.sessionID!]: result.active === true }))
    if (!pagedHistory.current) setOlderCursor(result.cursor?.next || null)
    if (activeRef.current.sessionID !== selected.sessionID) return
    setPermissions(perms.data || [])
    setForms(questions.data || [])
  }), [])

  useEffect(() => {
    void bridge.invoke('state').then(next => { setState(next); setReady(true); if (isDesktop && !next.connected && !next.freeEnabled && !next.modelsAvailable) setOnboarding(true) }).catch(e => { setError(niceError(e)); setReady(true) })
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = bridge.onEvent(event => {
      if (event.type === 'ciq.state') { setState(event.data as Workspace); return }
      if (event.type === 'ciq.update') { setState(value => ({ ...value, updates: event.data as Workspace['updates'] })); return }
      if (event.type === 'ciq.update.progress') { setState(value => ({ ...value, updates: { ...value.updates, downloading: true, progress: event.data.progress as number } })); return }
      if (['ciq.engine.error', 'ciq.refresh.error'].includes(event.type)) { setError(event.data.message); if (event.type === 'ciq.engine.error') setBusy({}); return }
      if (event.type === 'session.execution.started') setBusy(b => ({ ...b, [event.data.sessionID]: true }))
      if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted', 'session.idle'].includes(event.type)) setBusy(b => ({ ...b, [event.data.sessionID]: false }))
      if (event.type === 'session.status') setBusy(b => ({ ...b, [event.data.sessionID]: event.data.status?.type !== 'idle' }))
      if (event.type === 'session.execution.failed' && event.data.sessionID === activeRef.current.sessionID) setError(niceError(event.data.error?.message || 'The model request failed.'))
      if (event.data.sessionID === activeRef.current.sessionID || ['server.connected', 'mcp.status.changed'].includes(event.type)) {
        if (!timer) timer = setTimeout(() => { timer = undefined; void refreshConversation().catch(e => setError(niceError(e))) }, 250)
      }
    })
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [refreshConversation])
  useEffect(() => {
    setMessages([]); setPermissions([]); setForms([]); setOlderCursor(null)
    pagedHistory.current = false
    pinned.current = true
    void refreshConversation().catch(e => setError(niceError(e)))
  }, [session?.id, refreshConversation])
  useEffect(() => {
    setMemory(project?.memory || ''); setMemoryEnabled(project?.memoryEnabled ?? true)
  }, [project?.id, project?.memory, project?.memoryEnabled])
  useEffect(() => {
    if (pinned.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' })
  }, [messages, permissions, forms])
  useEffect(() => {
    if (page !== 'connections' || !project || !isDesktop) return
    let disposed = false, loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try { const result = await bridge.invoke('mcp.list', { projectID: project.id }); if (!disposed) setMcpStatuses(result.data || []) }
      catch (e) { if (!disposed) setError(niceError(e)) }
      finally { loading = false }
    }
    void load()
    const timer = setInterval(() => { void load() }, 4000)
    return () => { disposed = true; clearInterval(timer) }
  }, [page, project?.id, state.mcps])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); setSearchModal(value => !value) }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); void run(() => callState('project.open')) }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); setPage('settings') }
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') { event.preventDefault(); setSidebar(value => !value) }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [run, callState])
  useEffect(() => {
    if (!oauth) return
    const timer = setInterval(() => {
      void bridge.invoke('mcp.authStatus', oauth).then(result => {
        if (result.data?.status === 'complete') { setOauth(null); setNotice('MCP sign-in completed.'); setPage('connections') }
        else if (['failed', 'expired'].includes(result.data?.status)) { setError(result.data.message || 'The sign-in attempt expired. Start sign-in again.'); setOauth(null) }
      }).catch(e => { setError(niceError(e)); setOauth(null) })
    }, 1800)
    return () => clearInterval(timer)
  }, [oauth])
  useEffect(() => {
    if (!terminalRun) return
    let cursor = 0, loading = false, disposed = false
    const load = async () => {
      if (loading) return; loading = true
      try {
        const result = await bridge.invoke('shell.output', { projectID: terminalRun.projectID, shellID: terminalRun.id, cursor })
        cursor = result.data.cursor
        if (!disposed && result.data.output) setTerminalOutput(value => (value + result.data.output).slice(-200_000))
        if (!disposed && result.status && result.status !== 'running') setTerminalRun(null)
      } catch (e) { if (!disposed) { setError(niceError(e)); setTerminalRun(null) } }
      finally { loading = false }
    }
    void load()
    const timer = setInterval(() => { void load() }, 600)
    return () => { disposed = true; clearInterval(timer) }
  }, [terminalRun])

  const openProject = () => void run(() => callState('project.open'))
  const createSession = async () => {
    if (!canChat) { setOnboarding(true); return }
    if (!project) { openProject(); return }
    await run(async () => { await callState('session.create', { projectID: project.id }); setPage('chat'); setPrompt(''); promptRef.current?.focus() })
  }
  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!prompt.trim() || pending || isBusy) return
    if (!canChat) { setOnboarding(true); return }
    if (!project) { openProject(); return }
    const message = prompt
    await run(async () => {
      let id = session?.id
      if (!id) {
        const next = await callState('session.create', { projectID: project.id })
        id = next.projects.find((p: { id: string }) => p.id === project.id).activeSessionID
        activeRef.current = { projectID: project.id, sessionID: id }
      }
      await bridge.invoke('session.agent', { projectID: project.id, sessionID: id, agent })
      setBusy(value => ({ ...value, [id!]: true }))
      try { await bridge.invoke('session.prompt', { projectID: project.id, sessionID: id, text: message }) }
      catch (error) { setBusy(value => ({ ...value, [id!]: false })); throw error }
      setPrompt(''); pinned.current = true
      await refreshConversation()
    })
  }
  const selectModel = async (id: string) => {
    await run(() => session ? callState('session.model', { projectID: project?.id, sessionID: session.id, model: id }) : callState('settings.save', { selectedModel: id }))
  }
  const loadFree = async () => {
    await callState('free.enable')
    setOnboarding(false)
    setNotice('Free OpenCode models are ready. No API key needed.')
    setPage('models')
  }
  const enableFree = () => run(loadFree)
  const connectProvider = async (payload: Record<string, unknown>) => {
    await callState('provider.connect', payload)
    setProviderModal(false)
    setNotice('Provider connected. Its models are now in your library.')
  }
  const checkUpdates = () => void run(async () => { await bridge.invoke('updates.check'); setNotice('Update check complete.') })
  const downloadUpdate = () => void run(() => bridge.invoke('updates.download'))
  const installUpdate = () => void run(() => bridge.invoke('updates.install'))
  const choosePage = (next: Page) => { setPage(next); setError(''); if (window.innerWidth < 900) setSidebar(false) }
  const promptStarter = (text: string) => { setPrompt(text); setPage('chat'); promptRef.current?.focus() }

  return <div className={`app ${!sidebar ? 'sidebar-hidden' : ''}`}>
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="window-drag"><span className="app-channel">DEVELOPER TERMINAL</span></div>
      <div className="brand-row"><Mark /><div><strong>CollectivIQ</strong><span>Developer Terminal <i>PREVIEW</i></span></div><button className="icon-button" aria-label="Collapse sidebar" onClick={() => setSidebar(false)}><SidebarSimple size={19} /></button></div>
      <div className="sidebar-actions"><button className="new-conversation" onClick={() => void createSession()} disabled={pending}><Plus size={18} /><span>New conversation</span><span className="shortcut">+</span></button>
        <button className="search-button" onClick={() => setSearchModal(true)}><MagnifyingGlass size={17} /><span>Search workspace</span><kbd>⌘ K</kbd></button></div>
      <nav className="main-nav">
        <button className={page === 'chat' ? 'active' : ''} onClick={() => choosePage('chat')}><ChatCircle size={19} />Workspace</button>
        <button className={page === 'connections' ? 'active' : ''} onClick={() => choosePage('connections')}><PlugsConnected size={19} />MCP connections<span className="nav-count">{state.mcps.length}</span></button>
        <button className={page === 'memory' ? 'active' : ''} onClick={() => choosePage('memory')}><Brain size={19} />Project memory</button>
        <button className={page === 'models' ? 'active' : ''} onClick={() => choosePage('models')}><Cube size={19} />Model library{Boolean(state.newModels?.length) && <span className="new-dot" />}</button>
      </nav>
      <div className="sidebar-projects"><div className="section-label"><span>PROJECTS</span><button className="icon-button" aria-label="Open project folder" onClick={openProject}><Plus size={15} /></button></div>
        <button className="import-projects-button" onClick={() => setImportModal(true)}><FolderPlus size={17} />Import projects</button>
        {state.projects.filter(p => !p.closed).length === 0 ? <button className="open-project-blank" onClick={openProject}><FolderPlus size={21} /><span>Open your first project<small>A folder. A fresh workspace.</small></span><Plus size={15} /></button>
        : state.projects.filter(p => !p.closed).map(p => <div className={`project-tree ${project?.id === p.id ? 'selected' : ''}`} key={p.id}>
          <div className="project-row"><button className="project-select" title={p.directory} onClick={() => void run(async () => { await callState('project.select', { projectID: p.id }); setPage('chat') })}>{project?.id === p.id ? <CaretDown size={13} /> : <CaretRight size={13} />}<Folder size={17} /><span>{p.name}</span></button><button className="icon-button project-close" aria-label={`Close ${p.name}`} onClick={() => void run(() => callState('project.close', { projectID: p.id }))}><X size={13} /></button></div>
          {project?.id === p.id && <div className="session-tree">{p.sessions.filter(s => !s.archived).map(s => <button className={session?.id === s.id ? 'active' : ''} key={s.id} onClick={() => void run(async () => { await callState('session.select', { projectID: p.id, sessionID: s.id }); setPage('chat') })}><span className={`session-dot ${busy[s.id] ? 'good' : ''}`} /><span>{s.title}</span></button>)}<button className="tree-new" onClick={() => void createSession()}><Plus size={13} />New conversation</button></div>}
        </div>)}
      </div>
      <div className="sidebar-bottom">
        <div className={`gateway-card ${state.connected ? 'connected' : state.freeEnabled ? 'free' : ''}`}><div className="gateway-card-top"><span className={`status-dot ${canChat ? 'good' : ''}`} /><span>{state.connected ? 'CollectivIQ Gateway' : state.freeEnabled ? 'Free models' : 'No provider'}</span>{state.connected ? <ShieldCheck size={15} /> : <Sparkle size={15} />}</div><p>{state.connected ? `${state.models.length} models · ${state.credentialStatus === 'saved' ? 'key saved securely' : 'session-only key'}` : state.freeEnabled ? `${freeCount} free models · no key needed` : 'Connect a provider to start.'}</p><button onClick={() => state.connected ? choosePage('models') : setOnboarding(true)}>{state.connected ? 'Manage models' : state.freeEnabled ? 'Connect CollectivIQ key' : 'Connect a provider'}<ArrowRight size={15} /></button></div>
        <button className={`settings-link ${page === 'settings' ? 'active' : ''}`} onClick={() => choosePage('settings')}><GearSix size={19} /><span>Settings</span><kbd>⌘ ,</kbd></button>
        <div className="sidebar-signoff"><Mark /><span>BY STEFANO ROMAN GUNNESS</span><span>{state.updates.currentVersion}</span></div>
      </div>
    </aside>
    {sidebar && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <main className="main">
      <header className="topbar"><div className="breadcrumb">{!sidebar && <button className="icon-button" aria-label="Open sidebar" onClick={() => setSidebar(true)}><SidebarSimple size={20} /></button>}<TerminalWindow size={17} /><span>{project?.name || 'Your workspace'}</span><span className="breadcrumb-slash">/</span><strong>{page === 'chat' && session ? session.title : titles[page]}</strong></div><div className="topbar-actions">{!isDesktop && <span className="preview-label">UI preview · desktop features unavailable</span>}<button className="icon-button" title="Search workspace" aria-label="Search workspace" onClick={() => setSearchModal(true)}><MagnifyingGlass size={18} /></button><button className={`icon-button ${terminal ? 'selected-icon' : ''}`} aria-label="Toggle command terminal" title="Command terminal" onClick={() => setTerminal(value => !value)}><TerminalWindow size={19} /></button></div></header>
      {error && <div className="alert error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="alert notice" role="status"><CheckCircle size={18} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {state.updates?.latest && state.updates.latest.version !== state.updates.skippedVersion && !state.updates.installing && <div className="update-banner" role="status"><DownloadSimple size={19} /><div><strong>CIQ {state.updates.latest.version} is available</strong><span>{state.updates.ready ? 'Downloaded and checksum-verified. Restart to finish.' : state.updates.downloading ? `Downloading update… ${Math.round(state.updates.progress * 100)}%` : 'A newer version is ready to download.'}</span></div>{state.updates.ready ? <Button primary onClick={installUpdate}>Restart &amp; install</Button> : state.updates.downloading ? <span className="update-progress">{Math.round(state.updates.progress * 100)}%</span> : <Button onClick={downloadUpdate}>Download update</Button>}<button className="text-button" onClick={() => void run(() => bridge.invoke('updates.skip', { version: state.updates.latest!.version }))}>Skip</button><button className="icon-button" aria-label="Open release notes" onClick={() => void bridge.invoke('external.open', { url: state.updates.latest!.page || 'https://github.com/stefanoromang/ciq-developer-terminal/releases' })}><ArrowSquareOut size={15} /></button></div>}
      {!ready ? <div className="loading-state"><Mark /><p>Opening your workspace…</p></div> : page === 'chat' ? <>
        <div className="conversation-scroll" ref={scrollRef} onScroll={() => { const element = scrollRef.current; if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120 }}>
          {!messages.length ? <div className="welcome"><div className="welcome-eyebrow"><span className="tiny-line" />YOUR NEXT IDEA STARTS HERE</div><div className="welcome-logo"><Mark /><span className="welcome-terminal"><Code size={24} /></span></div>
            <h1>Good ideas deserve<br /><span>great company.</span></h1><p className="welcome-description">Your code, your context, your choice of AI.<br />One workspace. Built around you.</p>
            <div className="welcome-project"><FolderOpen size={16} /><span>{project ? project.name : 'Start with a project folder'}</span>{project ? <span className="tag">LOCAL</span> : <button onClick={openProject}>Open project<ArrowRight size={14} /></button>}</div>
            <div className="starter-grid"><button onClick={() => promptStarter('Explore this codebase. Explain its architecture, entry points, and how to run it. Do not change files.')}><Code size={21} /><strong>Understand a codebase</strong><span>Find your way around a new project.</span><ArrowUp size={15} /></button><button onClick={() => promptStarter('Help me plan a new feature for this project. First ask what I want to build, then propose an implementation plan.')}><Sparkle size={21} /><strong>Build something new</strong><span>Turn an idea into your next feature.</span><ArrowUp size={15} /></button><button onClick={() => promptStarter('Review the current project changes for bugs, security issues, and missing tests. Explain findings before editing anything.')}><GitBranch size={21} /><strong>Review your changes</strong><span>A second perspective on your work.</span><ArrowUp size={15} /></button></div>
          </div> : <div className="message-list">{olderCursor && <button className="load-older" disabled={pending} onClick={() => void run(async () => { const selected = { ...activeRef.current }; const result = await bridge.invoke('session.messages', { ...selected, cursor: olderCursor }); if (activeRef.current.sessionID !== selected.sessionID) return; pinned.current = false; pagedHistory.current = true; setMessages(value => { const ids = new Set(value.map(message => message.id)); return [...result.data.reverse().filter((message: Message) => !ids.has(message.id)), ...value] }); setOlderCursor(result.cursor?.next || null) })}>Load earlier messages</button>}
            <div className="conversation-title"><span>{session?.created ? relativeDate(session.created) : 'Conversation'}</span><div><button className="icon-button" aria-label="Rename conversation" onClick={() => { setRenameTitle(session?.title || ''); setRename(true) }}><PencilSimple size={16} /></button><button className="icon-button" aria-label="Archive conversation" onClick={() => void run(() => callState('session.archive', { projectID: project?.id, sessionID: session?.id }))}><Archive size={16} /></button></div></div>
            {messages.filter(m => ['user', 'assistant', 'synthetic', 'compaction'].includes(m.type)).map(message => message.type === 'synthetic' || message.type === 'compaction' ? <div className="timeline-note" key={message.id}>{message.type === 'compaction' ? 'Conversation context compacted' : 'Project context added'}</div> : <MessageView message={message} key={message.id} />)}
            {isBusy && <div className="working-status" role="status"><Lightning size={16} />CIQ is working<span /> <button onClick={() => void run(() => bridge.invoke('session.interrupt', { projectID: project?.id, sessionID: session?.id }))}>Stop</button></div>}
            {permissions.map(permission => <div key={permission.id} className="permission-card"><div><ShieldCheck size={23} /><div><h3>Permission needed</h3><p>{permission.message || `Allow ${permission.action}?`}</p></div></div><pre>{permission.resources.join('\n')}</pre><div className="button-row"><Button disabled={pending} onClick={() => void run(async () => { await bridge.invoke('permission.reply', { projectID: project?.id, sessionID: session?.id, requestID: permission.id, decision: 'reject' }); await refreshConversation() })}>Reject</Button><Button primary disabled={pending} onClick={() => void run(async () => { await bridge.invoke('permission.reply', { projectID: project?.id, sessionID: session?.id, requestID: permission.id, decision: 'once' }); await refreshConversation() })}><Check size={15} />Allow once</Button></div></div>)}
            {forms.map(form => <AgentQuestion key={form.id} form={form} answer={answer => void run(async () => { await bridge.invoke('form.reply', { projectID: project?.id, sessionID: session?.id, formID: form.id, answer }); await refreshConversation() })} cancel={() => void run(async () => { await bridge.invoke('form.cancel', { projectID: project?.id, sessionID: session?.id, formID: form.id }); await refreshConversation() })} />)}
          </div>}
        </div>
        <div className="composer-area"><form className="composer" onSubmit={send}><textarea ref={promptRef} aria-label="Message CIQ" placeholder={project ? `What would you like to build in ${project.name}?` : 'Ask, build, or explore something…'} value={prompt} rows={2} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} /><div className="composer-toolbar"><div className="composer-options"><label className="mode-select"><Code size={16} /><select aria-label="Agent mode" value={agent} disabled={isBusy || pending} onChange={event => setAgent(event.target.value as 'plan' | 'build')}><option value="build">Build</option><option value="plan">Plan</option></select></label><span className="toolbar-divider" /><button type="button" className="model-button" onClick={() => choosePage('models')}><span className="model-symbol"><Sparkle size={14} /></span><span>{model?.name || (currentModel ? currentModel : 'Choose a model')}</span><CaretDown size={12} /></button></div><div className="composer-send"><span className="enter-hint">↵ to send</span>{isBusy ? <button type="button" className="send-button stop" aria-label="Stop generation" onClick={() => void run(() => bridge.invoke('session.interrupt', { projectID: project?.id, sessionID: session?.id }))}><Square size={16} weight="fill" /></button> : <button className="send-button" type="submit" aria-label="Send message" disabled={!prompt.trim() || pending}><ArrowUp size={21} weight="bold" /></button>}</div></div></form><div className="composer-footnote"><span><ShieldCheck size={12} />{project?.memoryEnabled && project.memory ? 'Project notes included' : 'Tools ask for your permission'}</span><span>Shift + Enter for a new line</span></div></div>
      </> : <div className="page-scroll"><div className="settings-page"><div className="page-heading"><div className="eyebrow">YOUR WORKSPACE, YOUR WAY</div><h1>{titles[page]}</h1><p>{page === 'connections' ? 'Give your AI the right tools. Keep every connection in sight.' : page === 'memory' ? 'Less repeating yourself. More picking up where you left off.' : page === 'models' ? 'Free OpenCode models, plus every provider you connect. No provider juggling.' : 'A few thoughtful defaults. Nothing between you and your work.'}</p></div>
        {page === 'connections' && <><div className="section-toolbar"><span>{state.mcps.length} configured server{state.mcps.length === 1 ? '' : 's'}</span><Button primary onClick={() => setMcpModal(true)}><Plus size={16} />Add MCP server</Button></div><div className="info-strip"><ShieldCheck size={18} /><span>New servers start disconnected. Connecting a local server runs its command on your computer. Review it first.</span></div>
          {!state.mcps.length ? <div className="empty-panel"><PlugsConnected size={42} weight="light" /><h2>A connection makes it possible.</h2><p>Add an MCP server to bring documentation, files, and services into your workflow.</p><Button onClick={() => setMcpModal(true)}><Plus size={16} />Add your first server</Button></div> : <div className="list-panel">{state.mcps.map(mcp => {
            const status = mcpStatuses.find(s => s.name === mcp.name)
            const label = !project ? 'Open a project to check status' : status?.status.status || (mcp.config.disabled ? 'disconnected' : 'checking')
            return <div className="connection-row" key={mcp.name}><div className="connection-icon"><PlugsConnected size={23} /></div><div className="connection-info"><strong>{mcp.name}</strong><code>{mcp.config.url || mcp.config.command?.join(' ')}</code><span className="connection-status"><span className={`status-dot ${label === 'connected' ? 'good' : ''}`} />{label.replaceAll('_', ' ')}{status?.status.error && ` · ${status.status.error}`}</span></div><div className="connection-actions">{label === 'needs_auth' && status?.integrationID && <Button disabled={pending} onClick={() => void run(async () => { const result = await bridge.invoke('mcp.auth', { projectID: project?.id, integrationID: status.integrationID }); setOauth({ ...result.data, integrationID: status.integrationID!, projectID: project!.id }) })}><Key size={14} />Sign in</Button>}<Button disabled={!project || pending} onClick={() => void run(() => callState('mcp.toggle', { projectID: project?.id, name: mcp.name, enabled: mcp.config.disabled !== false }))}>{mcp.config.disabled !== false ? 'Connect' : 'Disconnect'}</Button><button className="icon-button" aria-label={`Remove ${mcp.name}`} disabled={pending} onClick={() => void run(() => callState('mcp.remove', { name: mcp.name }))}><Trash size={17} /></button></div></div>
          })}</div>}<div className="quiet-note"><PlugsConnected size={16} />Remote servers use OAuth when available. No secrets in project files.<button onClick={() => void bridge.invoke('external.open', { url: 'https://modelcontextprotocol.io/introduction' })}>About MCP<ArrowSquareOut size={13} /></button></div></>}
        {page === 'memory' && (!project ? <div className="empty-panel"><Brain size={44} weight="light" /><h2>Every project gets its own context.</h2><p>Open a project to save decisions, coding conventions, and useful notes.</p><Button primary onClick={openProject}><FolderOpen size={17} />Open a project</Button></div> : <><div className="memory-project"><div className="connection-icon"><Folder size={23} /></div><div><strong>{project.name}</strong><code>{project.directory}</code></div><label className="toggle-label"><input type="checkbox" checked={memoryEnabled} onChange={event => setMemoryEnabled(event.target.checked)} /><span>Include in prompts</span></label></div><label className="field memory-field"><span>Project notes</span><textarea value={memory} maxLength={16_000} onChange={event => setMemory(event.target.value)} placeholder={'What should CIQ remember about this project?\n\nArchitecture decisions, preferred tools, coding conventions, or the next thing to work on.'} /><small>{memory.length.toLocaleString()} / 16,000 characters · Saved locally, separate from your repository</small></label><div className="button-row"><Button primary disabled={pending} onClick={() => void run(async () => { await callState('memory.save', { projectID: project.id, memory, enabled: memoryEnabled }); setNotice('Project notes saved.') })}><Check size={16} />Save project notes</Button></div><div className="info-strip"><Brain size={19} /><span>These are explicit notes you control—not hidden automatic memory. When enabled, they are sent to your selected model with each new prompt for this project. Conversation history is stored by the local engine.</span></div></>)}
        {page === 'models' && <><div className="model-summary"><div><span className={`status-dot ${canChat ? 'good' : ''}`} /><strong>{state.connected ? 'CollectivIQ + free models' : 'Free & connected models'}</strong><span className="tag">{state.models.length} MODELS</span></div><Button disabled={pending || (!state.connected && !state.freeEnabled && !state.providers.length)} onClick={() => void run(async () => { await callState('models.refresh'); setNotice('Model catalog refreshed. Existing conversations keep their selected model.') })}><ArrowClockwise size={16} />Refresh models</Button></div>
          <div className="provider-cards"><div className={`provider-card ${state.freeEnabled ? 'active' : ''}`}><div className="provider-card-head"><Sparkle size={20} /><div><strong>OpenCode Zen</strong><span>Free coding models · no API key</span></div><span className="tag free">FREE</span></div><p>Every free coding model currently advertised by OpenCode. Refresh to discover additions; availability and quotas are controlled by OpenCode.</p>{state.freeEnabled ? <span className="provider-status"><CheckCircle size={15} weight="fill" />Enabled</span> : <Button onClick={enableFree}>Enable free models</Button>}</div>
            <div className="provider-card"><div className="provider-card-head"><Key size={20} /><div><strong>CollectivIQ</strong><span>{state.connected ? (state.credentialStatus === 'saved' ? 'API key saved securely · restored on launch' : 'Session-only key') : 'Optional · use your account’s models'}</span></div>{state.connected && <span className="tag good">KEY</span>}</div><p>Use every model your CollectivIQ account exposes through one Developer/Gateway key.</p><Button onClick={() => setOnboarding(true)}>{state.connected ? 'Manage key' : 'Connect key'}</Button></div>
            {state.providers.map(provider => <div className="provider-card" key={provider.id}><div className="provider-card-head"><PlugsConnected size={20} /><div><strong>{provider.name}</strong><span>{provider.credentialStatus === 'saved' ? 'API key saved securely · restored on launch' : provider.credentialStatus === 'session' ? 'Session-only key · reconnect after quitting' : 'Reconnect your API key'}</span></div><span className="tag good">{provider.connected ? 'KEY' : 'OFFLINE'}</span></div><p>{provider.env.join(', ')}</p><div className="button-row"><Button onClick={() => setProviderModal(true)}>{provider.connected ? 'Replace key' : 'Reconnect'}</Button><Button disabled={pending} onClick={() => void run(() => callState('provider.disconnect', { providerID: provider.id }))}>Disconnect</Button></div></div>)}
            <button className="provider-add" onClick={() => setProviderModal(true)}><Plus size={18} /><span>Connect another provider<small>Bring your own key for OpenAI, Anthropic, Google, Groq, OpenRouter and more.</small></span></button></div>
          <div className="refresh-row"><div><strong>Keep your options current</strong><p>Checks run while CIQ is open, with catch-up on next launch.</p></div><select aria-label="Model refresh schedule" value={state.cadence} onChange={event => void run(() => callState('settings.save', { cadence: event.target.value }))}><option value="daily">Check daily</option><option value="weekly">Check weekly</option><option value="manual">Manual only</option></select></div>
          <label className="model-search"><MagnifyingGlass size={18} /><input aria-label="Search models" placeholder="Search models by name or provider…" value={modelSearch} onChange={event => setModelSearch(event.target.value)} /><kbd>{state.models.length}</kbd></label>
          <label className="checkbox-row"><input type="checkbox" checked={freeOnly} onChange={event => setFreeOnly(event.target.checked)} /><span>Free models only ({freeCount}) · all zero-cost models advertised by connected providers</span></label>
          {state.models.length ? <div className="model-list">{visibleModels.map(m => <button key={modelKey(m)} className={`model-row ${currentModel === modelKey(m) ? 'selected' : ''}`} disabled={isBusy || pending} onClick={() => void selectModel(modelKey(m))}><div className="model-icon">{m.free ? <Sparkle size={20} /> : <Cube size={21} />}</div><div><strong>{m.name}{m.free && <span className="tag free">FREE</span>}{state.newModels?.includes(modelKey(m)) && <span className="tag new">NEW</span>}</strong><code>{m.id}</code><span>{m.provider}{m.context ? ` · ${(m.context / 1000).toLocaleString()}k context` : ''} · {m.tools === true ? 'Tool support declared' : m.tools === false ? 'Chat only' : 'Tool support not declared'}</span></div><span className="model-radio">{currentModel === modelKey(m) ? <CheckCircle size={22} weight="fill" /> : <Circle size={22} />}</span></button>)}</div> : <div className="empty-panel"><Cube size={44} weight="light" /><h2>Your model library is empty.</h2><p>Start with OpenCode’s free models, or connect your CollectivIQ Developer key.</p><div className="button-row"><Button primary onClick={enableFree}><Sparkle size={16} />Use free models</Button><Button onClick={() => setOnboarding(true)}><Key size={16} />Connect CollectivIQ</Button></div></div>}
          {state.models.length > 0 && visibleModels.length === 0 && <p className="muted">No matching models.</p>}
          <div className="quiet-note">{state.lastRefresh ? `Last checked ${new Date(state.lastRefresh).toLocaleString()}` : 'Not checked yet'}<span>Selections never change automatically.</span></div>
          <div className="info-strip"><Sparkle size={18} /><span>Free models are provided by OpenCode and can be rate-limited or temporarily unavailable. CollectivIQ models use your own Developer key. “Best of the Best” appears only if your gateway catalog offers it.</span></div></>}
        {page === 'settings' && <><section className="settings-section"><h2>Models & credentials</h2><div className="settings-card"><div className="setting-row"><div className="setting-icon"><Sparkle size={21} /></div><div><strong>OpenCode free models</strong><p>{state.freeEnabled ? 'Enabled. No API key needed; availability and rate limits are controlled by OpenCode.' : 'Enable free coding models without a CollectivIQ key.'}</p></div>{state.freeEnabled ? <span className="provider-status"><CheckCircle size={15} weight="fill" />Enabled</span> : <Button disabled={pending} onClick={enableFree}>Enable</Button>}</div><div className="setting-row"><div className="setting-icon"><Key size={21} /></div><div><strong>CollectivIQ Developer API key</strong><p>{state.connected ? 'Connected. Your key is never shown in the chat interface.' : 'Optional. Adds every model your CollectivIQ account can access.'}</p></div><Button onClick={() => setOnboarding(true)}>{state.connected ? 'Replace key' : 'Connect key'}</Button></div>{state.connected && <div className="setting-row"><div className="setting-icon"><ShieldCheck size={21} /></div><div><strong>Disconnect this account</strong><p>Removes the stored key. Free models, local projects and conversations stay intact.</p></div><Button disabled={pending} onClick={() => void run(() => callState('key.disconnect'))}>Disconnect</Button></div>}</div></section>
          <section className="settings-section"><h2>Updates</h2><div className="settings-card"><div className="setting-row"><div className="setting-icon"><DownloadSimple size={21} /></div><div><strong>CIQ Developer Terminal {state.updates.currentVersion}</strong><p>{state.updates.lastCheck ? `Last checked ${new Date(state.updates.lastCheck).toLocaleString()}.` : 'Not checked yet.'} CIQ checks this project’s GitHub releases about twice a week and catches up on launch.</p></div><Button disabled={pending || state.updates.downloading} onClick={checkUpdates}>Check now</Button></div><label className="setting-row toggle-setting"><div className="setting-icon"><ArrowClockwise size={21} /></div><div><strong>Download updates automatically</strong><p>Downloads are checksum-verified before installation. You choose when to restart.</p></div><input type="checkbox" checked={state.updates.autoDownload} onChange={event => void run(() => callState('updates.settings', { autoDownload: event.target.checked }))} /></label>{state.updates.latest && <div className="setting-row"><div className="setting-icon"><DownloadSimple size={21} /></div><div><strong>Version {state.updates.latest.version} is available</strong><p>{state.updates.ready ? 'Downloaded and checksum-verified. Restart to finish installing.' : state.updates.downloading ? `Downloading… ${Math.round(state.updates.progress * 100)}%` : 'A newer version is ready to download.'}</p></div>{state.updates.ready ? <Button primary onClick={installUpdate}>Restart &amp; install</Button> : state.updates.downloading ? <span className="update-progress">{Math.round(state.updates.progress * 100)}%</span> : <Button onClick={downloadUpdate}>Download</Button>}</div>}{state.updates.error && <p className="inline-error">{state.updates.error}</p>}</div></section>
          <section className="settings-section"><h2>Model tools</h2><div className="settings-card"><label className="setting-row toggle-setting"><div className="setting-icon"><Code size={21} /></div><div><strong>Enable tools for models with unknown capability</strong><p>Only enable if your gateway supports OpenAI tool calls. Unsupported models may reject requests; declared chat-only models remain chat-only.</p></div><input type="checkbox" checked={state.toolsConfirmed} onChange={event => void run(() => callState('settings.save', { toolsConfirmed: event.target.checked }))} /></label></div></section>
          <section className="settings-section"><h2>Privacy by design</h2><div className="settings-card privacy-grid"><div><ShieldCheck size={23} /><strong>Local workspace</strong><p>Notes and conversation history stay on this computer. Prompts and required context go to your selected gateway model.</p></div><div><Key size={23} /><strong>{state.secureStorage ? 'OS-protected credentials' : 'Session-only available'}</strong><p>{state.secureStorage ? 'Saved keys are encrypted using Electron safeStorage backed by the operating system.' : 'Secure OS storage is unavailable. Use a session-only key; no plaintext fallback.'}</p></div></div></section>
          <section className="settings-section"><h2>Keyboard shortcuts</h2><div className="settings-card keyboard-list"><div><span>Search projects and conversations</span><kbd>⌘ / Ctrl K</kbd></div><div><span>Open project folder</span><kbd>⌘ / Ctrl Shift O</kbd></div><div><span>Toggle sidebar</span><kbd>⌘ / Ctrl \</kbd></div><div><span>Open settings</span><kbd>⌘ / Ctrl ,</kbd></div><div><span>Send prompt</span><kbd>Enter</kbd></div></div></section><div className="about-ciq"><Mark /><div><strong>CIQ Developer Terminal <span className="tag">{state.updates.currentVersion} PREVIEW</span></strong><p className="creator-credit">Created by Stefano Roman Gunness.</p><p>An independently designed CIQ interface, powered by the MIT-licensed OpenCode engine. Free models come from OpenCode; CollectivIQ and other providers are optional. Not an official OpenCode or CollectivIQ distribution.</p><div className="attribution-links"><button onClick={() => void bridge.invoke('external.open', { url: 'https://github.com/stefanoromang/ciq-developer-terminal' })}>Project source<ArrowSquareOut size={12} /></button><button onClick={() => void bridge.invoke('external.open', { url: 'https://github.com/anomalyco/opencode' })}>Read the original OpenCode source<ArrowSquareOut size={12} /></button><button onClick={() => void bridge.invoke('external.open', { url: 'https://opencode.ai/v2/docs/' })}>OpenCode documentation<ArrowSquareOut size={12} /></button></div></div></div></>}
          {page === 'settings' && <Diagnostics />}
      </div></div>}
      {terminal && <section className="terminal-panel" aria-label="Command terminal"><div className="terminal-heading"><span><TerminalWindow size={15} />COMMAND TERMINAL<span className="terminal-directory">{project?.name || 'No project'}</span></span><div>{terminalRun && <button className="icon-button" aria-label="Stop command" onClick={() => void run(async () => { await bridge.invoke('shell.stop', { projectID: terminalRun.projectID, shellID: terminalRun.id }); setTerminalRun(null) })}><Square size={13} /></button>}<button className="icon-button" aria-label="Clear terminal output" onClick={() => setTerminalOutput('')}><Trash size={14} /></button><button className="icon-button" aria-label="Close terminal" onClick={() => setTerminal(false)}><X size={15} /></button></div></div><pre className="terminal-output">{terminalOutput || 'Commands you run here execute locally in the selected project. Interactive programs are not supported in this preview.'}</pre><form onSubmit={event => { event.preventDefault(); if (!project || terminalRun) return; void run(async () => { setTerminalOutput(value => value + `\n❯ ${terminalCommand}\n`); const result = await bridge.invoke('shell.run', { projectID: project.id, command: terminalCommand }); setTerminalRun({ id: result.data.id, projectID: project.id }); setTerminalCommand('') }) }}><span>❯</span><input aria-label="Local shell command" placeholder={project ? 'Enter a command and press Return to run…' : 'Open a project to run commands'} disabled={!project || Boolean(terminalRun)} value={terminalCommand} onChange={event => setTerminalCommand(event.target.value)} /><button aria-label="Run shell command" disabled={!project || !terminalCommand.trim() || Boolean(terminalRun)}><ArrowRight size={16} /></button></form></section>}
      <footer className="statusbar"><span><span className={`status-dot ${canChat ? 'good' : ''}`} />{canChat ? (state.connected ? 'CollectivIQ connected' : `${freeCount} free models · ${state.models.length} total`) : 'Choose a model provider to get started'}</span><div>{project && <span><Folder size={12} />{project.name}</span>}<span><ShieldCheck size={12} />Local workspace</span><span className="status-ciq">CIQ</span></div></footer>
    </main>
    {onboarding && <KeyOnboarding state={state} close={() => setOnboarding(false)} enableFree={loadFree} connect={async payload => { await callState('key.connect', payload); setOnboarding(false); setNotice('Gateway connected. Your available models are ready.'); setPage('models') }} />}
    {providerModal && <ProviderDialog secureStorage={state.secureStorage} close={() => setProviderModal(false)} connect={connectProvider} />}
    {importModal && <ImportDialog close={() => setImportModal(false)} update={setState} />}
    {mcpModal && <McpDialog close={() => setMcpModal(false)} save={async payload => { await callState('mcp.add', payload); setMcpModal(false); setNotice('MCP server saved. Review it, then connect when ready.') }} />}
    {searchModal && <Modal title="Find your next conversation" close={() => setSearchModal(false)}><label className="model-search modal-search"><MagnifyingGlass size={19} /><input autoFocus aria-label="Search workspace" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search projects and conversations…" /></label><div className="search-results">{state.projects.filter(p => !p.closed).map(p => <div key={p.id}><button onClick={() => void run(async () => { await callState('project.select', { projectID: p.id }); setPage('chat'); setSearchModal(false) })}><Folder size={18} /><span>{p.name}</span><ArrowRight size={15} /></button>{p.sessions.filter(s => !s.archived && `${s.title} ${p.name}`.toLowerCase().includes(search.toLowerCase())).map(s => <button key={s.id} className="search-session" onClick={() => void run(async () => { await callState('project.select', { projectID: p.id }); await callState('session.select', { projectID: p.id, sessionID: s.id }); setPage('chat'); setSearchModal(false) })}><ChatCircle size={17} /><span>{s.title}</span><small>{p.name}</small></button>)}</div>)}{!state.projects.some(p => !p.closed) && <p className="muted search-empty">Open a project to start building your workspace.</p>}</div><Button onClick={() => { setSearchModal(false); openProject() }}><FolderPlus size={17} />Open another project</Button></Modal>}
    {rename && <Modal title="Rename conversation" close={() => setRename(false)}><form onSubmit={event => { event.preventDefault(); void run(async () => { await callState('session.rename', { projectID: project?.id, sessionID: session?.id, title: renameTitle }); setRename(false) }) }}><label className="field"><span>Conversation name</span><input autoFocus required maxLength={140} value={renameTitle} onChange={event => setRenameTitle(event.target.value)} /></label><Button primary type="submit">Save name</Button></form></Modal>}
    {oauth && <Modal title="Sign in to your MCP server" close={() => setOauth(null)}><p className="muted">{oauth.instructions}</p><Button primary onClick={() => void bridge.invoke('external.open', { url: oauth.url })}><ArrowSquareOut size={16} />Open sign-in page</Button><p className="quiet-note">Waiting for authorization. This app does not ask for your server password.</p>{(oauth.mode === 'code' || oauth.paste) && <form onSubmit={event => { event.preventDefault(); void run(() => bridge.invoke('mcp.authComplete', { ...oauth, code: oauthCode })) }}><label className="field"><span>Authorization code or callback URL</span><input required value={oauthCode} onChange={event => setOauthCode(event.target.value)} /></label><Button type="submit">Complete sign-in</Button></form>}</Modal>}
  </div>
}

function KeyOnboarding({ state, close, connect, enableFree }: { state: Workspace; close: () => void; connect: (payload: Record<string, unknown>) => Promise<void>; enableFree: () => Promise<void> }) {
  const [mode, setMode] = useState<'free' | 'collectiviq'>('free')
  const [key, setKey] = useState(''), [type, setType] = useState('developer'), [remember, setRemember] = useState(state.secureStorage), [tools, setTools] = useState(state.toolsConfirmed), [error, setError] = useState(''), [working, setWorking] = useState(false)
  return <Modal title={mode === 'free' ? 'Start coding right away.' : 'Add your CollectivIQ key.'} close={() => { if (!working) close() }}>
    <div className="onboarding-brand"><Mark /><span>CIQ DEVELOPER TERMINAL</span></div>
    {mode === 'free' ? <>
      <p className="modal-description">CIQ includes OpenCode’s free coding models. No CollectivIQ key is required to open a project and start a conversation.</p>
      <div className="onboarding-free">
        <div className="onboarding-free-head"><Sparkle size={22} /><div><strong>Free models, included</strong><span>Powered by OpenCode Zen</span></div><span className="tag free">NO KEY</span></div>
        <ul>
          <li>Big Pickle, DeepSeek V4.1 Flash, GLM-5.3 Flash, Nemotron, MiMo, Inkling and more</li>
          <li>Free access is rate-limited by OpenCode and can change over time</li>
          <li>Add CollectivIQ or another provider key later for more model options</li>
        </ul>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <Button primary className="connect-button" disabled={working} onClick={() => { setWorking(true); setError(''); void enableFree().catch(e => setError(niceError(e))).finally(() => setWorking(false)) }}><Lightning size={17} />{working ? 'Loading free models…' : 'Use free models'}</Button>
      <button type="button" className="text-button browse-button" disabled={working} onClick={() => setMode('collectiviq')}>I have a CollectivIQ Developer key</button>
      <button type="button" className="text-button browse-button" disabled={working} onClick={close}>Explore the workspace first</button>
    </> : <>
      <p className="modal-description">Optional. Connect once to add every model your CollectivIQ account exposes.</p>
      <form onSubmit={async event => { event.preventDefault(); setError(''); setWorking(true); try { await connect({ key, type, remember, toolsConfirmed: tools }); setKey('') } catch (e) { setError(niceError(e)) } finally { setWorking(false) } }}>
        <label className="field"><span>Which CollectivIQ key are you adding?</span><select value={type} onChange={event => setType(event.target.value)}><option value="developer">Developer / Gateway API key — model access</option><option value="standard">Standard API key — platform data</option></select></label>
        {type === 'standard' ? <div className="inline-warning"><Key size={20} /><p>Standard keys are for threads, messages and files. To use LLMs here, create a <strong>Developer/Gateway key</strong> in CollectivIQ → Settings → Developer Access.</p></div> : <><label className="field"><span>Developer API key</span><input type="password" autoComplete="off" spellCheck={false} required value={key} onChange={event => setKey(event.target.value)} placeholder="Paste your CollectivIQ Developer API key" /><small>Sent only to the official CollectivIQ gateway. Never included in prompts.</small></label><div className="endpoint-display"><ShieldCheck size={15} /><code>api.prod.collectiviq.ai/v1</code><span>OFFICIAL GATEWAY</span></div><label className="checkbox-row"><input type="checkbox" disabled={!state.secureStorage} checked={remember} onChange={event => setRemember(event.target.checked)} /><span>{state.secureStorage ? 'Remember securely on this computer' : 'Session-only key (secure OS storage unavailable)'}</span></label><label className="checkbox-row tools-consent"><input type="checkbox" checked={tools} onChange={event => setTools(event.target.checked)} /><span>My gateway models support OpenAI tool calls<small>Enable coding tools when the catalog does not declare support. You can change this in Settings.</small></span></label></>}
        {error && <p className="inline-error" role="alert">{error}</p>}<Button primary type="submit" disabled={working || type !== 'developer' || !key.trim()} className="connect-button">{working ? 'Checking key & loading models…' : 'Connect & discover models'}{!working && <ArrowRight size={17} />}</Button>
        <p className="key-help">Your free models keep working alongside CollectivIQ. No other provider keys are required.</p>
        <button type="button" className="text-button browse-button" disabled={working} onClick={() => setMode('free')}>Back to free models</button>
      </form>
    </>}
  </Modal>
}

function ProviderDialog({ close, connect, secureStorage }: { close: () => void; connect: (payload: Record<string, unknown>) => Promise<void>; secureStorage: boolean }) {
  const [options, setOptions] = useState<ProviderOption[]>([])
  const [selected, setSelected] = useState(''), [query, setQuery] = useState('')
  const [key, setKey] = useState(''), [remember, setRemember] = useState(secureStorage)
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [working, setWorking] = useState(false)
  useEffect(() => {
    let disposed = false
    void bridge.invoke('provider.list').then(result => {
      if (disposed) return
      setOptions(Array.isArray(result?.data) ? result.data : [])
    }).catch(e => { if (!disposed) setError(niceError(e)) }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [])
  const filtered = options.filter(option => `${option.name} ${option.id}`.toLowerCase().includes(query.toLowerCase()))
  const current = options.find(option => option.id === selected)
  return <Modal title="Connect another provider" close={() => { if (!working) close() }}>
    <p className="modal-description">Bring your own API key, including keys for free-tier providers. Saved keys are encrypted on this computer and restored on launch. Provider pricing and quotas apply.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {loading ? <p className="muted">Loading providers from the engine…</p> : <>
      <label className="model-search"><MagnifyingGlass size={18} /><input autoFocus aria-label="Search providers" placeholder="Search providers…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>{filtered.length}</kbd></label>
      <div className="provider-options">{filtered.map(option => <button type="button" disabled={working} key={option.id} aria-pressed={selected === option.id} className={`provider-option ${selected === option.id ? 'selected' : ''}`} onClick={() => { setSelected(option.id); setKey(''); setError('') }}><strong>{option.name}</strong><code>{option.id}</code>{option.connected && <span className="tag good">CONNECTED</span>}</button>)}</div>
      {!filtered.length && <p className="muted">No matching providers.</p>}
      {current && <form onSubmit={async event => { event.preventDefault(); setError(''); setWorking(true); try { await connect({ providerID: current.id, key, remember }) } catch (e) { setError(niceError(e)); setWorking(false) } }}>
        <label className="field"><span>{current.name} API key</span><input type="password" autoComplete="off" spellCheck={false} required value={key} onChange={event => setKey(event.target.value)} placeholder={`Paste your ${current.name} API key`} /><small>Injected as {current.env.join(' or ')}. Never saved by the engine.</small></label>
        <label className="checkbox-row"><input type="checkbox" disabled={!secureStorage || working} checked={remember} onChange={event => setRemember(event.target.checked)} /><span>{secureStorage ? 'Save API key securely for future launches' : 'Session-only key (secure OS storage unavailable)'}</span></label>
        <div className="button-row"><Button onClick={close} disabled={working}>Cancel</Button><Button primary type="submit" disabled={working || !key.trim()}>{working ? 'Connecting…' : `Connect ${current.name}`}</Button></div>
      </form>}
    </>}
  </Modal>
}

function McpDialog({ close, save }: { close: () => void; save: (payload: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(''), [type, setType] = useState('remote'), [url, setUrl] = useState(''), [command, setCommand] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false)
  return <Modal title="A new connection." close={close}><p className="modal-description">Add a tool server to your workspace. It stays disconnected until you choose to connect.</p><form onSubmit={async event => { event.preventDefault(); setWorking(true); setError(''); try { await save({ name, type, url, command }) } catch (e) { setError(niceError(e)) } finally { setWorking(false) } }}><label className="field"><span>Server name</span><input autoFocus required pattern="[a-zA-Z0-9_-]{1,60}" placeholder="e.g. project-docs" value={name} onChange={event => setName(event.target.value)} /></label><div className="segmented-control"><button type="button" className={type === 'remote' ? 'active' : ''} onClick={() => setType('remote')}><PlugsConnected size={16} />Remote URL</button><button type="button" className={type === 'local' ? 'active' : ''} onClick={() => setType('local')}><TerminalWindow size={16} />Local command</button></div>{type === 'remote' ? <label className="field"><span>MCP server URL</span><input type="url" required placeholder="https://your-server.example/mcp" value={url} onChange={event => setUrl(event.target.value)} /><small>Streamable HTTP. OAuth sign-in is offered when the server supports it.</small></label> : <label className="field"><span>Executable and arguments (JSON array)</span><textarea required placeholder={'["npx", "-y", "your-mcp-server"]'} value={command} onChange={event => setCommand(event.target.value)} /><small>Runs with your user permissions. No shell expansion. Install any required runtime yourself; CIQ will not request an admin password.</small></label>}{error && <p className="inline-error" role="alert">{error}</p>}<div className="button-row"><Button onClick={close}>Cancel</Button><Button primary type="submit" disabled={working}><Plus size={16} />{working ? 'Saving…' : 'Save server'}</Button></div></form></Modal>
}

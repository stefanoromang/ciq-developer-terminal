import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUp, ArrowClockwise, ArrowSquareOut, Archive, Brain, CaretDown, CaretRight,
  ChatCircle, Check, CheckCircle, Circle, Code, Command, Cube, Folder, FolderOpen, FolderPlus,
  GearSix, GitBranch, Key, Lightning, MagnifyingGlass, PencilSimple, PlugsConnected, Plus, ShieldCheck,
  SidebarSimple, Sparkle, Square, TerminalWindow, Trash, X,
} from '@phosphor-icons/react'
import { bridge, isDesktop } from './bridge'
import { AgentQuestion, Mark, MessageView, Modal } from './components'
import type { AgentForm, McpStatus, Message, Permission, Workspace } from './types'

type Page = 'chat' | 'connections' | 'memory' | 'models' | 'settings'
const empty: Workspace = { projects: [], connected: false, secureStorage: false, models: [], selectedModel: '', cadence: 'daily', lastRefresh: 0, toolsConfirmed: false, mcps: [], gateway: '' }
const titles: Record<Page, string> = { chat: 'Workspace', connections: 'MCP connections', memory: 'Project memory', models: 'Model library', settings: 'Settings' }

function niceError(error: unknown) { return String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '') }
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
  const [search, setSearch] = useState('')
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const stateRef = useRef(state)
  stateRef.current = state
  const project = state.projects.find(p => p.id === state.activeProjectID && !p.closed)
  const session = project?.sessions.find(s => s.id === project.activeSessionID && !s.archived)
  const activeRef = useRef({ projectID: project?.id, sessionID: session?.id })
  activeRef.current = { projectID: project?.id, sessionID: session?.id }
  const currentModel = session?.model || state.selectedModel
  const model = state.models.find(m => m.id === currentModel)
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
  const refreshConversation = useCallback(async () => {
    const selected = { ...activeRef.current }
    if (!selected.sessionID) return
    const result = await bridge.invoke('session.messages', selected)
    if (activeRef.current.sessionID !== selected.sessionID) return
    setMessages([...(result.data || [])].reverse())
    setBusy(value => ({ ...value, [selected.sessionID!]: result.active === true }))
    setOlderCursor(result.cursor?.next || null)
    const [perms, questions] = await Promise.all([
      bridge.invoke('permission.list', selected), bridge.invoke('form.list', selected),
    ])
    if (activeRef.current.sessionID !== selected.sessionID) return
    setPermissions(perms.data || [])
    setForms(questions.data || [])
  }, [])

  useEffect(() => {
    void bridge.invoke('state').then(next => { setState(next); setReady(true); if (isDesktop && !next.connected) setOnboarding(true) }).catch(e => { setError(niceError(e)); setReady(true) })
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = bridge.onEvent(event => {
      if (event.type === 'ciq.state') { setState(event.data as Workspace); return }
      if (['ciq.engine.error', 'ciq.refresh.error'].includes(event.type)) { setError(event.data.message); return }
      if (event.type === 'session.execution.started') setBusy(b => ({ ...b, [event.data.sessionID]: true }))
      if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted', 'session.idle'].includes(event.type)) setBusy(b => ({ ...b, [event.data.sessionID]: false }))
      if (event.type === 'session.status') setBusy(b => ({ ...b, [event.data.sessionID]: event.data.status?.type !== 'idle' }))
      if (event.type === 'session.execution.failed' && event.data.sessionID === activeRef.current.sessionID) setError(event.data.error?.message || 'The model request failed.')
      if (event.data.sessionID === activeRef.current.sessionID || ['server.connected', 'mcp.status.changed'].includes(event.type)) {
        if (!timer) timer = setTimeout(() => { timer = undefined; void refreshConversation().catch(e => setError(niceError(e))) }, 250)
      }
    })
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [refreshConversation])
  useEffect(() => {
    setMessages([]); setPermissions([]); setForms([]); setOlderCursor(null)
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
    const load = () => bridge.invoke('mcp.list', { projectID: project.id }).then(result => setMcpStatuses(result.data || [])).catch(e => setError(niceError(e)))
    void load()
    const timer = setInterval(() => { void load() }, 4000)
    return () => clearInterval(timer)
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
        if (result.status && result.status !== 'running') setTerminalRun(null)
      } catch (e) { if (!disposed) { setError(niceError(e)); setTerminalRun(null) } }
      finally { loading = false }
    }
    void load()
    const timer = setInterval(() => { void load() }, 600)
    return () => { disposed = true; clearInterval(timer) }
  }, [terminalRun])

  const openProject = () => void run(() => callState('project.open'))
  const createSession = async () => {
    if (!state.connected) { setOnboarding(true); return }
    if (!project) { openProject(); return }
    await run(async () => { await callState('session.create', { projectID: project.id }); setPage('chat'); setPrompt(''); promptRef.current?.focus() })
  }
  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!prompt.trim() || pending || isBusy) return
    if (!state.connected) { setOnboarding(true); return }
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
        {state.projects.filter(p => !p.closed).length === 0 ? <button className="open-project-blank" onClick={openProject}><FolderPlus size={21} /><span>Open your first project<small>A folder. A fresh workspace.</small></span><Plus size={15} /></button>
        : state.projects.filter(p => !p.closed).map(p => <div className={`project-tree ${project?.id === p.id ? 'selected' : ''}`} key={p.id}>
          <div className="project-row"><button className="project-select" title={p.directory} onClick={() => void run(async () => { await callState('project.select', { projectID: p.id }); setPage('chat') })}>{project?.id === p.id ? <CaretDown size={13} /> : <CaretRight size={13} />}<Folder size={17} /><span>{p.name}</span></button><button className="icon-button project-close" aria-label={`Close ${p.name}`} onClick={() => void run(() => callState('project.close', { projectID: p.id }))}><X size={13} /></button></div>
          {project?.id === p.id && <div className="session-tree">{p.sessions.filter(s => !s.archived).map(s => <button className={session?.id === s.id ? 'active' : ''} key={s.id} onClick={() => void run(async () => { await callState('session.select', { projectID: p.id, sessionID: s.id }); setPage('chat') })}><span className={`session-dot ${busy[s.id] ? 'good' : ''}`} /><span>{s.title}</span></button>)}<button className="tree-new" onClick={() => void createSession()}><Plus size={13} />New conversation</button></div>}
        </div>)}
      </div>
      <div className="sidebar-bottom">
        <div className={`gateway-card ${state.connected ? 'connected' : ''}`}><div className="gateway-card-top"><span className={`status-dot ${state.connected ? 'good' : ''}`} /><span>CollectivIQ Gateway</span><ShieldCheck size={15} /></div><p>{state.connected ? `${state.models.length} models · one API key` : 'Your models. One API key.'}</p><button onClick={() => state.connected ? choosePage('models') : setOnboarding(true)}>{state.connected ? 'Manage models' : 'Connect Developer API key'}<ArrowRight size={15} /></button></div>
        <button className={`settings-link ${page === 'settings' ? 'active' : ''}`} onClick={() => choosePage('settings')}><GearSix size={19} /><span>Settings</span><kbd>⌘ ,</kbd></button>
        <div className="sidebar-signoff"><Mark /><span>BY STEFANO ROMAN GUNNESS</span><span>0.1</span></div>
      </div>
    </aside>
    {sidebar && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <main className="main">
      <header className="topbar"><div className="breadcrumb">{!sidebar && <button className="icon-button" aria-label="Open sidebar" onClick={() => setSidebar(true)}><SidebarSimple size={20} /></button>}<TerminalWindow size={17} /><span>{project?.name || 'Your workspace'}</span><span className="breadcrumb-slash">/</span><strong>{page === 'chat' && session ? session.title : titles[page]}</strong></div><div className="topbar-actions">{!isDesktop && <span className="preview-label">UI preview · desktop features unavailable</span>}<button className="icon-button" title="Search workspace" aria-label="Search workspace" onClick={() => setSearchModal(true)}><MagnifyingGlass size={18} /></button><button className={`icon-button ${terminal ? 'selected-icon' : ''}`} aria-label="Toggle command terminal" title="Command terminal" onClick={() => setTerminal(value => !value)}><TerminalWindow size={19} /></button></div></header>
      {error && <div className="alert error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="alert notice" role="status"><CheckCircle size={18} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {!ready ? <div className="loading-state"><Mark /><p>Opening your workspace…</p></div> : page === 'chat' ? <>
        <div className="conversation-scroll" ref={scrollRef} onScroll={() => { const element = scrollRef.current; if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120 }}>
          {!messages.length ? <div className="welcome"><div className="welcome-eyebrow"><span className="tiny-line" />YOUR NEXT IDEA STARTS HERE</div><div className="welcome-logo"><Mark /><span className="welcome-terminal"><Code size={24} /></span></div>
            <h1>Good ideas deserve<br /><span>great company.</span></h1><p className="welcome-description">Your code, your context, your choice of AI.<br />One workspace. Built around you.</p>
            <div className="welcome-project"><FolderOpen size={16} /><span>{project ? project.name : 'Start with a project folder'}</span>{project ? <span className="tag">LOCAL</span> : <button onClick={openProject}>Open project<ArrowRight size={14} /></button>}</div>
            <div className="starter-grid"><button onClick={() => promptStarter('Explore this codebase. Explain its architecture, entry points, and how to run it. Do not change files.')}><Code size={21} /><strong>Understand a codebase</strong><span>Find your way around a new project.</span><ArrowUp size={15} /></button><button onClick={() => promptStarter('Help me plan a new feature for this project. First ask what I want to build, then propose an implementation plan.')}><Sparkle size={21} /><strong>Build something new</strong><span>Turn an idea into your next feature.</span><ArrowUp size={15} /></button><button onClick={() => promptStarter('Review the current project changes for bugs, security issues, and missing tests. Explain findings before editing anything.')}><GitBranch size={21} /><strong>Review your changes</strong><span>A second perspective on your work.</span><ArrowUp size={15} /></button></div>
          </div> : <div className="message-list">{olderCursor && <button className="load-older" disabled={pending} onClick={() => void run(async () => { const result = await bridge.invoke('session.messages', { projectID: project?.id, sessionID: session?.id, cursor: olderCursor }); pinned.current = false; setMessages(value => [...result.data.reverse(), ...value]); setOlderCursor(result.cursor?.next || null) })}>Load earlier messages</button>}
            <div className="conversation-title"><span>{session?.created ? relativeDate(session.created) : 'Conversation'}</span><div><button className="icon-button" aria-label="Rename conversation" onClick={() => { setRenameTitle(session?.title || ''); setRename(true) }}><PencilSimple size={16} /></button><button className="icon-button" aria-label="Archive conversation" onClick={() => void run(() => callState('session.archive', { projectID: project?.id, sessionID: session?.id }))}><Archive size={16} /></button></div></div>
            {messages.filter(m => ['user', 'assistant', 'synthetic', 'compaction'].includes(m.type)).map(message => message.type === 'synthetic' || message.type === 'compaction' ? <div className="timeline-note" key={message.id}>{message.type === 'compaction' ? 'Conversation context compacted' : 'Project context added'}</div> : <MessageView message={message} key={message.id} />)}
            {isBusy && <div className="working-status" role="status"><Lightning size={16} />CIQ is working<span /> <button onClick={() => void run(() => bridge.invoke('session.interrupt', { projectID: project?.id, sessionID: session?.id }))}>Stop</button></div>}
            {permissions.map(permission => <div key={permission.id} className="permission-card"><div><ShieldCheck size={23} /><div><h3>Permission needed</h3><p>{permission.message || `Allow ${permission.action}?`}</p></div></div><pre>{permission.resources.join('\n')}</pre><div className="button-row"><Button disabled={pending} onClick={() => void run(async () => { await bridge.invoke('permission.reply', { projectID: project?.id, sessionID: session?.id, requestID: permission.id, decision: 'reject' }); await refreshConversation() })}>Reject</Button><Button primary disabled={pending} onClick={() => void run(async () => { await bridge.invoke('permission.reply', { projectID: project?.id, sessionID: session?.id, requestID: permission.id, decision: 'once' }); await refreshConversation() })}><Check size={15} />Allow once</Button></div></div>)}
            {forms.map(form => <AgentQuestion key={form.id} form={form} answer={answer => void run(async () => { await bridge.invoke('form.reply', { projectID: project?.id, sessionID: session?.id, formID: form.id, answer }); await refreshConversation() })} cancel={() => void run(async () => { await bridge.invoke('form.cancel', { projectID: project?.id, sessionID: session?.id, formID: form.id }); await refreshConversation() })} />)}
          </div>}
        </div>
        <div className="composer-area"><form className="composer" onSubmit={send}><textarea ref={promptRef} aria-label="Message CIQ" placeholder={project ? `What would you like to build in ${project.name}?` : 'Ask, build, or explore something…'} value={prompt} rows={2} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} /><div className="composer-toolbar"><div className="composer-options"><label className="mode-select"><Code size={16} /><select aria-label="Agent mode" value={agent} disabled={isBusy || pending} onChange={event => setAgent(event.target.value as 'plan' | 'build')}><option value="build">Build</option><option value="plan">Plan</option></select></label><span className="toolbar-divider" /><button type="button" className="model-button" onClick={() => choosePage('models')}><span className="model-symbol"><Sparkle size={14} /></span><span>{model?.name || (currentModel ? currentModel : 'Choose a model')}</span><CaretDown size={12} /></button></div><div className="composer-send"><span className="enter-hint">↵ to send</span>{isBusy ? <button type="button" className="send-button stop" aria-label="Stop generation" onClick={() => void run(() => bridge.invoke('session.interrupt', { projectID: project?.id, sessionID: session?.id }))}><Square size={16} weight="fill" /></button> : <button className="send-button" type="submit" aria-label="Send message" disabled={!prompt.trim() || pending}><ArrowUp size={21} weight="bold" /></button>}</div></div></form><div className="composer-footnote"><span><ShieldCheck size={12} />{project?.memoryEnabled && project.memory ? 'Project notes included' : 'Tools ask for your permission'}</span><span>Shift + Enter for a new line</span></div></div>
      </> : <div className="page-scroll"><div className="settings-page"><div className="page-heading"><div className="eyebrow">YOUR WORKSPACE, YOUR WAY</div><h1>{titles[page]}</h1><p>{page === 'connections' ? 'Give your AI the right tools. Keep every connection in sight.' : page === 'memory' ? 'Less repeating yourself. More picking up where you left off.' : page === 'models' ? 'All the models your key can access. No provider juggling.' : 'A few thoughtful defaults. Nothing between you and your work.'}</p></div>
        {page === 'connections' && <><div className="section-toolbar"><span>{state.mcps.length} configured server{state.mcps.length === 1 ? '' : 's'}</span><Button primary onClick={() => setMcpModal(true)}><Plus size={16} />Add MCP server</Button></div><div className="info-strip"><ShieldCheck size={18} /><span>New servers start disconnected. Connecting a local server runs its command on your computer. Review it first.</span></div>
          {!state.mcps.length ? <div className="empty-panel"><PlugsConnected size={42} weight="light" /><h2>A connection makes it possible.</h2><p>Add an MCP server to bring documentation, files, and services into your workflow.</p><Button onClick={() => setMcpModal(true)}><Plus size={16} />Add your first server</Button></div> : <div className="list-panel">{state.mcps.map(mcp => {
            const status = mcpStatuses.find(s => s.name === mcp.name)
            const label = !project ? 'Open a project to check status' : status?.status.status || (mcp.config.disabled ? 'disconnected' : 'checking')
            return <div className="connection-row" key={mcp.name}><div className="connection-icon"><PlugsConnected size={23} /></div><div className="connection-info"><strong>{mcp.name}</strong><code>{mcp.config.url || mcp.config.command?.join(' ')}</code><span className="connection-status"><span className={`status-dot ${label === 'connected' ? 'good' : ''}`} />{label.replaceAll('_', ' ')}{status?.status.error && ` · ${status.status.error}`}</span></div><div className="connection-actions">{label === 'needs_auth' && status?.integrationID && <Button disabled={pending} onClick={() => void run(async () => { const result = await bridge.invoke('mcp.auth', { projectID: project?.id, integrationID: status.integrationID }); setOauth({ ...result.data, integrationID: status.integrationID!, projectID: project!.id }) })}><Key size={14} />Sign in</Button>}<Button disabled={!project || pending} onClick={() => void run(() => callState('mcp.toggle', { projectID: project?.id, name: mcp.name, enabled: mcp.config.disabled !== false }))}>{mcp.config.disabled !== false ? 'Connect' : 'Disconnect'}</Button><button className="icon-button" aria-label={`Remove ${mcp.name}`} disabled={pending} onClick={() => void run(() => callState('mcp.remove', { name: mcp.name }))}><Trash size={17} /></button></div></div>
          })}</div>}<div className="quiet-note"><PlugsConnected size={16} />Remote servers use OAuth when available. No secrets in project files.<button onClick={() => void bridge.invoke('external.open', { url: 'https://modelcontextprotocol.io/introduction' })}>About MCP<ArrowSquareOut size={13} /></button></div></>}
        {page === 'memory' && (!project ? <div className="empty-panel"><Brain size={44} weight="light" /><h2>Every project gets its own context.</h2><p>Open a project to save decisions, coding conventions, and useful notes.</p><Button primary onClick={openProject}><FolderOpen size={17} />Open a project</Button></div> : <><div className="memory-project"><div className="connection-icon"><Folder size={23} /></div><div><strong>{project.name}</strong><code>{project.directory}</code></div><label className="toggle-label"><input type="checkbox" checked={memoryEnabled} onChange={event => setMemoryEnabled(event.target.checked)} /><span>Include in prompts</span></label></div><label className="field memory-field"><span>Project notes</span><textarea value={memory} maxLength={16_000} onChange={event => setMemory(event.target.value)} placeholder={'What should CIQ remember about this project?\n\nArchitecture decisions, preferred tools, coding conventions, or the next thing to work on.'} /><small>{memory.length.toLocaleString()} / 16,000 characters · Saved locally, separate from your repository</small></label><div className="button-row"><Button primary disabled={pending} onClick={() => void run(async () => { await callState('memory.save', { projectID: project.id, memory, enabled: memoryEnabled }); setNotice('Project notes saved.') })}><Check size={16} />Save project notes</Button></div><div className="info-strip"><Brain size={19} /><span>These are explicit notes you control—not hidden automatic memory. When enabled, they are sent to your selected model with each new prompt for this project. Conversation history is stored by the local engine.</span></div></>)}
        {page === 'models' && <><div className="model-summary"><div><span className={`status-dot ${state.connected ? 'good' : ''}`} /><strong>CollectivIQ Gateway</strong><span className="tag">{state.models.length} MODELS</span></div><Button disabled={pending || !state.connected} onClick={() => void run(async () => { await callState('models.refresh'); setNotice('Model catalog refreshed. Existing conversations keep their selected model.') })}><ArrowClockwise size={16} />Refresh models</Button></div>
          <div className="refresh-row"><div><strong>Keep your options current</strong><p>Checks run while CIQ is open, with catch-up on next launch.</p></div><select aria-label="Model refresh schedule" value={state.cadence} onChange={event => void run(() => callState('settings.save', { cadence: event.target.value }))}><option value="daily">Check daily</option><option value="weekly">Check weekly</option><option value="manual">Manual only</option></select></div>
          {!state.connected ? <div className="empty-panel"><Cube size={44} weight="light" /><h2>One key. Your entire model lineup.</h2><p>Connect your Developer/Gateway key to load the real catalog available to your account.</p><Button primary onClick={() => setOnboarding(true)}><Key size={16} />Connect CollectivIQ</Button></div> : <><label className="model-search"><MagnifyingGlass size={18} /><input aria-label="Search models" placeholder="Search models by name or provider…" value={modelSearch} onChange={event => setModelSearch(event.target.value)} /><kbd>{state.models.length}</kbd></label><div className="model-list">{state.models.filter(m => `${m.id} ${m.name} ${m.provider}`.toLowerCase().includes(modelSearch.toLowerCase())).map(m => <button key={m.id} className={`model-row ${currentModel === m.id ? 'selected' : ''}`} disabled={isBusy || pending} onClick={() => void selectModel(m.id)}><div className="model-icon"><Cube size={21} /></div><div><strong>{m.name}{state.newModels?.includes(m.id) && <span className="tag new">NEW</span>}</strong><code>{m.id}</code><span>{m.provider}{m.context ? ` · ${(m.context / 1000).toLocaleString()}k context` : ''} · {m.tools === true ? 'Tool support declared' : m.tools === false ? 'Chat only' : 'Tool support not declared'}</span></div><span className="model-radio">{currentModel === m.id ? <CheckCircle size={22} weight="fill" /> : <Circle size={22} />}</span></button>)}</div>{state.models.filter(m => `${m.id} ${m.name} ${m.provider}`.toLowerCase().includes(modelSearch.toLowerCase())).length === 0 && <p className="muted">No matching models.</p>}<div className="quiet-note">{state.lastRefresh ? `Last checked ${new Date(state.lastRefresh).toLocaleString()}` : 'Not checked yet'}<span>Selections never change automatically.</span></div></>}
          <div className="info-strip"><Sparkle size={18} /><span>“Best of the Best” is available only if your gateway catalog exposes a corresponding model. CIQ never invents a model or claims a single-model response is consensus.</span></div></>}
        {page === 'settings' && <><section className="settings-section"><h2>Account & credentials</h2><div className="settings-card"><div className="setting-row"><div className="setting-icon"><Key size={21} /></div><div><strong>CollectivIQ Developer API key</strong><p>{state.connected ? 'Connected. Your key is never shown in the chat interface.' : 'The only required credential. No separate LLM keys.'}</p></div><Button onClick={() => setOnboarding(true)}>{state.connected ? 'Replace key' : 'Connect key'}</Button></div>{state.connected && <div className="setting-row"><div className="setting-icon"><ShieldCheck size={21} /></div><div><strong>Disconnect this account</strong><p>Removes the stored key. Local projects and conversations stay intact.</p></div><Button disabled={pending} onClick={() => void run(() => callState('key.disconnect'))}>Disconnect</Button></div>}</div></section>
          <section className="settings-section"><h2>Model tools</h2><div className="settings-card"><label className="setting-row toggle-setting"><div className="setting-icon"><Code size={21} /></div><div><strong>Enable tools for models with unknown capability</strong><p>Only enable if your gateway supports OpenAI tool calls. Unsupported models may reject requests; declared chat-only models remain chat-only.</p></div><input type="checkbox" checked={state.toolsConfirmed} onChange={event => void run(() => callState('settings.save', { toolsConfirmed: event.target.checked }))} /></label></div></section>
          <section className="settings-section"><h2>Privacy by design</h2><div className="settings-card privacy-grid"><div><ShieldCheck size={23} /><strong>Local workspace</strong><p>Notes and conversation history stay on this computer. Prompts and required context go to your selected gateway model.</p></div><div><Key size={23} /><strong>{state.secureStorage ? 'OS-protected credentials' : 'Session-only available'}</strong><p>{state.secureStorage ? 'Saved keys are encrypted using Electron safeStorage backed by the operating system.' : 'Secure OS storage is unavailable. Use a session-only key; no plaintext fallback.'}</p></div></div></section>
          <section className="settings-section"><h2>Keyboard shortcuts</h2><div className="settings-card keyboard-list"><div><span>Search projects and conversations</span><kbd>⌘ / Ctrl K</kbd></div><div><span>Open project folder</span><kbd>⌘ / Ctrl Shift O</kbd></div><div><span>Toggle sidebar</span><kbd>⌘ / Ctrl \</kbd></div><div><span>Open settings</span><kbd>⌘ / Ctrl ,</kbd></div><div><span>Send prompt</span><kbd>Enter</kbd></div></div></section><div className="about-ciq"><Mark /><div><strong>CIQ Developer Terminal <span className="tag">0.1.2 PREVIEW</span></strong><p className="creator-credit">Created by Stefano Roman Gunness.</p><p>An independently designed CIQ interface, powered by the MIT-licensed OpenCode engine. Not an official OpenCode or CollectivIQ distribution.</p><div className="attribution-links"><button onClick={() => void bridge.invoke('external.open', { url: 'https://github.com/stefanoromang/ciq-developer-terminal' })}>Project source<ArrowSquareOut size={12} /></button><button onClick={() => void bridge.invoke('external.open', { url: 'https://github.com/anomalyco/opencode' })}>Read the original OpenCode source<ArrowSquareOut size={12} /></button><button onClick={() => void bridge.invoke('external.open', { url: 'https://opencode.ai/v2/docs/' })}>OpenCode documentation<ArrowSquareOut size={12} /></button></div></div></div></>}
      </div></div>}
      {terminal && <section className="terminal-panel" aria-label="Command terminal"><div className="terminal-heading"><span><TerminalWindow size={15} />COMMAND TERMINAL<span className="terminal-directory">{project?.name || 'No project'}</span></span><div>{terminalRun && <button className="icon-button" aria-label="Stop command" onClick={() => void run(async () => { await bridge.invoke('shell.stop', { projectID: terminalRun.projectID, shellID: terminalRun.id }); setTerminalRun(null) })}><Square size={13} /></button>}<button className="icon-button" aria-label="Clear terminal output" onClick={() => setTerminalOutput('')}><Trash size={14} /></button><button className="icon-button" aria-label="Close terminal" onClick={() => setTerminal(false)}><X size={15} /></button></div></div><pre className="terminal-output">{terminalOutput || 'Commands you run here execute locally in the selected project. Interactive programs are not supported in this preview.'}</pre><form onSubmit={event => { event.preventDefault(); if (!project || terminalRun) return; void run(async () => { setTerminalOutput(value => value + `\n❯ ${terminalCommand}\n`); const result = await bridge.invoke('shell.run', { projectID: project.id, command: terminalCommand }); setTerminalRun({ id: result.data.id, projectID: project.id }); setTerminalCommand('') }) }}><span>❯</span><input aria-label="Local shell command" placeholder={project ? 'Enter a command and press Return to run…' : 'Open a project to run commands'} disabled={!project || Boolean(terminalRun)} value={terminalCommand} onChange={event => setTerminalCommand(event.target.value)} /><button aria-label="Run shell command" disabled={!project || !terminalCommand.trim() || Boolean(terminalRun)}><ArrowRight size={16} /></button></form></section>}
      <footer className="statusbar"><span><span className={`status-dot ${state.connected ? 'good' : ''}`} />{state.connected ? 'Gateway connected' : 'Connect your gateway to get started'}</span><div>{project && <span><Folder size={12} />{project.name}</span>}<span><ShieldCheck size={12} />Local workspace</span><span className="status-ciq">CIQ</span></div></footer>
    </main>
    {onboarding && <KeyOnboarding state={state} close={() => setOnboarding(false)} connect={async payload => { await callState('key.connect', payload); setOnboarding(false); setNotice('Gateway connected. Your available models are ready.'); setPage('models') }} />}
    {mcpModal && <McpDialog close={() => setMcpModal(false)} save={async payload => { await callState('mcp.add', payload); setMcpModal(false); setNotice('MCP server saved. Review it, then connect when ready.') }} />}
    {searchModal && <Modal title="Find your next conversation" close={() => setSearchModal(false)}><label className="model-search modal-search"><MagnifyingGlass size={19} /><input autoFocus aria-label="Search workspace" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search projects and conversations…" /></label><div className="search-results">{state.projects.filter(p => !p.closed).map(p => <div key={p.id}><button onClick={() => void run(async () => { await callState('project.select', { projectID: p.id }); setPage('chat'); setSearchModal(false) })}><Folder size={18} /><span>{p.name}</span><ArrowRight size={15} /></button>{p.sessions.filter(s => !s.archived && `${s.title} ${p.name}`.toLowerCase().includes(search.toLowerCase())).map(s => <button key={s.id} className="search-session" onClick={() => void run(async () => { await callState('project.select', { projectID: p.id }); await callState('session.select', { projectID: p.id, sessionID: s.id }); setPage('chat'); setSearchModal(false) })}><ChatCircle size={17} /><span>{s.title}</span><small>{p.name}</small></button>)}</div>)}{!state.projects.some(p => !p.closed) && <p className="muted search-empty">Open a project to start building your workspace.</p>}</div><Button onClick={() => { setSearchModal(false); openProject() }}><FolderPlus size={17} />Open another project</Button></Modal>}
    {rename && <Modal title="Rename conversation" close={() => setRename(false)}><form onSubmit={event => { event.preventDefault(); void run(async () => { await callState('session.rename', { projectID: project?.id, sessionID: session?.id, title: renameTitle }); setRename(false) }) }}><label className="field"><span>Conversation name</span><input autoFocus required maxLength={140} value={renameTitle} onChange={event => setRenameTitle(event.target.value)} /></label><Button primary type="submit">Save name</Button></form></Modal>}
    {oauth && <Modal title="Sign in to your MCP server" close={() => setOauth(null)}><p className="muted">{oauth.instructions}</p><Button primary onClick={() => void bridge.invoke('external.open', { url: oauth.url })}><ArrowSquareOut size={16} />Open sign-in page</Button><p className="quiet-note">Waiting for authorization. This app does not ask for your server password.</p>{(oauth.mode === 'code' || oauth.paste) && <form onSubmit={event => { event.preventDefault(); void run(() => bridge.invoke('mcp.authComplete', { ...oauth, code: oauthCode })) }}><label className="field"><span>Authorization code or callback URL</span><input required value={oauthCode} onChange={event => setOauthCode(event.target.value)} /></label><Button type="submit">Complete sign-in</Button></form>}</Modal>}
  </div>
}

function KeyOnboarding({ state, close, connect }: { state: Workspace; close: () => void; connect: (payload: Record<string, unknown>) => Promise<void> }) {
  const [key, setKey] = useState(''), [type, setType] = useState('developer'), [remember, setRemember] = useState(state.secureStorage), [tools, setTools] = useState(state.toolsConfirmed), [error, setError] = useState(''), [working, setWorking] = useState(false)
  return <Modal title="Your AI starts with one key." close={() => { if (!working) close() }}><div className="onboarding-brand"><Mark /><span>COLLECTIVIQ × YOUR WORKSPACE</span></div><p className="modal-description">Connect once. Get the models available to your account, all in one place.</p><form onSubmit={async event => { event.preventDefault(); setError(''); setWorking(true); try { await connect({ key, type, remember, toolsConfirmed: tools }); setKey('') } catch (e) { setError(niceError(e)) } finally { setWorking(false) } }}>
    <label className="field"><span>Which CollectivIQ key are you adding?</span><select value={type} onChange={event => setType(event.target.value)}><option value="developer">Developer / Gateway API key — model access</option><option value="standard">Standard API key — platform data</option></select></label>
    {type === 'standard' ? <div className="inline-warning"><Key size={20} /><p>Standard keys are for threads, messages and files. To use LLMs here, create a <strong>Developer/Gateway key</strong> in CollectivIQ → Settings → Developer Access.</p></div> : <><label className="field"><span>Developer API key</span><input type="password" autoComplete="off" spellCheck={false} required value={key} onChange={event => setKey(event.target.value)} placeholder="Paste your CollectivIQ Developer API key" /><small>Sent only to the official CollectivIQ gateway. Never included in prompts.</small></label><div className="endpoint-display"><ShieldCheck size={15} /><code>api.prod.collectiviq.ai/v1</code><span>OFFICIAL GATEWAY</span></div><label className="checkbox-row"><input type="checkbox" disabled={!state.secureStorage} checked={remember} onChange={event => setRemember(event.target.checked)} /><span>{state.secureStorage ? 'Remember securely on this computer' : 'Session-only key (secure OS storage unavailable)'}</span></label><label className="checkbox-row tools-consent"><input type="checkbox" checked={tools} onChange={event => setTools(event.target.checked)} /><span>My gateway models support OpenAI tool calls<small>Enable coding tools when the catalog does not declare support. You can change this in Settings.</small></span></label></>}
    {error && <p className="inline-error" role="alert">{error}</p>}<Button primary type="submit" disabled={working || type !== 'developer' || !key.trim()} className="connect-button">{working ? 'Checking key & loading models…' : 'Connect & discover models'}{!working && <ArrowRight size={17} />}</Button>
    <p className="key-help">Looking for Best of the Best? It will appear if your gateway offers it. No extra provider keys required.</p><button type="button" className="text-button browse-button" disabled={working} onClick={close}>Explore the workspace first</button>
  </form></Modal>
}

function McpDialog({ close, save }: { close: () => void; save: (payload: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(''), [type, setType] = useState('remote'), [url, setUrl] = useState(''), [command, setCommand] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false)
  return <Modal title="A new connection." close={close}><p className="modal-description">Add a tool server to your workspace. It stays disconnected until you choose to connect.</p><form onSubmit={async event => { event.preventDefault(); setWorking(true); setError(''); try { await save({ name, type, url, command }) } catch (e) { setError(niceError(e)) } finally { setWorking(false) } }}><label className="field"><span>Server name</span><input autoFocus required pattern="[a-zA-Z0-9_-]{1,60}" placeholder="e.g. project-docs" value={name} onChange={event => setName(event.target.value)} /></label><div className="segmented-control"><button type="button" className={type === 'remote' ? 'active' : ''} onClick={() => setType('remote')}><PlugsConnected size={16} />Remote URL</button><button type="button" className={type === 'local' ? 'active' : ''} onClick={() => setType('local')}><TerminalWindow size={16} />Local command</button></div>{type === 'remote' ? <label className="field"><span>MCP server URL</span><input type="url" required placeholder="https://your-server.example/mcp" value={url} onChange={event => setUrl(event.target.value)} /><small>Streamable HTTP. OAuth sign-in is offered when the server supports it.</small></label> : <label className="field"><span>Executable and arguments (JSON array)</span><textarea required placeholder={'["npx", "-y", "your-mcp-server"]'} value={command} onChange={event => setCommand(event.target.value)} /><small>Runs with your user permissions. No shell expansion. Install any required runtime yourself; CIQ will not request an admin password.</small></label>}{error && <p className="inline-error" role="alert">{error}</p>}<div className="button-row"><Button onClick={close}>Cancel</Button><Button primary type="submit" disabled={working}><Plus size={16} />{working ? 'Saving…' : 'Save server'}</Button></div></form></Modal>
}

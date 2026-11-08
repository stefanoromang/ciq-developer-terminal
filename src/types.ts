export type Model = { id: string; providerID: string; name: string; provider: string; tools: boolean | null; context: number | null; free?: boolean }
export type Session = { id: string; title: string; model: string; created: number; archived?: boolean }
export type Project = { id: string; name: string; directory: string; memory: string; memoryEnabled: boolean; sessions: Session[]; activeSessionID?: string; closed?: boolean }
export type Mcp = { name: string; config: { type: 'local' | 'remote'; url?: string; command?: string[]; disabled?: boolean } }
export type ProviderConnection = { id: string; name: string; env: string[]; connected: boolean; credentialStatus: 'saved' | 'session' | 'missing' | 'unavailable' }
export type ProviderOption = { id: string; name: string; env: string[]; connected: boolean }
export type UpdateInfo = {
  currentVersion: string; lastCheck: number; intervalDays: number; skippedVersion: string; autoDownload: boolean
  downloading: boolean; progress: number; ready: boolean; installing: boolean; error: string
  downloaded: { version: string; file: string; sha256: string; size: number } | null
  latest: null | { version: string; tag: string; notes: string; publishedAt: string; page: string; install: string; asset: { name: string; url: string; size: number } }
}
export type Workspace = {
  projects: Project[]; activeProjectID?: string; connected: boolean; secureStorage: boolean; models: Model[]; selectedModel: string
  cadence: 'daily' | 'weekly' | 'manual'; lastRefresh: number; toolsConfirmed: boolean; mcps: Mcp[]; newModels?: string[]
  gateway: string; freeProvider: string; freeEnabled: boolean; modelsAvailable: boolean; providers: ProviderConnection[]; updates: UpdateInfo; credentialStatus?: string
}
export type Content = { type: string; text?: string; name?: string; id?: string; state?: { status: string; input?: unknown; content?: { type: string; text?: string }[]; error?: string } }
export type Message = { id: string; type: string; text?: string; metadata?: { ciqDisplayText?: string }; content?: Content[]; model?: { id: string }; error?: { message?: string }; time?: { created: number } }
export type Permission = { id: string; sessionID: string; action: string; resources: string[]; message?: string }
export type Field = { key: string; type: string; title?: string; description?: string; required?: boolean; hidden?: boolean; options?: { label: string; value: string }[]; default?: string | boolean | string[] | number; when?: { key: string; op: 'eq' | 'neq'; value: unknown }[] }
export type AgentForm = { id: string; title: string; sessionID: string; fields: Field[] }
export type Event = { type: string; data: Record<string, any> }
export type McpStatus = { name: string; status: { status: string; error?: string; message?: string }; integrationID?: string }
export type Bridge = { invoke: (command: string, payload?: Record<string, unknown>) => Promise<any>; onEvent: (callback: (event: Event) => void) => () => void }
declare global { interface Window { ciq?: Bridge } }

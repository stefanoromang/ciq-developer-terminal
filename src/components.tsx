import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowSquareOut, Check, Copy, X } from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import { bridge } from './bridge'
import { errorMessage } from './errors'
import type { AgentForm, Message } from './types'

export function Mark({ className = '' }: { className?: string }) {
  return <img className={`ciq-mark ${className}`} src="./brand/ciq-mark.svg" alt="CollectivIQ" />
}

export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { dialog.current?.close(); previous?.focus() }
  }, [])
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === dialog.current) close() }} aria-labelledby="dialog-title">
    <div className="modal-inner"><div className="modal-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={18} /></button></div>{children}</div>
  </dialog>
}

export function Markdown({ text }: { text: string }) {
  return <ReactMarkdown components={{
    a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href && /^https?:\/\//.test(href)) void bridge.invoke('external.open', { url: href }) }}>{children}<ArrowSquareOut size={12} /></a>,
    img: ({ alt }) => <span className="muted">[Image: {alt || 'image'} — remote images are not loaded]</span>,
  }}>{text}</ReactMarkdown>
}

export function MessageView({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false)
  const content = message.type === 'user' ? message.metadata?.ciqDisplayText || message.text || '' : (message.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n')
  return <article className={`message ${message.type}`}>
    <div className="message-avatar">{message.type === 'user' ? <span>Y</span> : <Mark />}</div>
    <div className="message-body"><div className="message-heading"><strong>{message.type === 'user' ? 'You' : 'CIQ'}</strong>{message.type !== 'user' && <span>{message.model?.id}</span>}
      {content && <button className="icon-button copy-message" aria-label="Copy message" onClick={async () => { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>}
    </div>
    {content && <div className="markdown"><Markdown text={content} /></div>}
    {message.content?.filter(c => c.type === 'reasoning').map((c, i) => <details key={`reason-${i}`} className="tool-call"><summary>Reasoning</summary><div className="markdown"><Markdown text={c.text || ''} /></div></details>)}
    {message.content?.filter(c => c.type === 'tool').map((c, i) => <details key={c.id || i} className="tool-call"><summary><span className={`status-dot ${c.state?.status === 'completed' ? 'good' : ''}`} /><code>{c.name}</code><span className="muted">{c.state?.status}</span></summary><pre>{JSON.stringify(c.state?.input, null, 2)}</pre>{c.state?.content?.map((part, j) => <pre key={j}>{part.text || `[${part.type}]`}</pre>)}{c.state?.error && <p className="error-text">{errorMessage(c.state.error, 'The tool request failed.')}</p>}</details>)}
    {message.error && <p className="error-text">{errorMessage(message.error, 'The model request failed.')}</p>}
    </div>
  </article>
}

export function AgentQuestion({ form, answer, cancel }: { form: AgentForm; answer: (answer: Record<string, unknown>) => void; cancel: () => void }) {
  const [values, setValues] = useState<Record<string, any>>(() => Object.fromEntries(form.fields.filter(f => f.default !== undefined).map(f => [f.key, f.default])))
  return <form className="agent-question" onSubmit={event => { event.preventDefault(); answer(values) }}><h3>{form.title}</h3>
    {form.fields.map(field => {
      if (field.when?.some(condition => condition.op === 'neq' ? values[condition.key] === condition.value : values[condition.key] !== condition.value)) return null
      return <label className="field" key={field.key}><span>{field.title || field.key}</span>
        {field.type === 'boolean' ? <input type="checkbox" checked={Boolean(values[field.key])} onChange={event => setValues({ ...values, [field.key]: event.target.checked })} />
        : field.options ? <select multiple={field.type === 'multiselect'} required={field.required} value={values[field.key] ?? (field.type === 'multiselect' ? [] : '')} onChange={event => setValues({ ...values, [field.key]: field.type === 'multiselect' ? [...event.target.selectedOptions].map(o => o.value) : event.target.value })}>{field.type !== 'multiselect' && <option value="">Choose an option</option>}{field.options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        : field.type === 'external' ? <p className="muted">This question requires an external interaction not supported in this build. Cancel to let the agent know.</p>
        : <input type={field.hidden ? 'password' : ['integer', 'number'].includes(field.type) ? 'number' : 'text'} step={field.type === 'integer' ? 1 : undefined} required={field.required} value={values[field.key] ?? ''} onChange={event => setValues({ ...values, [field.key]: ['number', 'integer'].includes(field.type) ? event.target.valueAsNumber : event.target.value })} />}
        {field.description && <small>{field.description}</small>}
      </label>
    })}<div className="button-row"><button type="button" className="button" onClick={cancel}>Cancel request</button><button className="button primary">Send answer</button></div></form>
}

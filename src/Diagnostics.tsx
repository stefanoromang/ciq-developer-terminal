import { useState } from 'react'
import { bridge, isDesktop } from './bridge'

export function Diagnostics() {
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [working, setWorking] = useState(false), [error, setError] = useState('')
  const check = async (restart = false) => {
    setWorking(true); setError('')
    try {
      if (restart) await bridge.invoke('engine.restart')
      setReport(await bridge.invoke('diagnostics'))
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setWorking(false) }
  }
  return <section className="settings-section"><h2>Engine health & recovery</h2><div className="settings-card diagnostics-card">
    <p>Check the local engine, runtime and sandbox. Restarting the engine stops current requests and preserves saved conversations.</p>
    <div className="button-row"><button className="button" disabled={working || !isDesktop} onClick={() => void check()}>{working ? 'Checking…' : 'Check engine'}</button><button className="button" disabled={working || !isDesktop} onClick={() => void check(true)}>Restart engine</button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {report && <><pre aria-label="Engine health report">{JSON.stringify(report, null, 2)}</pre><button className="text-button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).catch(() => setError('Could not copy. Select the report text instead.'))}>Copy diagnostic report</button></>}
  </div></section>
}

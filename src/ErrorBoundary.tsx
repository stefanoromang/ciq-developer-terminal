import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="recovery-screen" role="alert">
      <h1>Let’s reopen your workspace.</h1>
      <p>The interface encountered an error. Your saved projects and conversations are still on this computer.</p>
      <button className="button primary" onClick={() => window.location.reload()}>Reload workspace</button>
    </main>
    return this.props.children
  }
}

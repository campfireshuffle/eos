import { Component, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"

// After a deploy, a tab opened earlier can ask for code files that are gone (the editor and
// the CSS editors load later). Vite reports that here; the boundary then says why. Offline,
// the file just couldn't be fetched, so it says that instead.
let failed: "updated" | "offline" | null = null
window.addEventListener("vite:preloadError", () => (failed = navigator.onLine ? "updated" : "offline"))

const MESSAGES = {
  updated: "Eos has been updated. Reload to use the new version.",
  offline: "Part of Eos couldn't load while offline. Reconnect, then reload.",
}

/**
 * Shows a way out instead of a blank page if rendering throws. Diagrams are saved as they're
 * edited, so reloading loses nothing.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="grid min-h-svh place-content-center justify-items-center gap-4 p-6 text-center">
        <p className="text-body text-muted-foreground">{failed ? MESSAGES[failed] : `Something went wrong: ${this.state.error.message}`}</p>
        <Button onClick={() => location.reload()}>Reload</Button>
      </div>
    )
  }
}

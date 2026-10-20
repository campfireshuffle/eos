import { Component, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"

// After a deploy, a tab opened earlier can ask for code files that are gone (the editor and
// the CSS editors load later). Vite reports that here; the boundary then says why.
let updated = false
window.addEventListener("vite:preloadError", () => (updated = true))

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
        <p className="text-body text-muted-foreground">
          {updated ? "Eos has been updated. Reload to use the new version." : `Something went wrong: ${this.state.error.message}`}
        </p>
        <Button onClick={() => location.reload()}>Reload</Button>
      </div>
    )
  }
}

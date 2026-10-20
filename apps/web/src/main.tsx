import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { Eos } from "@eos/core"
import "@workspace/ui/globals.css"

import { App } from "./App.tsx"
import "./app.css"
import { EosProvider } from "./lib/eos"
import { initHistory } from "./lib/history"
import { connectWebMcp } from "./lib/webmcp"

const root = document.getElementById("root")!

/** Plain-text status shown until the app renders, so a slow or failed start is never a blank page. */
function status(message: string) {
  root.innerHTML = ""
  const p = Object.assign(document.createElement("p"), { textContent: message })
  Object.assign(p.style, {
    margin: "0",
    minHeight: "100svh",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    textAlign: "center",
    color: "var(--muted-foreground)",
    font: "var(--eos-fs-body) var(--font-sans)",
  })
  root.append(p)
}

initHistory()
const slow = setTimeout(() => status("Opening your diagrams…"), 800)

try {
  const eos = await Eos.create({
    onBlocked: () => {
      clearTimeout(slow)
      status("Eos was updated. Close other Eos tabs to finish, and this one will open.")
    },
    // A newer Eos in another tab needs the database; reload to run the new version too.
    onVersionChange: () => location.reload(),
  })
  clearTimeout(slow)
  // Ask for persistent storage once there's something of the person's to keep: browsers
  // prompt for, or refuse, a request made on first visit. The seeded samples are already
  // in by now, so they don't count. A change heard from another tab counts too: it's the same library.
  const off = eos.subscribe("library", () => {
    off()
    void eos.requestPersistence()
  })
  try {
    connectWebMcp(eos)
  } catch (error) {
    // Agent tools are optional; never let them stop the app from opening.
    console.error("WebMCP tools could not be registered", error)
  }

  root.innerHTML = ""
  createRoot(root).render(
    <StrictMode>
      <EosProvider eos={eos}>
        <App />
      </EosProvider>
    </StrictMode>
  )
} catch (error) {
  clearTimeout(slow)
  console.error(error)
  status(`Eos couldn't open your diagrams: ${(error as Error).message}. Try reloading.`)
}

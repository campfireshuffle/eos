import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { Eos } from "@eos/core"
import "@workspace/ui/globals.css"

import { App } from "./App.tsx"
import "./app.css"
import { EosProvider } from "./lib/eos"
import { connectWebMcp } from "./lib/webmcp"

const eos = await Eos.create()
void eos.requestPersistence()
connectWebMcp(eos)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EosProvider eos={eos}>
      <App />
    </EosProvider>
  </StrictMode>,
)

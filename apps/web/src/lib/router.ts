import { useSyncExternalStore } from "react"

import type { LibrarySort, TagPath } from "@eos/core"

export type Route =
  | { name: "home"; starred: boolean; tag: TagPath | null; sort: LibrarySort }
  | { name: "diagram"; id: string }
  | { name: "import"; data: string }

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?")
  const params = new URLSearchParams(query)
  const diagram = path.match(/^\/d\/([\w-]+)/)
  if (diagram) return { name: "diagram", id: diagram[1] }
  if (path === "/import") return { name: "import", data: params.get("d") ?? "" }
  const sort = params.get("sort")
  return {
    name: "home",
    starred: params.get("starred") === "1",
    tag: params.get("tag"),
    sort: sort === "created" || sort === "title" ? sort : "modified",
  }
}

export function homeHref(view: { starred?: boolean; tag?: TagPath | null; sort?: LibrarySort } = {}): string {
  const params = new URLSearchParams()
  if (view.starred) params.set("starred", "1")
  if (view.tag) params.set("tag", view.tag)
  if (view.sort && view.sort !== "modified") params.set("sort", view.sort)
  const q = params.toString()
  return `#/${q ? `?${q}` : ""}`
}

export const diagramHref = (id: string) => `#/d/${id}`

export function navigate(href: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", href)
  else location.hash = href.replace(/^#/, "")
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"))
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb)
  return () => window.removeEventListener("hashchange", cb)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return parseRoute(hash)
}

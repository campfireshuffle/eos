import { useSyncExternalStore } from "react"

import type { LibrarySort, TagPath } from "@eos/core"

import { onNavigate } from "./history"

export type LibraryGroup = "date" | "subtag" | "none"

export type Route =
  | {
      name: "home"
      starred: boolean
      deleted: boolean
      tag: TagPath | null
      sort: LibrarySort
      group: LibraryGroup
      /** Search text. */
      q: string
    }
  | { name: "diagram"; id: string }
  | { name: "import"; data: string }

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?")
  const params = new URLSearchParams(query)
  const diagram = path.match(/^\/d\/([\w-]+)/)
  if (diagram) return { name: "diagram", id: diagram[1] }
  if (path === "/import") return { name: "import", data: params.get("d") ?? "" }
  const sort = params.get("sort")
  const group = params.get("group")
  return {
    name: "home",
    starred: params.get("starred") === "1",
    deleted: params.get("deleted") === "1",
    tag: params.get("tag"),
    sort: sort === "created" || sort === "title" ? sort : "modified",
    group: group === "subtag" || group === "none" ? group : "date",
    q: params.get("q") ?? "",
  }
}

export function homeHref(
  view: { starred?: boolean; deleted?: boolean; tag?: TagPath | null; sort?: LibrarySort; group?: LibraryGroup; q?: string } = {}
): string {
  const params = new URLSearchParams()
  if (view.starred) params.set("starred", "1")
  if (view.deleted) params.set("deleted", "1")
  if (view.tag) params.set("tag", view.tag)
  if (view.sort && view.sort !== "modified") params.set("sort", view.sort)
  if (view.group && view.group !== "date") params.set("group", view.group)
  if (view.q) params.set("q", view.q)
  const q = params.toString()
  return `#/${q ? `?${q}` : ""}`
}

export const diagramHref = (id: string) => `#/d/${id}`

export function navigate(href: string, { replace = false } = {}) {
  if (!replace) return void (location.hash = href.replace(/^#/, ""))
  // The same history entry with a new URL, so its stamp in history.state carries over.
  history.replaceState(history.state, "", href)
  // replaceState fires nothing; announce the new URL the way a real hash change does.
  window.dispatchEvent(new HashChangeEvent("hashchange"))
}

export function useRoute(): Route {
  // History tells us of each navigation, so the route and the history entry change together.
  const hash = useSyncExternalStore(onNavigate, () => location.hash)
  return parseRoute(hash)
}

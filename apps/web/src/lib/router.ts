import { tagMatches, type LibrarySort, type TagPath } from "@eos/core"

import { BY_AGENT } from "./history"

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

export function navigate(href: string, { replace = false, agent = false } = {}) {
  // Replacing keeps the history entry with a new URL, so its key, and the scroll position saved under it, carry over.
  // "auto" pushes, except to the URL already shown, which keeps its entry, as a link to it does.
  navigation.navigate(href, { history: replace ? "replace" : "auto", info: agent ? BY_AGENT : undefined })
}

/**
 * After the tag `from` moves to `to`, or is deleted (`to` null), a library open at it or under it follows it,
 * rather than filtering by a tag nothing has. As the person's Move and Delete tag do, and an agent's update_tag and
 * delete_tag. Read from the URL, not the sidebar's highlight: on a diagram's page that's the diagram's tag, and the
 * page stays put.
 */
export function followTag(from: TagPath, to: TagPath | null) {
  const route = parseRoute(location.hash)
  if (route.name !== "home" || !route.tag || !tagMatches(route.tag, from)) return
  navigate(homeHref({ ...route, tag: to && to + route.tag.slice(from.length) }), { replace: true })
}

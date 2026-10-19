import {
  decodeShare,
  encodeShare,
  renderSvg,
  shareUrl,
  validate,
  type Actor,
  type DiagramId,
  type Eos,
  type LibrarySort,
  type TagPath,
} from "@eos/core"

/** What the page exposes so agents can drive the UI the way a person would. */
export interface UiBridge {
  getView(): unknown
  openDiagram(id: DiagramId): void
  goHome(): void
  setLibraryView(view: { starred?: boolean; tags?: TagPath[]; sort?: LibrarySort }): void
  setZoom(action: "in" | "out" | "fit" | "actual"): void
  openSettings(open: boolean): void
  /** Resolves true when the person allows a destructive agent action. */
  confirm(message: string): Promise<boolean>
  download(name: string, data: string | Blob): void
  origin: string
}

type JSONSchema = Record<string, unknown>

export interface Tool {
  name: string
  description: string
  inputSchema: JSONSchema
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
  execute(input: Record<string, unknown>): Promise<unknown>
}

const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) })
const bool = (description?: string) => ({ type: "boolean", ...(description ? { description } : {}) })
const strArr = (description?: string) => ({ type: "array", items: { type: "string" }, ...(description ? { description } : {}) })
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required })
const sortSchema = { type: "string", enum: ["modified", "created", "title"] }

const ok = (extra: object = {}) => ({ ok: true, ...extra })
const fail = (code: string, message: string) => ({ ok: false, code, message })

export function createTools(eos: Eos, ui: UiBridge): Tool[] {
  const agent = (tool: string): Actor => ({ kind: "agent", tool })
  const exists = async (id: unknown) => typeof id === "string" && !!(await eos.getDiagram(id))
  const guard = async (id: unknown) => ((await exists(id)) ? null : fail("not_found", `No diagram with id ${String(id)}`))
  const confirmed = async (message: string) =>
    !eos.getSettings().agent.confirmDestructive || (await ui.confirm(message))
  const write = async (id: string, tool: string, fn: (a: Actor) => Promise<void>) => {
    const missing = await guard(id)
    if (missing) return missing
    await fn(agent(tool))
    return ok({ version: await eos.version(id) })
  }

  const tools: Tool[] = [
    // Library
    {
      name: "list_diagrams",
      description: "List diagrams in the library. Same filters as the sidebar: starred, tags (includes nested tags), text query, sort.",
      inputSchema: obj({ query: str(), starred: bool(), tags: strArr(), sort: sortSchema, includeDeleted: bool() }),
      annotations: { readOnlyHint: true },
      execute: async (i) => ok({ diagrams: await eos.listDiagrams(i as never) }),
    },
    {
      name: "get_diagram",
      description: "Get a diagram's title, tags, starred state, Mermaid source and current version.",
      inputSchema: obj({ id: str() }, ["id"]),
      annotations: { readOnlyHint: true },
      execute: async ({ id }) => {
        const d = await eos.getDiagram(id as string)
        return d ? ok({ diagram: d, version: await eos.version(d.id) }) : fail("not_found", "Diagram not found")
      },
    },
    {
      name: "list_tags",
      description: "List the tag tree with emoji and diagram counts.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      execute: async () => ok({ tags: await eos.listTags() }),
    },
    // Diagrams
    {
      name: "create_diagram",
      description: "Create a diagram from Mermaid source. Opens it unless open is false.",
      inputSchema: obj({ title: str(), source: str("Mermaid source"), tags: strArr(), open: bool() }),
      execute: async (i) => {
        const id = await eos.createDiagram(i as never, agent("create_diagram"))
        if (i.open !== false) ui.openDiagram(id)
        return ok({ id })
      },
    },
    {
      name: "rename_diagram",
      description: "Rename a diagram.",
      inputSchema: obj({ id: str(), title: str() }, ["id", "title"]),
      execute: ({ id, title }) => write(id as string, "rename_diagram", (a) => eos.renameDiagram(id as string, title as string, a)),
    },
    {
      name: "duplicate_diagram",
      description: "Copy a diagram's source and tags into a new diagram with fresh history.",
      inputSchema: obj({ id: str(), title: str() }, ["id"]),
      execute: async ({ id, title }) =>
        (await guard(id)) ?? ok({ id: await eos.duplicateDiagram(id as string, title as string | undefined, agent("duplicate_diagram")) }),
    },
    {
      name: "delete_diagram",
      description: "Move a diagram to Recently deleted. Asks the person to confirm.",
      inputSchema: obj({ id: str() }, ["id"]),
      annotations: { destructiveHint: true },
      execute: async ({ id }) => {
        const d = await eos.getDiagram(id as string)
        if (!d) return fail("not_found", "Diagram not found")
        if (!(await confirmed(`The agent wants to delete “${d.meta.title}”.`))) return fail("user_declined", "The person declined")
        await eos.deleteDiagram(d.id)
        return ok()
      },
    },
    {
      name: "restore_diagram",
      description: "Restore a diagram from Recently deleted.",
      inputSchema: obj({ id: str() }, ["id"]),
      execute: async ({ id }) => (await guard(id)) ?? (await eos.restoreDiagram(id as string), ok()),
    },
    // Source
    {
      name: "get_source",
      description: "Get a diagram's Mermaid source, now or at a past version.",
      inputSchema: obj({ id: str(), version: str() }, ["id"]),
      annotations: { readOnlyHint: true },
      execute: async ({ id, version }) =>
        (await guard(id)) ?? ok({ source: await eos.getSource(id as string, version as string | undefined) }),
    },
    {
      name: "set_source",
      description: "Replace a diagram's Mermaid source. Applied as a minimal diff; undoable.",
      inputSchema: obj({ id: str(), source: str() }, ["id", "source"]),
      execute: ({ id, source }) => write(id as string, "set_source", (a) => eos.setSource(id as string, source as string, a)),
    },
    {
      name: "patch_source",
      description:
        "Replace 1-based line ranges in one step. If an edit's `expect` text no longer matches, nothing is applied and `stale` is returned.",
      inputSchema: obj(
        {
          id: str(),
          edits: {
            type: "array",
            items: obj({ line: { type: "number" }, endLine: { type: "number" }, expect: str(), text: str() }, ["line", "text"]),
          },
        },
        ["id", "edits"],
      ),
      execute: async ({ id, edits }) => {
        const missing = await guard(id)
        if (missing) return missing
        const lines = (await eos.getSource(id as string)).split("\n")
        const list = [...(edits as { line: number; endLine?: number; expect?: string; text: string }[])].sort((a, b) => b.line - a.line)
        for (const e of list) {
          const end = e.endLine ?? e.line
          if (e.expect !== undefined && lines.slice(e.line - 1, end).join("\n") !== e.expect) {
            return fail("stale", `Line ${e.line} no longer matches`)
          }
        }
        for (const e of list) lines.splice(e.line - 1, (e.endLine ?? e.line) - e.line + 1, ...e.text.split("\n"))
        return write(id as string, "patch_source", (a) => eos.setSource(id as string, lines.join("\n"), a))
      },
    },
    {
      name: "validate_source",
      description: "Parse Mermaid source with Pele. Returns the error line, column and message if it fails.",
      inputSchema: obj({ id: str(), source: str() }),
      annotations: { readOnlyHint: true },
      execute: async ({ id, source }) => {
        const text = typeof source === "string" ? source : await eos.getSource(id as string)
        const r = validate(text)
        return r.ok ? ok({ type: r.type, errors: [] }) : { ok: false, code: "parse_error", errors: [r.error] }
      },
    },
    // Rendering & export
    {
      name: "render_svg",
      description: "Render a diagram (or raw Mermaid source) to SVG with Pele.",
      inputSchema: obj({ id: str(), source: str() }),
      annotations: { readOnlyHint: true },
      execute: async ({ id, source }) => {
        const text = typeof source === "string" ? source : await eos.getSource(id as string)
        try {
          return ok({ svg: renderSvg(text) })
        } catch (e) {
          return fail("parse_error", (e as Error).message)
        }
      },
    },
    {
      name: "export_diagram",
      description: "Export a diagram as SVG or Mermaid (.mmd). With download: true, also saves the file like the Export menu.",
      inputSchema: obj({ id: str(), format: { type: "string", enum: ["svg", "mmd"] }, download: bool() }, ["id", "format"]),
      annotations: { readOnlyHint: true },
      execute: async ({ id, format, download }) => {
        const d = await eos.getDiagram(id as string)
        if (!d) return fail("not_found", "Diagram not found")
        const data = format === "svg" ? renderSvg(d.source) : d.source
        if (download) ui.download(`${d.meta.title}.${format}`, data)
        return ok({ data })
      },
    },
    {
      name: "get_share_link",
      description: "Get a link that opens a copy of the diagram in someone else's Eos library.",
      inputSchema: obj({ id: str(), includeTags: bool() }, ["id"]),
      annotations: { readOnlyHint: true },
      execute: async ({ id, includeTags }) => {
        const d = await eos.getDiagram(id as string)
        if (!d) return fail("not_found", "Diagram not found")
        const enc = await encodeShare({ title: d.meta.title, source: d.source, tags: includeTags ? d.meta.tags : [] })
        return ok({ url: shareUrl(ui.origin, enc) })
      },
    },
    {
      name: "import_share_link",
      description: "Import a diagram from an Eos share link.",
      inputSchema: obj({ url: str(), open: bool() }, ["url"]),
      execute: async ({ url, open }) => {
        const encoded = new URL(url as string).hash.match(/[?&]d=([^&]+)/)?.[1] ?? ""
        const payload = await decodeShare(encoded)
        if (!payload) return fail("invalid_input", "Not a valid Eos share link")
        const id = await eos.importShare(payload)
        if (open !== false) ui.openDiagram(id)
        return ok({ id })
      },
    },
    // History
    {
      name: "undo",
      description: "Undo the last change to a diagram (same as ⌘Z).",
      inputSchema: obj({ id: str() }, ["id"]),
      execute: async ({ id }) => (await guard(id)) ?? (await eos.undo(id as string), ok(await eos.canUndo(id as string))),
    },
    {
      name: "redo",
      description: "Redo the last undone change (same as ⇧⌘Z).",
      inputSchema: obj({ id: str() }, ["id"]),
      execute: async ({ id }) => (await guard(id)) ?? (await eos.redo(id as string), ok(await eos.canUndo(id as string))),
    },
    {
      name: "list_versions",
      description: "List a diagram's history: version id, who made the change (user or agent), and when.",
      inputSchema: obj({ id: str(), limit: { type: "number" } }, ["id"]),
      annotations: { readOnlyHint: true },
      execute: async ({ id, limit }) => (await guard(id)) ?? ok({ versions: await eos.history(id as string, limit as number | undefined) }),
    },
    {
      name: "restore_version",
      description: "Restore a past version as a new change.",
      inputSchema: obj({ id: str(), version: str() }, ["id", "version"]),
      execute: ({ id, version }) =>
        write(id as string, "restore_version", (a) => eos.restoreVersion(id as string, version as string, a)),
    },
    // Organisation
    {
      name: "set_starred",
      description: "Star or unstar a diagram.",
      inputSchema: obj({ id: str(), starred: bool() }, ["id", "starred"]),
      execute: async ({ id, starred }) => (await guard(id)) ?? (await eos.setStarred(id as string, !!starred, agent("set_starred")), ok()),
    },
    {
      name: "add_tags",
      description: "Add tags to a diagram. Use slashes for nesting, e.g. work/backend.",
      inputSchema: obj({ id: str(), tags: strArr() }, ["id", "tags"]),
      execute: ({ id, tags }) => write(id as string, "add_tags", (a) => eos.addTags(id as string, tags as string[], a)),
    },
    {
      name: "remove_tags",
      description: "Remove tags from a diagram.",
      inputSchema: obj({ id: str(), tags: strArr() }, ["id", "tags"]),
      execute: ({ id, tags }) => write(id as string, "remove_tags", (a) => eos.removeTags(id as string, tags as string[], a)),
    },
    {
      name: "rename_tag",
      description: "Rename or move a tag and everything nested under it, across all diagrams.",
      inputSchema: obj({ from: str(), to: str() }, ["from", "to"]),
      execute: async ({ from, to }) => (await eos.renameTag(from as string, to as string, agent("rename_tag")), ok()),
    },
    {
      name: "delete_tag",
      description: "Delete a tag (and tags nested under it) from every diagram. Asks the person to confirm.",
      inputSchema: obj({ path: str() }, ["path"]),
      annotations: { destructiveHint: true },
      execute: async ({ path }) => {
        if (!(await confirmed(`The agent wants to delete the tag “${String(path)}” from all diagrams.`)))
          return fail("user_declined", "The person declined")
        return ok({ diagrams: await eos.deleteTag(path as string, agent("delete_tag")) })
      },
    },
    {
      name: "set_tag_emoji",
      description: "Set a tag's sidebar icon to an emoji, or null for the default #.",
      inputSchema: obj({ path: str(), emoji: { type: ["string", "null"] } }, ["path"]),
      execute: async ({ path, emoji }) => (await eos.setTagEmoji(path as string, (emoji as string) ?? null, agent("set_tag_emoji")), ok()),
    },
    // Navigation & view
    {
      name: "get_view",
      description: "What the person is looking at: route, open diagram, filters, sort, zoom.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      execute: async () => ok({ view: ui.getView() }),
    },
    {
      name: "open_diagram",
      description: "Open a diagram in the editor.",
      inputSchema: obj({ id: str() }, ["id"]),
      execute: async ({ id }) => (await guard(id)) ?? (ui.openDiagram(id as string), ok()),
    },
    {
      name: "go_home",
      description: "Go to the diagram library.",
      inputSchema: obj({}),
      execute: async () => (ui.goHome(), ok()),
    },
    {
      name: "set_library_view",
      description: "Set the library's filters and sort, as clicking a tag, Starred or the Sort menu would.",
      inputSchema: obj({ starred: bool(), tags: strArr(), sort: sortSchema }),
      execute: async (i) => (ui.setLibraryView(i as never), ok()),
    },
    {
      name: "set_zoom",
      description: "Zoom the preview.",
      inputSchema: obj({ action: { type: "string", enum: ["in", "out", "fit", "actual"] } }, ["action"]),
      execute: async ({ action }) => (ui.setZoom(action as never), ok()),
    },
    {
      name: "open_settings",
      description: "Show or hide the Settings dialog.",
      inputSchema: obj({ open: bool() }, ["open"]),
      execute: async ({ open }) => (ui.openSettings(!!open), ok()),
    },
    // Settings & data
    {
      name: "get_settings",
      description: "Get app settings, including the custom theme CSS.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      execute: async () => ok({ settings: eos.getSettings() }),
    },
    {
      name: "set_theme_css",
      description: "Set custom theme CSS (CSS variables under :root). Pass null to reset to the default theme.",
      inputSchema: obj({ css: { type: ["string", "null"] } }, ["css"]),
      execute: async ({ css }) => (await eos.updateSettings({ theme: { customCss: (css as string) ?? null } }), ok()),
    },
    {
      name: "get_storage_usage",
      description: "How much browser storage Eos is using.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      execute: async () => ok(await eos.storageUsage()),
    },
    {
      name: "export_backup",
      description: "Export every diagram and setting as a backup file (JSON).",
      inputSchema: obj({ download: bool() }),
      annotations: { readOnlyHint: true },
      execute: async ({ download }) => {
        const data = await eos.exportBackup()
        if (download) ui.download("eos-backup.json", data)
        return ok({ data })
      },
    },
    {
      name: "import_backup",
      description: "Import a backup. merge combines it with existing diagrams; replace wipes local data first and asks to confirm.",
      inputSchema: obj({ data: str(), mode: { type: "string", enum: ["merge", "replace"] } }, ["data", "mode"]),
      annotations: { destructiveHint: true },
      execute: async ({ data, mode }) => {
        if (mode === "replace" && !(await confirmed("The agent wants to replace all your diagrams with a backup.")))
          return fail("user_declined", "The person declined")
        await eos.importBackup(data as string, mode as "merge" | "replace")
        return ok()
      },
    },
    {
      name: "delete_all_data",
      description: "Delete every diagram and setting in this browser. Asks the person to confirm. Not undoable.",
      inputSchema: obj({}),
      annotations: { destructiveHint: true },
      execute: async () => {
        if (!(await confirmed("The agent wants to delete all your diagrams. This can’t be undone.")))
          return fail("user_declined", "The person declined")
        await eos.deleteAll()
        return ok()
      },
    },
  ]
  return tools
}

interface ModelContext {
  registerTool(tool: Tool, options?: { signal?: AbortSignal }): void
}

/** Registers tools with WebMCP if the browser supports it. Returns an unregister function. */
export function registerTools(tools: Tool[]): (() => void) | null {
  const mc = ((globalThis as { document?: { modelContext?: ModelContext } }).document?.modelContext ??
    (globalThis as { navigator?: { modelContext?: ModelContext } }).navigator?.modelContext) as ModelContext | undefined
  if (!mc?.registerTool) return null
  const controller = new AbortController()
  for (const tool of tools) mc.registerTool(tool, { signal: controller.signal })
  return () => controller.abort()
}

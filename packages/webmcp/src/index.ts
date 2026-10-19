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
  setLibraryView(view: { starred?: boolean; deleted?: boolean; tags?: TagPath[]; sort?: LibrarySort }): void
  setZoom(action: "in" | "out" | "fit" | "actual"): void
  openSettings(open: boolean): void
  /** Shows a past version read-only in the editor, or returns to the latest. */
  previewVersion(id: DiagramId, version: string | null, meta?: { at: number; label: string }): void
  /** Resolves true when the person allows a destructive agent action. */
  confirm(message: string, action?: string): Promise<boolean>
  download(name: string, data: string | Blob): void
  /** Rasterises an SVG to a PNG data URL (2×), as the Export menu does. */
  toPng(svg: string): Promise<{ dataUrl: string; blob: Blob }>
  /** The theme in effect: resolved light/dark plus the app and diagram CSS, defaults included. */
  getTheme(): { resolvedMode: "light" | "dark"; appCss: string; diagramCss: string }
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
const enumOf = (values: string[], description?: string) => ({ type: "string", enum: values, ...(description ? { description } : {}) })
const sortSchema = enumOf(["modified", "created", "title"])

const ok = (extra: object = {}) => ({ ok: true, ...extra })
const fail = (code: string, message: string, extra: object = {}) => ({ ok: false, code, message, ...extra })

type Input = Record<string, unknown>
const has = (i: Input, key: string) => i[key] !== undefined && i[key] !== null

/** Parse result for Mermaid source, in the shape every tool returns it. */
function check(source: string) {
  const r = validate(source)
  return r.ok ? { valid: true, type: r.type } : { valid: false, error: r.error }
}

/**
 * Eos's WebMCP tools. Kept deliberately few and deep (one tool per kind of job,
 * optional fields instead of extra tools). Reads, writes and permanent deletes are
 * separate tools so harnesses can auto-approve reads by their annotations.
 */
export function createTools(eos: Eos, ui: UiBridge): Tool[] {
  const agent = (tool: string, changes?: string[]): Actor => ({ kind: "agent", tool, ...(changes ? { changes } : {}) })
  const confirmed = async (message: string, action?: string) =>
    !eos.getSettings().agent.confirmDestructive || (await ui.confirm(message, action))
  const notFound = (id: unknown) => fail("not_found", `No diagram with id ${String(id)}`)

  return [
    // ── Reads ────────────────────────────────────────────────────────────────
    {
      name: "get_library",
      description:
        "The library: diagrams (id, title, tags, starred, dates), the tag tree with emoji and counts, and totals. Filters work like the sidebar: query (fuzzy title and contents), starred, tags (include nested tags), deleted (only diagrams in Deleted), sort.",
      inputSchema: obj({ query: str(), starred: bool(), tags: strArr(), deleted: bool(), sort: sortSchema }),
      annotations: { readOnlyHint: true },
      execute: async (i) =>
        ok({
          diagrams: (await eos.listDiagrams(i as never)).map(({ sourceText: _s, tagPrefixes: _p, titleKey: _k, ...row }) => row),
          tags: await eos.listTags(),
          counts: await eos.counts(),
        }),
    },
    {
      name: "get_diagram",
      description:
        "One diagram: title, tags, starred, Mermaid source and current version id (pass it back as expectedVersion when editing). version reads the source at a past version; history: true adds the version list, where agent edits are listed separately from the person's.",
      inputSchema: obj({ id: str(), version: str("A version id from history"), history: bool() }, ["id"]),
      annotations: { readOnlyHint: true },
      execute: async ({ id, version, history }) => {
        const d = await eos.getDiagram(id as string)
        if (!d) return notFound(id)
        const source = version ? await eos.getSource(d.id, version as string) : d.source
        return ok({
          diagram: { ...d, source },
          version: await eos.version(d.id),
          ...check(source),
          ...(history ? { history: await eos.history(d.id, 200) } : {}),
        })
      },
    },
    {
      name: "get_view",
      description: "What the person is looking at: page, open diagram, library filters, preview zoom, whether Settings is open.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      execute: async () => ok({ view: ui.getView() }),
    },
    {
      name: "get_settings",
      description:
        "Settings, the theme in effect (light or dark, plus the full app --eos-* and diagram --pele-* CSS including defaults; Pele's variables are documented at https://pele.run/theming) and storage used.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      execute: async () => {
        const settings = eos.getSettings()
        return ok({
          settings,
          theme: { mode: settings.theme.mode, ...ui.getTheme(), overridden: { app: !!settings.theme.customCss, diagram: !!settings.theme.diagramCss } },
          storage: await eos.storageUsage(),
        })
      },
    },
    {
      name: "export",
      description:
        "Export a diagram (id) or raw Mermaid (source). Formats: svg, png (data URL), mmd, link (a share link that opens a copy in anyone's Eos), backup (the whole library as JSON; no id needed). Invalid Mermaid returns parse_error with line and column, so this also works as a dry-run check. download: true also saves the file like the Export menu.",
      inputSchema: obj(
        {
          format: enumOf(["svg", "png", "mmd", "link", "backup"]),
          id: str(),
          source: str("Raw Mermaid, instead of id"),
          includeTags: bool("For link: include the diagram's tags"),
          download: bool(),
        },
        ["format"],
      ),
      annotations: { readOnlyHint: true },
      execute: async ({ format, id, source, includeTags, download }) => {
        if (format === "backup") {
          const data = await eos.exportBackup()
          if (download) ui.download("eos-backup.json", data)
          return ok({ data })
        }
        const d = typeof source === "string" ? null : await eos.getDiagram(id as string)
        if (typeof source !== "string" && !d) return notFound(id)
        const text = typeof source === "string" ? source : d!.source
        const title = d?.meta.title ?? "diagram"
        if (format === "link") {
          const enc = await encodeShare({ title, source: text, tags: includeTags && d ? d.meta.tags : [] })
          return ok({ url: shareUrl(ui.origin, enc) })
        }
        const parsed = check(text)
        if (format === "mmd") {
          if (download) ui.download(`${title}.mmd`, text)
          return ok({ data: text, ...parsed })
        }
        if (!parsed.valid) return fail("parse_error", "The Mermaid source doesn't parse", { error: parsed.error })
        const svg = renderSvg(text)
        if (format === "svg") {
          if (download) ui.download(`${title}.svg`, svg)
          return ok({ data: svg, type: parsed.type })
        }
        const png = await ui.toPng(svg)
        if (download) ui.download(`${title}.png`, png.blob)
        return ok({ data: png.dataUrl, type: parsed.type })
      },
    },
    // ── Writes ───────────────────────────────────────────────────────────────
    {
      name: "create_diagram",
      description:
        "Create a diagram from Mermaid source, or import one from an Eos share link (fromShareLink). To duplicate, read a diagram with get_diagram and create from its source. Opens it unless open is false. Returns whether the source parses.",
      inputSchema: obj({
        title: str(),
        source: str("Mermaid source"),
        tags: strArr("Use slashes for nesting, e.g. work/backend"),
        starred: bool(),
        fromShareLink: str(),
        open: bool(),
      }),
      execute: async (i) => {
        let id: DiagramId
        if (typeof i.fromShareLink === "string") {
          let encoded = ""
          try {
            encoded = new URL(i.fromShareLink).hash.match(/[?&]d=([^&]+)/)?.[1] ?? ""
          } catch {
            // Not a URL; decodeShare rejects it below.
          }
          const payload = await decodeShare(encoded)
          if (!payload) return fail("invalid_input", "Not a valid Eos share link")
          id = await eos.importShare(payload)
        } else {
          id = await eos.createDiagram({ title: i.title as string, source: i.source as string, tags: i.tags as string[] }, agent("create_diagram", ["created"]))
        }
        if (i.starred) await eos.setStarred(id, true, agent("create_diagram"))
        if (i.open !== false) ui.openDiagram(id)
        const d = (await eos.getDiagram(id))!
        return ok({ id, version: await eos.version(id), ...check(d.source) })
      },
    },
    {
      name: "update_diagram",
      description:
        "Edit a diagram. Every field is optional and the edit lands as one change in history, credited to the agent: title, source (full Mermaid; applied as a minimal diff), starred, addTags, removeTags. revert: \"undo\" or \"redo\" steps the agent's own edits (never the person's; refused if the person has edited since), or a version id from get_diagram's history restores that version. deleted: true moves it to Deleted (asks the person; reversible), false restores it. Pass expectedVersion from get_diagram to refuse the edit if the person changed it meanwhile.",
      inputSchema: obj(
        {
          id: str(),
          title: str(),
          source: str(),
          starred: bool(),
          addTags: strArr(),
          removeTags: strArr(),
          revert: str("\"undo\", \"redo\" or a version id"),
          deleted: bool(),
          expectedVersion: str(),
        },
        ["id"],
      ),
      execute: async (i) => {
        const id = i.id as string
        const d = await eos.getDiagram(id)
        if (!d) return notFound(id)
        if (has(i, "expectedVersion") && i.expectedVersion !== (await eos.version(id)))
          return fail("stale", "The diagram changed since that version; read it again", { version: await eos.version(id) })
        if (has(i, "revert") && has(i, "source")) return fail("invalid_input", "Use either revert or source, not both")

        const changes = ["title", "source", "addTags", "removeTags"].filter((k) => has(i, k)).map((k) => (k.endsWith("Tags") ? "tags" : k))
        if (has(i, "revert")) {
          const r = i.revert as string
          if (r === "undo" || r === "redo") {
            // Undoing over the person's newer edit could overwrite it (titles and tags are last-write-wins).
            const [latest] = await eos.history(id, 1)
            if (latest && latest.actor.kind !== "agent")
              return fail("person_edited", "The person has edited since the agent's last change. Restore a version id from history, or edit directly.")
            const done = await eos[r](id, "agent", agent("update_diagram", [r]))
            if (!done) return fail("nothing_to_revert", `No agent edit to ${r}`)
          } else await eos.restoreVersion(id, r, agent("update_diagram", ["restored version"]))
        }
        if (changes.length) {
          await eos.editDiagram(
            id,
            { title: i.title as string, source: i.source as string, addTags: i.addTags as string[], removeTags: i.removeTags as string[] },
            agent("update_diagram", [...new Set(changes)]),
          )
        }
        if (has(i, "starred")) await eos.setStarred(id, !!i.starred, agent("update_diagram", ["starred"]))
        if (i.deleted === true) {
          if (!(await confirmed(`The agent wants to move “${d.meta.title}” to Deleted.`)))
            return fail("user_declined", "The person declined to delete it")
          await eos.deleteDiagram(id)
        } else if (i.deleted === false) await eos.restoreDiagram(id)

        const now = (await eos.getDiagram(id))!
        return ok({ version: await eos.version(id), ...check(now.source), agentUndo: await eos.canUndo(id, "agent") })
      },
    },
    {
      name: "update_tag",
      description:
        "Rename or move a tag (and everything nested under it) across every diagram, and/or set its sidebar icon. moveTo is the new full path: \"archive/backend\" nests it, \"backend\" puts it at the top level. emoji: an emoji, or null for the default #.",
      inputSchema: obj({ path: str(), moveTo: str(), emoji: { type: ["string", "null"] } }, ["path"]),
      execute: async ({ path, moveTo, emoji }) => {
        let current = path as string
        if (typeof moveTo === "string" && moveTo !== current) {
          await eos.renameTag(current, moveTo, agent("update_tag", ["tags"]))
          current = moveTo
        }
        if (emoji !== undefined) await eos.setTagEmoji(current, (emoji as string | null) ?? null, agent("update_tag"))
        return ok({ path: current })
      },
    },
    {
      name: "set_view",
      description:
        "Change what the person sees. page: \"library\" (with optional filters) or \"diagram\" (with diagramId). previewVersion shows a past version of the open diagram read-only, or \"latest\" to go back. zoom changes the preview. settingsOpen shows or hides Settings.",
      inputSchema: obj({
        page: enumOf(["library", "diagram"]),
        diagramId: str(),
        filters: obj({ starred: bool(), deleted: bool(), tags: strArr(), sort: sortSchema }),
        previewVersion: str("A version id, or \"latest\""),
        zoom: enumOf(["in", "out", "fit", "actual"]),
        settingsOpen: bool(),
      }),
      execute: async (i) => {
        if (i.page === "library") {
          if (i.filters) ui.setLibraryView(i.filters as never)
          else ui.goHome()
        }
        const id = (i.diagramId as string | undefined) ?? undefined
        if (i.page === "diagram" || has(i, "previewVersion")) {
          if (!id || !(await eos.getDiagram(id))) return notFound(id)
          ui.openDiagram(id)
        }
        if (has(i, "previewVersion")) {
          if (i.previewVersion === "latest") ui.previewVersion(id!, null)
          else {
            const entry = (await eos.history(id!, 500)).find((e) => e.version === i.previewVersion)
            if (!entry) return fail("not_found", "No such version")
            ui.previewVersion(id!, entry.version, { at: entry.at, label: entry.actor.kind === "agent" ? "Agent" : entry.actor.kind === "user" ? "You" : entry.actor.kind })
          }
        }
        if (has(i, "zoom")) ui.setZoom(i.zoom as never)
        if (has(i, "settingsOpen")) ui.openSettings(!!i.settingsOpen)
        return ok({ view: ui.getView() })
      },
    },
    {
      name: "set_theme",
      description:
        "Change the theme: mode (light, dark or system), appCss (--eos-* variables) and/or diagramCss (--pele-* variables). Start from the CSS get_settings returns. null resets an override to the default.",
      inputSchema: obj({
        mode: enumOf(["system", "light", "dark"]),
        appCss: { type: ["string", "null"] },
        diagramCss: { type: ["string", "null"] },
      }),
      execute: async ({ mode, appCss, diagramCss }) => {
        const theme: Record<string, unknown> = {}
        if (mode !== undefined) theme.mode = mode
        if (appCss !== undefined) theme.customCss = appCss
        if (diagramCss !== undefined) theme.diagramCss = diagramCss
        await eos.updateSettings({ theme: theme as never })
        return ok({ theme: eos.getSettings().theme })
      },
    },
    // ── Permanent deletes (each asks the person) ─────────────────────────────
    {
      name: "delete_tag",
      description: "Remove a tag, and tags nested under it, from every diagram. Asks the person to confirm. Diagrams themselves are kept.",
      inputSchema: obj({ path: str() }, ["path"]),
      annotations: { destructiveHint: true },
      execute: async ({ path }) => {
        if (!(await confirmed(`The agent wants to remove the tag “${String(path)}” from every diagram.`)))
          return fail("user_declined", "The person declined")
        return ok({ diagrams: await eos.deleteTag(path as string, agent("delete_tag", ["tags"])) })
      },
    },
    {
      name: "import_backup",
      description: "Import a backup (from export with format backup). merge adds to the library; replace wipes local data first and asks the person to confirm.",
      inputSchema: obj({ data: str(), mode: enumOf(["merge", "replace"]) }, ["data", "mode"]),
      annotations: { destructiveHint: true },
      execute: async ({ data, mode }) => {
        if (mode === "replace" && !(await confirmed("The agent wants to replace all your diagrams with a backup.", "Replace")))
          return fail("user_declined", "The person declined")
        await eos.importBackup(data as string, mode as "merge" | "replace")
        return ok()
      },
    },
    {
      name: "delete_all_data",
      description: "Delete every diagram and setting in this browser. Asks the person to confirm. Can't be undone.",
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

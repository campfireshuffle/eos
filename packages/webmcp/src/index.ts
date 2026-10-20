import {
  decodeShare,
  encodeShare,
  readBackup,
  type Backup,
  renderSvg,
  UnknownVersionError,
  shareUrl,
  validate,
  type Actor,
  type DiagramId,
  type Eos,
  type LibrarySort,
  type TagPath,
} from "@eos/core"
import * as z from "zod/mini"

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
  /** Asks the person to allow a destructive agent action. "declined" also covers `signal` aborting; "busy" means another dialog was already open, so nothing was asked. */
  confirm(message: string, action?: string, signal?: AbortSignal): Promise<"confirmed" | "declined" | "busy">
  download(name: string, data: string | Blob): void
  /** Rasterises an SVG to a PNG data URL (2×), as the Export menu does. */
  toPng(svg: string): Promise<{ dataUrl: string; blob: Blob }>
  /** The theme in effect: resolved light/dark plus the app and diagram CSS, defaults included. */
  getTheme(): { resolvedMode: "light" | "dark"; appCss: string; diagramCss: string }
  /** Resolves once the page has rendered the latest UI change, so getView reports it. */
  settled?(): Promise<void>
  origin: string
}

/** What the browser passes as execute's second argument. Aborts when the agent cancels the call. */
export interface ToolClient {
  signal?: AbortSignal
}

/** A tool in the shape WebMCP's registerTool takes. */
export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /**
   * Chrome reads readOnlyHint, untrustedContentHint and consequentialHint;
   * destructiveHint is MCP's name for the same idea as consequentialHint.
   */
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean; destructiveHint?: boolean }
  execute(input: Record<string, unknown>, client?: ToolClient): Promise<unknown>
}

const ok = (extra: object = {}) => ({ ok: true, ...extra })
const fail = (code: string, message: string, extra: object = {}) => ({ ok: false, code, message, ...extra })

/** Turns a Zod issue into one sentence an agent can act on. `fields` lists the tool's top-level fields. */
function describeIssue(issue: z.core.$ZodIssue, input: unknown, fields: string[]): string {
  const at = ["input", ...issue.path.map(String)].join(".")
  const value = issue.path.reduce<unknown>((v, key) => (v as Record<PropertyKey, unknown> | undefined)?.[key], input)
  const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)
  switch (issue.code) {
    case "invalid_type":
      return value === undefined ? `${at} is required` : `${at} must be ${issue.expected}, not ${kind(value)}`
    case "invalid_value":
      return `${at} must be one of ${issue.values.map((v) => JSON.stringify(v)).join(", ")}`
    case "unrecognized_keys": {
      const known = issue.path.length === 0 ? `. Fields: ${fields.join(", ") || "none"}` : ""
      return `${issue.keys.map((k) => `${at}.${k}`).join(", ")} isn't a field${known}`
    }
    default:
      return `${at}: ${issue.message}`
  }
}

/**
 * Defines a tool from a Zod schema. Browsers pass input through unchecked, so the
 * schema both describes the input to agents (as JSON Schema) and validates it; and
 * anything thrown comes back as an error result, so agents never see a raw exception.
 */
function tool<Shape extends z.core.$ZodShape>(def: {
  name: string
  description: string
  input: Shape
  annotations?: Tool["annotations"]
  execute(input: z.infer<z.ZodMiniObject<Shape, z.core.$strict>>, signal: AbortSignal | undefined): Promise<unknown>
}): Tool {
  const schema = z.strictObject(def.input)
  const { $schema: _, ...inputSchema } = z.toJSONSchema(schema)
  return {
    name: def.name,
    description: def.description,
    inputSchema,
    ...(def.annotations ? { annotations: def.annotations } : {}),
    execute: async (raw, client) => {
      const parsed = schema.safeParse(raw ?? {})
      if (!parsed.success) return fail("invalid_input", describeIssue(parsed.error.issues[0], raw, Object.keys(def.input)))
      try {
        return await def.execute(parsed.data, client?.signal)
      } catch (error) {
        return fail("error", error instanceof Error ? error.message : String(error))
      }
    },
  }
}

const sort = z.enum(["modified", "created", "title"])

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
  const notFound = (id: unknown) => fail("not_found", `No diagram with id ${String(id)}`)
  /** Asks the person, unless they turned confirmations off. Returns a failure result to send back, or null to go ahead. */
  const ask = async (signal: AbortSignal | undefined, message: string, declined: string, action?: string) => {
    if (signal?.aborted) return fail("cancelled", "The call was cancelled")
    if (!eos.getSettings().agent.confirmDestructive) return null
    const answer = await ui.confirm(message, action, signal)
    if (answer === "confirmed") return null
    if (signal?.aborted) return fail("cancelled", "The call was cancelled")
    return answer === "busy"
      ? fail("busy", "Another dialog is open in the page. Try again once it's closed")
      : fail("user_declined", declined)
  }
  const view = async () => {
    await ui.settled?.()
    return ui.getView()
  }
  /** Leaves a diagram page whose diagram no longer exists (after a wipe or a replacing import). */
  const leaveMissingDiagram = async () => {
    const route = (ui.getView() as { route?: { name?: string; id?: string } } | undefined)?.route
    if (route?.name === "diagram" && !(route.id && (await eos.getDiagram(route.id)))) ui.goHome()
  }

  return [
    // ── Reads ────────────────────────────────────────────────────────────────
    tool({
      name: "get_library",
      description:
        "The library: diagrams (id, title, tags, starred, dates), the tag tree with emoji and counts, and totals. Filters work like the sidebar: query (fuzzy title and contents), starred, tags (include nested tags), deleted (only diagrams in Deleted), sort.",
      input: {
        query: z.optional(z.string()),
        starred: z.optional(z.boolean()),
        tags: z.optional(z.array(z.string())),
        deleted: z.optional(z.boolean()),
        sort: z.optional(sort),
      },
      // Titles and sources are written by people (or imported), so they can carry text aimed at the agent.
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (i) =>
        ok({
          diagrams: (await eos.listDiagrams(i)).map(({ sourceText: _s, tagPrefixes: _p, titleKey: _k, ...row }) => ({
            ...row,
            starred: !!row.starred,
          })),
          tags: await eos.listTags(),
          counts: await eos.counts(),
        }),
    }),
    tool({
      name: "get_diagram",
      description:
        "One diagram: title, tags, starred, Mermaid source and the version id it's at (pass it to update_diagram as baseVersion or expectedVersion). version reads the source at a past version; history: true adds the version list, where agent edits are listed separately from the person's.",
      input: {
        id: z.string(),
        version: z.optional(z.string().check(z.describe("A version id from history"))),
        history: z.optional(z.boolean()),
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ id, version, history }) => {
        const found = await eos.getDiagram(id)
        if (!found) return notFound(id)
        const { version: current, ...d } = found
        // Any version the diagram has is readable, including ones from earlier tool results
        // that history has since folded into a later entry.
        let source = d.source
        if (version) {
          try {
            source = await eos.getSource(d.id, version)
          } catch (error) {
            if (!(error instanceof UnknownVersionError)) throw error
            return fail("not_found", `This diagram has no version ${version}`)
          }
        }
        const entries = history ? await eos.history(d.id, 500) : []
        return ok({
          diagram: { ...d, source },
          version: version ?? current,
          ...check(source),
          // Each entry lists everything that changed in it once, under changes.
          ...(history
            ? {
                history: entries.slice(0, 200).map(({ actor, ...e }) => {
                  const { changes: _c, ...who } = actor as Actor & { changes?: string[] }
                  return { ...e, actor: who }
                }),
              }
            : {}),
        })
      },
    }),
    tool({
      name: "get_view",
      description: "What the person is looking at: page, open diagram, library filters, preview zoom, whether Settings is open.",
      input: {},
      annotations: { readOnlyHint: true },
      execute: async () => ok({ view: await view() }),
    }),
    tool({
      name: "get_settings",
      description:
        "Settings, the theme in effect (light or dark, plus the full app --eos-* and diagram --pele-* CSS including defaults; Pele's variables are documented at https://pele.run/theming) and storage used.",
      input: {},
      annotations: { readOnlyHint: true },
      execute: async () => {
        const settings = eos.getSettings()
        return ok({
          settings,
          theme: {
            mode: settings.theme.mode,
            ...ui.getTheme(),
            overridden: { app: !!settings.theme.customCss, diagram: !!settings.theme.diagramCss },
          },
          storage: await eos.storageUsage(),
        })
      },
    }),
    tool({
      name: "export",
      description:
        "Export a diagram (id) or raw Mermaid (source). Formats: svg, png (data URL), mmd (with the version id it's at, for a diagram), link (a share link that opens a copy in anyone's Eos), backup (the whole library as JSON; no id needed). Invalid Mermaid returns parse_error with line and column, so this also works as a dry-run check. download: true also saves the file like the Export menu.",
      input: {
        format: z.enum(["svg", "png", "mmd", "link", "backup"]),
        id: z.optional(z.string()),
        source: z.optional(z.string().check(z.describe("Raw Mermaid, instead of id"))),
        includeTags: z.optional(z.boolean().check(z.describe("For link: include the diagram's tags"))),
        download: z.optional(z.boolean()),
      },
      annotations: { readOnlyHint: true },
      execute: async ({ format, id, source, includeTags, download }) => {
        if (format === "backup") {
          const data = await eos.exportBackup()
          if (download) ui.download("eos-backup.json", data)
          return ok({ data })
        }
        if (source === undefined && id === undefined) return fail("invalid_input", "Pass id or source (only backup needs neither)")
        const d = source === undefined ? await eos.getDiagram(id!) : null
        if (source === undefined && !d) return notFound(id)
        const text = source ?? d!.source
        const title = d?.meta.title ?? "diagram"
        if (format === "link") {
          const enc = await encodeShare({ title, source: text, tags: includeTags && d ? d.meta.tags : [] })
          return ok({ url: shareUrl(ui.origin, enc) })
        }
        const parsed = check(text)
        if (format === "mmd") {
          if (download) ui.download(`${title}.mmd`, text)
          return ok({ data: text, ...(d ? { version: d.version } : {}), ...parsed })
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
    }),
    // ── Writes ───────────────────────────────────────────────────────────────
    tool({
      name: "create_diagram",
      description:
        "Create a diagram from Mermaid source, or import one from an Eos share link (fromShareLink). To duplicate, read a diagram with get_diagram and create from its source. Opens it unless open is false. Returns the version id its source is at and whether the source parses.",
      input: {
        title: z.optional(z.string()),
        source: z.optional(z.string().check(z.describe("Mermaid source"))),
        tags: z.optional(z.array(z.string()).check(z.describe("Use slashes for nesting, e.g. work/backend"))),
        starred: z.optional(z.boolean()),
        fromShareLink: z.optional(z.string()),
        open: z.optional(z.boolean()),
      },
      execute: async (i) => {
        let id: DiagramId
        if (i.fromShareLink !== undefined) {
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
          id = await eos.createDiagram({ title: i.title, source: i.source, tags: i.tags }, agent("create_diagram", ["created"]))
        }
        // Read before opening it, so the version is the source as created, without anything typed since.
        const d = (await eos.getDiagram(id))!
        if (i.starred) await eos.setStarred(id, true, agent("create_diagram"))
        if (i.open !== false) ui.openDiagram(id)
        return ok({ id, version: d.version, ...check(d.source) })
      },
    }),
    tool({
      name: "update_diagram",
      description:
        "Edit a diagram. Every field is optional and the edit lands as one change in history, credited to the agent: title, source (full Mermaid; applied as a minimal diff), starred, addTags, removeTags. revert: \"undo\" or \"redo\" steps back or forward through the agent's own edits, keeping the person's, or a version id from get_diagram's history restores that version. deleted: true moves it to Deleted (asks the person; reversible), false restores it. Pass baseVersion, the version id returned with the source you edited, to merge your source as the changes you made to it, keeping edits others made since; without it, source replaces the text. When others' edits were merged in, the result includes the merged source. expectedVersion refuses the edit if anything changed since that version.",
      input: {
        id: z.string(),
        title: z.optional(z.string()),
        source: z.optional(z.string()),
        starred: z.optional(z.boolean()),
        addTags: z.optional(z.array(z.string())),
        removeTags: z.optional(z.array(z.string())),
        revert: z.optional(z.string().check(z.describe('"undo", "redo" or a version id'))),
        deleted: z.optional(z.boolean()),
        baseVersion: z.optional(z.string()),
        expectedVersion: z.optional(z.string()),
      },
      execute: async (i, signal) => {
        const { id } = i
        const d = await eos.getDiagram(id)
        if (!d) return notFound(id)
        if (i.expectedVersion !== undefined && i.expectedVersion !== d.version)
          return fail("stale", "The diagram changed since that version; read it again", { version: d.version })
        if (i.revert !== undefined && i.source !== undefined) return fail("invalid_input", "Use either revert or source, not both")
        // Asked before anything changes, so a declined delete leaves the whole edit undone.
        if (i.deleted === true) {
          const refused = await ask(signal, `The agent wants to move “${d.meta.title}” to Deleted.`, "The person declined to delete it")
          if (refused) return refused
        }

        const changes = (["title", "source", "addTags", "removeTags"] as const)
          .filter((k) => i[k] !== undefined)
          .map((k) => (k.endsWith("Tags") ? "tags" : k))
        if (i.revert !== undefined) {
          const r = i.revert
          if (r === "undo" || r === "redo") {
            const done = await eos[r](id, "agent", agent("update_diagram", [r]))
            if (!done) return fail("nothing_to_revert", `No agent edit to ${r}`)
          } else {
            try {
              await eos.restoreVersion(id, r, agent("update_diagram", ["restored version"]))
            } catch (error) {
              if (!(error instanceof UnknownVersionError)) throw error
              return fail("not_found", `revert must be "undo", "redo" or a version id; this diagram has no version ${r}`)
            }
          }
        }
        if (changes.length) {
          try {
            await eos.editDiagram(
              id,
              { title: i.title, source: i.source, addTags: i.addTags, removeTags: i.removeTags },
              agent("update_diagram", [...new Set(changes)]),
              { base: i.baseVersion }
            )
          } catch (error) {
            if (!(error instanceof UnknownVersionError)) throw error
            return fail("not_found", `This diagram has no version ${i.baseVersion}`)
          }
        }
        if (i.starred !== undefined) await eos.setStarred(id, i.starred, agent("update_diagram", ["starred"]))
        if (i.deleted === true) await eos.deleteDiagram(id)
        else if (i.deleted === false) await eos.restoreDiagram(id)

        const now = (await eos.getDiagram(id))!
        return ok({
          version: now.version,
          ...(i.source !== undefined && now.source !== i.source ? { source: now.source } : {}),
          ...check(now.source),
          agentUndo: await eos.canUndo(id, "agent"),
        })
      },
    }),
    tool({
      name: "update_tag",
      description:
        'Rename or move a tag (and everything nested under it) across every diagram, and/or set its sidebar icon. moveTo is the new full path: "archive/backend" nests it, "backend" puts it at the top level. emoji: an emoji, or null for the default #.',
      input: { path: z.string(), moveTo: z.optional(z.string()), emoji: z.optional(z.nullable(z.string())) },
      execute: async ({ path, moveTo, emoji }) => {
        let current = path
        if (moveTo !== undefined && moveTo !== current) {
          await eos.renameTag(current, moveTo, agent("update_tag", ["tags"]))
          current = moveTo
        }
        if (emoji !== undefined) await eos.setTagEmoji(current, emoji, agent("update_tag"))
        return ok({ path: current })
      },
    }),
    tool({
      name: "set_view",
      description:
        'Change what the person sees. page: "library" (with optional filters) or "diagram" (with diagramId). previewVersion shows a past version of the open diagram read-only, or "latest" to go back. zoom changes the preview. settingsOpen shows or hides Settings.',
      input: {
        page: z.optional(z.enum(["library", "diagram"])),
        diagramId: z.optional(z.string()),
        filters: z.optional(
          z.strictObject({
            starred: z.optional(z.boolean()),
            deleted: z.optional(z.boolean()),
            tags: z.optional(z.array(z.string())),
            sort: z.optional(sort),
          })
        ),
        previewVersion: z.optional(z.string().check(z.describe('A version id from get_diagram\'s history, or "latest"'))),
        zoom: z.optional(z.enum(["in", "out", "fit", "actual"])),
        settingsOpen: z.optional(z.boolean()),
      },
      execute: async (i) => {
        if (i.page === "library") {
          if (i.filters) ui.setLibraryView(i.filters)
          else ui.goHome()
        }
        const id = i.diagramId
        if (i.page === "diagram" || i.previewVersion !== undefined) {
          if (!id || !(await eos.getDiagram(id))) return notFound(id)
          ui.openDiagram(id)
        }
        if (id && i.previewVersion !== undefined) {
          if (i.previewVersion === "latest") ui.previewVersion(id, null)
          else {
            const entry = (await eos.history(id, 500)).find((e) => e.version === i.previewVersion)
            if (!entry)
              return fail(
                "not_found",
                'previewVersion must be a version id from get_diagram\'s history (it shows who made it and when), or "latest"'
              )
            ui.previewVersion(id, entry.version, {
              at: entry.at,
              label: entry.actor.kind === "agent" ? "Agent" : entry.actor.kind === "user" ? "You" : entry.actor.kind,
            })
          }
        }
        if (i.zoom !== undefined) ui.setZoom(i.zoom)
        if (i.settingsOpen !== undefined) ui.openSettings(i.settingsOpen)
        return ok({ view: await view() })
      },
    }),
    tool({
      name: "set_theme",
      description:
        "Change the theme: mode (light, dark or system), appCss (--eos-* variables) and/or diagramCss (--pele-* variables). Start from the CSS get_settings returns. null resets an override to the default.",
      input: {
        mode: z.optional(z.enum(["system", "light", "dark"])),
        appCss: z.optional(z.nullable(z.string())),
        diagramCss: z.optional(z.nullable(z.string())),
      },
      execute: async ({ mode, appCss, diagramCss }) => {
        await eos.updateSettings({
          theme: {
            ...(mode !== undefined ? { mode } : {}),
            ...(appCss !== undefined ? { customCss: appCss } : {}),
            ...(diagramCss !== undefined ? { diagramCss } : {}),
          } as never,
        })
        return ok({ theme: eos.getSettings().theme })
      },
    }),
    // ── Permanent deletes (each asks the person) ─────────────────────────────
    tool({
      name: "delete_tag",
      description: "Remove a tag, and tags nested under it, from every diagram. Asks the person to confirm. Diagrams themselves are kept.",
      input: { path: z.string() },
      annotations: { consequentialHint: true, destructiveHint: true },
      execute: async ({ path }, signal) => {
        const refused = await ask(signal, `The agent wants to remove the tag “${path}” from every diagram.`, "The person declined")
        if (refused) return refused
        return ok({ diagrams: await eos.deleteTag(path, agent("delete_tag", ["tags"])) })
      },
    }),
    tool({
      name: "import_backup",
      description:
        "Import a backup (from export with format backup). merge adds to the library; replace wipes local data first and asks the person to confirm.",
      input: { data: z.string(), mode: z.enum(["merge", "replace"]) },
      annotations: { consequentialHint: true, destructiveHint: true },
      execute: async ({ data, mode }, signal) => {
        // Check the file before asking, so the person is never asked to replace their library with junk.
        let backup: Backup
        try {
          backup = readBackup(data)
        } catch (error) {
          return fail("invalid_input", `${(error as Error).message}. Pass what export returns with format backup.`)
        }
        if (mode === "replace") {
          const refused = await ask(signal, "The agent wants to replace all your diagrams with a backup.", "The person declined", "Replace")
          if (refused) return refused
        }
        await eos.importBackup(backup, mode)
        await leaveMissingDiagram()
        return ok({ counts: await eos.counts() })
      },
    }),
    tool({
      name: "delete_all_data",
      description:
        "Delete every diagram in this browser, with its stars and tag emoji. Settings are kept. Asks the person to confirm. Can't be undone.",
      input: {},
      annotations: { consequentialHint: true, destructiveHint: true },
      execute: async (_, signal) => {
        const refused = await ask(signal, "The agent wants to delete all your diagrams. This can’t be undone.", "The person declined")
        if (refused) return refused
        await eos.deleteAll()
        await leaveMissingDiagram()
        return ok()
      },
    }),
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

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { Annotation, EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state"
import { Decoration, EditorView, keymap, lineNumbers, drawSelection, highlightSpecialChars, type DecorationSet } from "@codemirror/view"
import { useEffect, useId, useRef } from "react"

import type { SourceBinding, TextChange } from "@eos/core"

import { languageExtension, type CodeLanguage } from "@/lib/mermaid-language"

const external = Annotation.define<boolean>()
const setErrorLine = StateEffect.define<number | null>()

const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (!e.value || e.value > tr.state.doc.lines) return Decoration.none
        const line = tr.state.doc.line(e.value)
        return Decoration.set([Decoration.line({ class: "cm-error-line" }).range(line.from)])
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "var(--eos-fs-code)", backgroundColor: "transparent" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.72", padding: "14px 0" },
    ".cm-content": { caretColor: "var(--eos-body)" },
    // Opaque, since code scrolled sideways passes under it: the surface the editor sits on (a card by default).
    ".cm-gutters": {
      backgroundColor: "var(--editor-surface, var(--card))",
      border: "none",
      color: "var(--eos-faint)",
      paddingLeft: "12px",
    },
    // Room for two digits, so the code doesn't shift right when a diagram reaches line 10.
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 5px", minWidth: "calc(2ch + 19px)" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--eos-selection) !important" },
    ".cm-cursor": { borderLeftColor: "var(--eos-body)" },
    ".cm-error-line": { backgroundColor: "color-mix(in srgb, var(--eos-red) 12%, transparent)" },
    // The marker for a stray \r: CodeMirror's own colour is for a dark editor, which `dark: true` claims in both modes.
    ".cm-specialChar": { color: "var(--eos-red)" },
  },
  { dark: true }
)

const noGutterTheme = EditorView.theme({ ".cm-scroller": { padding: "10px 14px" } })

export interface CodeEditorHandle {
  focusLine(line: number, column: number): void
}

export function CodeEditor({
  value,
  binding,
  onChange,
  onUndo,
  onRedo,
  errorAt = null,
  handleRef,
  language = "mermaid",
  label = "Mermaid source",
  readOnly = false,
  gutter = true,
  wrap = false,
}: {
  /** The text to show. Ignored when `binding` is given. */
  value?: string
  /**
   * Links the editor to a diagram's source in Loro: keystrokes go in as individual
   * edits and every other change (other tabs, agents, undo) comes out the same way,
   * so concurrent edits merge instead of overwriting each other.
   */
  binding?: SourceBinding
  /** Called with the full text after every change. Without a binding, a change that came in through `value` isn't reported back. */
  onChange?: (value: string) => void
  /** When given, undo/redo go to these (e.g. Loro); otherwise CodeMirror keeps its own history. */
  onUndo?: () => void
  onRedo?: () => void
  errorAt?: number | null
  handleRef?: React.RefObject<CodeEditorHandle | null>
  language?: CodeLanguage
  label?: string
  readOnly?: boolean
  gutter?: boolean
  /** Wrap long lines instead of scrolling sideways (for short read-only snippets). */
  wrap?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const hintId = useId()
  const view = useRef<EditorView | null>(null)
  // Values sent to onChange that haven't come back as `value` yet, oldest first.
  const reported = useRef<string[]>([])
  const callbacks = useRef({ onChange, onUndo, onRedo })
  callbacks.current = { onChange, onUndo, onRedo }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: binding ? binding.text() : (value ?? ""),
        extensions: [
          gutter ? lineNumbers() : [],
          drawSelection(),
          EditorState.tabSize.of(2),
          // "\n" is the only line break, so the editor counts a "\r" (in a diagram saved before sources were
          // normalised) as a character, as Loro does, and their positions always match. A "\r" pasted or
          // dropped in is a line break, as it is anywhere else.
          EditorState.lineSeparator.of("\n"),
          EditorView.clipboardInputFilter.of((text) => text.replace(/\r\n?/g, "\n")),
          // Shows a "\r", and other invisible control characters, as a marker (␍), so what is typed next to one is where it looks.
          highlightSpecialChars(),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          // Escape arms CodeMirror's Escape-then-Tab exit (see the hint below), whether or not it also collapses a
          // selection; it returns false, so the default keymap still collapses one. In a dialog, onEscape below
          // takes Escape first and arms the exit itself, and the selection stays.
          keymap.of([{ key: "Escape", run: (v) => (v.setTabFocusMode(2000), false) }]),
          onUndo
            ? // Undo goes through Loro: the person's own stack, which skips agent edits.
              keymap.of([
                { key: "Mod-z", run: () => (callbacks.current.onUndo?.(), true), preventDefault: true },
                { key: "Mod-Shift-z", run: () => (callbacks.current.onRedo?.(), true), preventDefault: true },
                { key: "Mod-y", run: () => (callbacks.current.onRedo?.(), true), preventDefault: true },
                indentWithTab,
                ...defaultKeymap,
              ])
            : [history(), keymap.of([...historyKeymap, indentWithTab, ...defaultKeymap])],
          languageExtension(language),
          errorLine,
          theme,
          gutter ? [] : noGutterTheme,
          wrap ? EditorView.lineWrapping : [],
          EditorView.contentAttributes.of({
            "aria-label": label,
            ...(readOnly ? {} : { "aria-describedby": hintId }),
            spellcheck: "false",
            autocapitalize: "off",
          }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            if (binding && !u.transactions.some((t) => t.annotation(external))) {
              const changes: TextChange[] = []
              u.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, insert: inserted.toString() }))
              binding.edit(changes)
            }
            if (binding || !u.transactions.some((t) => t.annotation(external))) {
              const doc = u.state.doc.toString()
              if (!binding && reported.current.push(doc) > 50) reported.current.shift()
              callbacks.current.onChange?.(doc)
            }
          }),
        ],
      }),
    })
    view.current = v
    // An editor without focus takes no input. Its selection can stay in it after focus leaves (WebKit, a click on
    // Star or the preview), and a key, a paste, a cut or committed text from wherever focus went (Settings, a
    // confirm) is sent to it, or to the focused control, as one of these events. They're cancelled at the document,
    // whatever their target, so nothing changes and the selection stays, to be copied. A drop focuses the editor
    // first; agent edits, undo and other tabs aren't DOM input.
    const unfocused = (e: Event) => {
      const at = getSelection()?.anchorNode
      if (v.root.activeElement !== v.contentDOM && at && v.contentDOM.contains(at)) e.preventDefault()
    }
    const inputs = ["beforeinput", "paste", "cut"] as const
    if (!readOnly) for (const type of inputs) document.addEventListener(type, unfocused, true)
    if (handleRef) {
      handleRef.current = {
        focusLine(line, column) {
          const target = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)))
          const from = Math.min(target.to, target.from + Math.max(0, column - 1))
          v.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: "center" }) })
          v.focus()
        },
      }
    }
    // Changes from elsewhere arrive as edits, in the coordinates of the text the editor shows.
    const unbind = binding?.onChange((changes, own) => {
      const apply = () => {
        // The caret stays with the text of its own line. A line someone else adds at the caret ("\n…") goes after
        // it, unless the caret is at the start of its line's text, where the line is added above; anything else
        // they insert there (a line above, text within the line) goes before it. Text the person's own undo, redo
        // or restore puts back goes before the caret, as CodeMirror's undo does.
        const set = v.state.changes(changes)
        const assoc = (at: number) => {
          if (own || !changes.some((c) => c.from === at && c.to === at && c.insert.startsWith("\n"))) return 1
          const line = v.state.doc.lineAt(at)
          return at <= line.from + line.text.search(/\S/) ? 1 : -1
        }
        const selection = EditorSelection.create(
          v.state.selection.ranges.map((r) => r.map(set, assoc(r.head))),
          v.state.selection.mainIndex
        )
        v.dispatch({ changes: set, selection, annotations: external.of(true) })
        // Belt and braces: if the two ever disagree, show what's stored.
        const stored = binding.text()
        if (v.state.doc.toString() !== stored) {
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: stored }, annotations: external.of(true) })
        }
      }
      // A change can land while CodeMirror is mid-update, which it refuses; apply it right after.
      try {
        apply()
      } catch {
        queueMicrotask(apply)
      }
    })
    // In a dialog, Radix takes Escape at the document to close it, before CodeMirror sees it, and the
    // unsaved text goes with it. Get there first and keep Escape for CodeMirror's own way out: then Tab.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !v.hasFocus || !v.dom.closest("[role=dialog]")) return
      e.preventDefault()
      v.setTabFocusMode(2000)
    }
    if (!readOnly) window.addEventListener("keydown", onEscape, true)
    return () => {
      window.removeEventListener("keydown", onEscape, true)
      for (const type of inputs) document.removeEventListener(type, unfocused, true)
      unbind?.()
      v.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Without a binding, apply a new value as a minimal patch. A value this editor reported itself
  // is coming back late, while typing may have moved on; patching it in would undo those keystrokes.
  useEffect(() => {
    const v = view.current
    if (!v || binding || value === undefined) return
    const own = reported.current.indexOf(value)
    if (own >= 0) return void reported.current.splice(0, own + 1)
    reported.current = []
    const prev = v.state.doc.toString()
    if (prev === value) return
    let from = 0
    let to = prev.length
    let end = value.length
    while (from < to && from < end && prev[from] === value[from]) from++
    while (to > from && end > from && prev[to - 1] === value[end - 1]) {
      to--
      end--
    }
    v.dispatch({ changes: { from, to, insert: value.slice(from, end) }, annotations: external.of(true) })
  }, [value, binding])

  useEffect(() => {
    view.current?.dispatch({ effects: setErrorLine.of(errorAt) })
  }, [errorAt])

  return (
    <div ref={host} className="min-h-0 flex-1 overflow-hidden">
      {/* Tab indents, so say how to leave with the keyboard (CodeMirror's Escape-then-Tab). */}
      {!readOnly && (
        <span id={hintId} hidden>
          Tab indents. Press Escape, then Tab, to move focus out of the editor.
        </span>
      )}
    </div>
  )
}

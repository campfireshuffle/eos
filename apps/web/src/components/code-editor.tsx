import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { Annotation, EditorState, StateEffect, StateField } from "@codemirror/state"
import { Decoration, EditorView, keymap, lineNumbers, drawSelection, type DecorationSet } from "@codemirror/view"
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
    "&": { height: "100%", fontSize: "var(--eos-fs-body)", backgroundColor: "transparent" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.72", padding: "14px 0" },
    ".cm-content": { caretColor: "var(--eos-body)" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--eos-faint)", paddingLeft: "12px" },
    ".cm-lineNumbers .cm-gutterElement": { minWidth: "22px", paddingRight: "14px" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--eos-selection) !important" },
    ".cm-cursor": { borderLeftColor: "var(--eos-body)" },
    ".cm-error-line": { backgroundColor: "color-mix(in srgb, var(--eos-red) 12%, transparent)" },
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
  /** Called with the full text after every change, local or not. */
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
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
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
            if (binding || !u.transactions.some((t) => t.annotation(external))) callbacks.current.onChange?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
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
    const unbind = binding?.onChange((changes) => {
      const apply = () => {
        v.dispatch({ changes, annotations: external.of(true) })
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
      unbind?.()
      v.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Without a binding, apply a new value as a minimal patch.
  useEffect(() => {
    const v = view.current
    if (!v || binding || value === undefined) return
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

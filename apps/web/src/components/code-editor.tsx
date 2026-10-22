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
  /** The starting text; to replace it, remount with a new `key`. Ignored when `binding` is given. */
  value?: string
  /**
   * Links the editor to a diagram's source in Loro: keystrokes go in as individual
   * edits and every other change (other tabs, agents, undo) comes out the same way,
   * so concurrent edits merge instead of overwriting each other.
   */
  binding?: SourceBinding
  /** Called with the full text after every change. */
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
          // "\n" is the only line break, so the editor counts a "\r" (in a diagram saved before sources were
          // normalised) as a character, as Loro does, and their positions always match. A "\r" pasted or
          // dropped in is a line break, as it is anywhere else.
          EditorState.lineSeparator.of("\n"),
          EditorView.clipboardInputFilter.of((text) => text.replace(/\r\n?/g, "\n")),
          // Shows a "\r", and other invisible control characters, as a marker (␍), so what is typed next to one is where it looks.
          highlightSpecialChars(),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          // Escape arms CodeMirror's Escape-then-Tab exit (see the hint below). In a dialog it's handled, so the key
          // stops here and the dialog stays open with the unsaved text; elsewhere the default keymap still collapses a selection.
          keymap.of([{ key: "Escape", run: (v) => (v.setTabFocusMode(2000), !!v.dom.closest("dialog")) }]),
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
            if (binding && u.docChanged && !u.transactions.some((t) => t.annotation(external))) {
              const changes: TextChange[] = []
              u.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, insert: inserted.toString() }))
              binding.edit(changes)
            }
            // After the edit, so the edit's undo step keeps the selection from before it.
            if (u.selectionSet) binding?.select(u.state.selection.main.anchor, u.state.selection.main.head)
            if (u.docChanged) callbacks.current.onChange?.(u.state.doc.toString())
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
    // The person's own undo and redo put back the selection from before the step (see SourceBinding.select).
    const unselect = binding?.onSelect((anchor, head) => v.dispatch({ selection: { anchor, head }, scrollIntoView: true }))
    // Changes from elsewhere arrive as edits, in the coordinates of the text the editor shows. CodeMirror maps the
    // selection: what's inserted at a caret goes after it, but a caret at the start of a line sticks to the line's text
    // (assoc 1), so what's inserted there goes before it. Setting the selection ends a composition, so it's set only
    // when that moves a caret, never while composing.
    const unbind = binding?.onChange((changes) => {
      const apply = () => {
        const set = v.state.changes(changes)
        const { selection, doc } = v.state
        const mapped = selection.map(set)
        const sticky = EditorSelection.create(
          selection.ranges.map((r) => r.map(set, r.empty && doc.lineAt(r.head).from === r.head ? 1 : -1)),
          selection.mainIndex
        )
        v.dispatch({ changes: set, selection: v.composing || sticky.eq(mapped) ? undefined : sticky, annotations: external.of(true) })
      }
      // A change can land while CodeMirror is mid-update, which it refuses; apply it right after.
      try {
        apply()
      } catch {
        queueMicrotask(apply)
      }
    })
    return () => {
      for (const type of inputs) document.removeEventListener(type, unfocused, true)
      unbind?.()
      unselect?.()
      v.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

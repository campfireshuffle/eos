import { css } from "@codemirror/lang-css"
import { json } from "@codemirror/lang-json"
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import type { Extension } from "@codemirror/state"
import { tags as t } from "@lezer/highlight"

const KEYWORDS =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|journey|gitGraph|timeline|quadrantChart|requirementDiagram|C4\w+|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|kanban|architecture(-beta)?|radar(-beta)?|treemap(-beta)?|subgraph|end|participant|actor|loop|alt|else|opt|par|and|note|section|title|dateFormat|direction|class|state|style|classDef|linkStyle|click|root|TD|TB|BT|LR|RL)\b/

/** A light Mermaid tokenizer: enough for keywords, labels, arrows and comments. */
const mermaid = StreamLanguage.define<{ depth: number }>({
  startState: () => ({ depth: 0 }),
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match("%%")) {
      stream.skipToEnd()
      return "comment"
    }
    if (stream.match(/^"[^"]*"/)) return "string"
    if (stream.match(/^[[({]+[^\])}]*[\])}]+/)) return "string"
    if (stream.match(/^(-->|---|-\.->|==>|-\.-|--[ox]|<-->|->>|-->>|-[x)]|\|[^|]*\|)/)) return "operator"
    if (stream.match(/^\d+(\.\d+)?/)) return "number"
    if (stream.match(KEYWORDS)) return "keyword"
    if (stream.match(/^[A-Za-z_][\w-]*/)) return "variableName"
    stream.next()
    return null
  },
})

/** One palette for every code surface in Eos. */
const style = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: "var(--eos-syntax-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--eos-syntax-string)" },
  { tag: [t.variableName, t.propertyName, t.attributeName, t.labelName], color: "var(--eos-syntax-property)" },
  { tag: [t.definition(t.variableName), t.function(t.variableName), t.className, t.tagName], color: "var(--eos-syntax-definition)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.color, t.unit], color: "var(--eos-syntax-number)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "var(--eos-muted)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--eos-syntax-comment)", fontStyle: "italic" },
])

const highlight = syntaxHighlighting(style)

export type CodeLanguage = "mermaid" | "css" | "json" | "shell"

export function languageExtension(language: CodeLanguage): Extension {
  switch (language) {
    case "css":
      return [css(), highlight]
    case "json":
      return [json(), highlight]
    case "shell":
      return [StreamLanguage.define(shell), highlight]
    default:
      return [mermaid, highlight]
  }
}

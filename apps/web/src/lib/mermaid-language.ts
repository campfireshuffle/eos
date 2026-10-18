import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language"
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

const style = HighlightStyle.define([
  { tag: t.keyword, color: "var(--eos-champagne)" },
  { tag: t.string, color: "#b9c59a" },
  { tag: t.variableName, color: "#d9a684" },
  { tag: t.operator, color: "var(--eos-muted)" },
  { tag: t.number, color: "#9fb6d9" },
  { tag: t.comment, color: "#6b6b69", fontStyle: "italic" },
])

export const mermaidHighlighting = [mermaid, syntaxHighlighting(style)]

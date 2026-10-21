import { PeleError, render } from "pele"

export interface Diagnostic {
  line: number
  column: number
  message: string
  snippet: string
}

export function validate(source: string): { ok: true; type: string } | { ok: false; error: Diagnostic } {
  try {
    const { type } = render(source)
    return { ok: true, type }
  } catch (e) {
    return { ok: false, error: atRealLine(diagnose(e), source) }
  }
}

/** Pele reports some errors at the end of the text (a dangling arrow, an unclosed bracket) on a
 * line past it: point those just after the last line with text instead, as Pele would there. */
function atRealLine(error: Diagnostic, source: string): Diagnostic {
  const lines = source.split("\n")
  if (error.line <= lines.length) return error
  const last = lines.findLastIndex((text) => text.trim() !== "")
  if (last < 0) return error
  const text = lines[last]!
  const column = text.length + 1
  return { ...error, line: last + 1, column, snippet: `${text}\n${"-".repeat(column - 1)}^` }
}

export function diagnose(error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : String(error)
  const title = (message.split("\n")[0] ?? "").replace(/ on line \d+/, "").replace(/:$/, "")
  if (error instanceof PeleError) {
    return { line: error.line, column: error.column, message: title, snippet: error.snippet }
  }
  return { line: 0, column: 0, message: title, snippet: "" }
}

export function renderSvg(source: string, idPrefix?: string): string {
  return render(source, { idPrefix }).svg
}

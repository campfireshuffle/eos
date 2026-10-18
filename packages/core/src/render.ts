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
    return { ok: false, error: diagnose(e) }
  }
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

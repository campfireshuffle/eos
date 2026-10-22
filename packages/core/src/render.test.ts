import { describe, expect, it } from "vitest"

import { validate } from "./render"

const errorOf = (source: string) => {
  const result = validate(source)
  if (result.ok) throw new Error(`expected ${JSON.stringify(source)} not to render`)
  return result.error
}

describe("validate", () => {
  it("accepts a valid diagram", () => {
    expect(validate("flowchart LR\n  A --> B\n")).toEqual({ ok: true, type: expect.any(String) })
  })

  it("points an error at the end of the text at its last line", () => {
    const dangling = errorOf("flowchart LR\n  A --> B -->")
    expect(dangling.line).toBe(2)
    expect(dangling.column).toBe(14)
    expect(dangling.snippet).toBe("  A --> B -->\n-------------^")
    expect(errorOf("flowchart LR\n  A --> B -->\n")).toEqual(dangling)
    expect(errorOf("flowchart LR\n  A --> B[End")).toMatchObject({ line: 2, column: 14 })
  })

  it("leaves an error on a real line as it is", () => {
    expect(errorOf("sequenceDiagram\n  Alice->>Bob: hi\n  ???\n  Bob->>Alice: ok\n")).toMatchObject({
      line: 3,
      column: 6,
      snippet: "  ???\n-----^",
    })
    expect(errorOf("flowchart LR\n  A --> B\n  C -->> D\n  E --> F")).toMatchObject({
      line: 3,
      column: 8,
      snippet: "  C -->> D\n-------^",
    })
    // On the text's last line: inside it, not clamped past its end.
    expect(errorOf("flowchart LR\n  C -->> D")).toMatchObject({ line: 2, column: 8 })
  })
})

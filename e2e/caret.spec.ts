import { expect, test, type Page } from "@playwright/test"

import { editorText, expectEditor, newDiagram, openEditor, storedText, tool, withAgentTools } from "./helpers"

// Where text someone else inserts lands relative to the person's caret and line: caret spot × insertion × source
// (the cells `runs` picks). CodeMirror maps the caret: what's inserted at it goes after it. Then edits an agent merges
// from an older version while the person types, which keep what both typed, the person's typing together.

const SPOTS = {
  "start of an unindented line": { line: "A --> B", col: 0 },
  "start of an indented line, before its indent": { line: "  A --> B", col: 0 },
  "start of an indented line's text": { line: "  A --> B", col: 2 },
  "middle of a line": { line: "  A --> B", col: 3 },
  "end of a line": { line: "  A --> B", col: 9 },
  "empty line": { line: "", col: 0 },
  "end of the last line": { line: "  A --> B", col: 9, last: true },
  "empty last line": { line: "", col: 0, last: true },
} as Record<string, { line: string; col: number; last?: boolean }>

const INSERTS = {
  "a line after (\\n…)": "\n  X --> Y",
  "a line before (…\\n)": "  X --> Y\n",
  "a line between (\\n…\\n)": "\n  X --> Y\n",
  "a blank line (\\n)": "\n",
  "an indented blank line (\\n  )": "\n  ",
  "text (no newline)": "X",
  "text then a line (…\\n…)": "2\n  X --> Y",
} as const

const doc = (line: string, last = false) => (last ? `graph TD\n${line}` : `graph TD\n${line}\n  C --> D`)
const HEAD = "graph TD\n".length

/**
 * How far past the insertion's start the caret ends up. The person's own undo and redo leave it at the end of what
 * they put back. Someone else's insertion at the caret goes after it, as CodeMirror maps the caret, unless the caret is at
 * the start of a line, where it sticks to the line's text. An agent's source is diffed by lines, so a line it adds
 * above the caret's line, when the caret is past that line's start, goes in at the line's start, before the caret, and
 * one it adds below an empty line, not the last, goes in at the start of the next line, after it.
 */
function expectedCaret(line: string, col: number, last: boolean, insert: string, by: (typeof SOURCES)[number]) {
  const before = line.slice(0, col)
  if (by === "an agent" && line === "" && !last && insert.startsWith("\n")) return 0
  if (by === "own undo" || by === "own redo" || col === 0) return insert.length
  return by === "an agent" && (before + insert).endsWith("\n" + before) ? insert.length : 0
}

async function caretAt(page: Page, pos: number) {
  await page.locator(".cm-content").click()
  await page.keyboard.press("ControlOrMeta+Home")
  for (let i = 0; i < pos; i++) await page.keyboard.press("ArrowRight")
}

/** Inserts `text` at `pos` as the editor's own edit (a paste, a drop): CodeMirror's view, found from its DOM. */
async function insertAt(page: Page, pos: number, text: string) {
  await page.evaluate(
    ([at, t]) => {
      const content = document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: { dispatch(spec: unknown): void } } }
      }
      content.cmTile.root.view.dispatch({ changes: { from: at, insert: t }, userEvent: "input.paste" })
    },
    [pos, text] as const
  )
}

// A restore remounts the editor (it shows the past version read-only first), so the caret isn't carried over: not in the matrix.
const SOURCES = ["another tab", "an agent", "own undo", "own redo"] as const

/**
 * The cells of spot × insertion × source that run. Someone else's line break at the start of a line (or of its text)
 * runs everywhere, as does an agent's line added above before an indent, where the agent's line diff decides where the
 * insertion goes. Otherwise each source meets each spot once, the insertion rotating so that it also meets each of the
 * first six, plus an own redo of a line. Text then a line, from another tab or an agent, runs at every spot. An
 * agent's line added in the middle of a line, which the diff slides a character off the caret, isn't run (contrived).
 */
function runs(spot: number, insert: number, source: number) {
  const spotName = Object.keys(SPOTS)[spot]!
  const text = Object.values(INSERTS)[insert]!
  const by = SOURCES[source]
  if ((by === "another tab" || by === "an agent") && spotName.startsWith("start of") && text.startsWith("\n")) return true
  if (by === "an agent" && spotName === "start of an indented line, before its indent" && text === "  X --> Y\n") return true
  if (by === "own redo" && spotName === "end of a line" && text === "\n  X --> Y") return true
  if (text === "2\n  X --> Y") return by === "another tab" || by === "an agent"
  return insert === (spot + source) % 6
}

// What's checked here is the same in every engine: CodeMirror maps the caret, and the merges are core's
// diff. So every test runs on Chromium, and these few on every engine too, for the wiring.
const EVERY_ENGINE = new Set([
  "another tab: a blank line (\\n) at the caret at the middle of a line",
  "another tab: a line after (\\n…) at the caret at the start of an indented line's text",
  "an agent: text then a line (…\\n…) at the caret at the end of a line",
  "own redo: a line after (\\n…) at the caret at the end of a line",
  'merge: the person types at the end of a line while an agent changes it to "A --> B2" and adds a line below',
])
test.beforeEach(({ browserName }, info) => test.skip(browserName !== "chromium" && !EVERY_ENGINE.has(info.title)))
test.beforeEach(async ({ context }) => withAgentTools(context))

for (const [spot, [spotName, { line, col, last }]] of Object.entries(SPOTS).entries()) {
  for (const [i, [insertName, insert]] of Object.entries(INSERTS).entries()) {
    for (const [s, source] of SOURCES.entries()) {
      if (!runs(spot, i, s)) continue
      test(`${source}: ${insertName} at the caret at the ${spotName}`, async ({ context }) => {
        const before = doc(line, last)
        const p = HEAD + col
        const after = before.slice(0, p) + insert + before.slice(p)
        const q = p + expectedCaret(line, col, !!last, insert, source)
        const expected = after.slice(0, q) + "Z" + after.slice(q)
        const a = await context.newPage()
        const id = await newDiagram(a, source === "own undo" ? after : before)
        await openEditor(a, id)
        if (source === "another tab") {
          const b = await context.newPage()
          await openEditor(b, id)
          await caretAt(a, p)
          await caretAt(b, p)
          await insertAt(b, p, insert)
        } else if (source === "an agent") {
          await caretAt(a, p)
          await tool(a, "update_diagram", { id, source: after })
        } else if (source === "own undo") {
          await caretAt(a, p)
          for (let i = 0; i < insert.length; i++) await a.keyboard.press("Shift+ArrowRight")
          await a.keyboard.press("Backspace")
          await expectEditor(a, before)
          await a.waitForTimeout(1000)
          await a.keyboard.press("ControlOrMeta+z")
          await expectEditor(a, after)
        } else {
          await caretAt(a, p)
          await insertAt(a, p, insert)
          await expectEditor(a, after)
          await a.waitForTimeout(1000)
          await a.keyboard.press("ControlOrMeta+z")
          await expectEditor(a, before)
          await a.keyboard.press("ControlOrMeta+Shift+Z")
        }
        await expectEditor(a, after)
        await a.keyboard.type("Z")
        await expectEditor(a, expected)
        expect(await storedText(a, id)).toBe(expected)
      })
    }
  }
}

// baseVersion merges: the person types "ob" at the spot after the agent reads; the agent then adds a line below
// the caret's line, a line above it, a blank line above it, or text at the spot. Then the person types "!".
const CHANGES = {
  "a line below": (l: string, _c: number) => ({ line: l, below: "  X --> Y" }),
  "a line above": (l: string, _c: number) => ({ line: l, above: "  X --> Y" }),
  "a blank line above": (l: string, _c: number) => ({ line: l, above: "" }),
  "an indented blank line above": (l: string, _c: number) => ({ line: l, above: "  " }),
  "text at the spot": (l: string, c: number) => ({ line: l.slice(0, c) + "X" + l.slice(c) }),
} as const

for (const [spotName, { line, col, last }] of Object.entries(SPOTS)) {
  for (const [changeName, change] of Object.entries(CHANGES)) {
    test(`merge: the person types at the ${spotName} while an agent adds ${changeName}`, async ({ context }) => {
      const a = await context.newPage()
      const id = await newDiagram(a, doc(line, last))
      const tail = last ? [] : ["  C --> D"]
      await openEditor(a, id)
      const { version } = await tool<{ version: string }>(a, "get_diagram", { id })
      await caretAt(a, HEAD + col)
      await a.keyboard.type("ob")
      const c = change(line, col) as { line: string; above?: string; below?: string }
      const agentLines = [
        "graph TD",
        ...(c.above !== undefined ? [c.above] : []),
        c.line,
        ...(c.below !== undefined ? [c.below] : []),
        ...tail,
      ]
      const source = agentLines.join("\n")
      await tool(a, "update_diagram", { id, source, baseVersion: version })
      await a.keyboard.type("!")
      // Everything either side typed is there once: less the person's "ob!", typed together, it's the agent's text. Of
      // the two insertions at one spot, the person's goes first, so "ob!" stays right after the text of its line it was
      // typed after, and what the agent inserted there goes after it.
      await expect.poll(async () => (await editorText(a)).replace("ob!", "")).toBe(source)
      const merged = await editorText(a)
      expect(merged.includes("\n" + line.slice(0, col) + "ob!"), merged).toBe(true)
      expect(await storedText(a, id)).toBe(merged)
    })
  }
}

// The agent changes the end of the person's line and adds a line after it: what the person typed at the line's end
// stays right after the old end, so before the "2…" the agent added there, or after what the agent replaced "B" with.
for (const last of [false, true]) {
  for (const [lineNow, added, mine] of [
    ["  A --> B2", "  B2 --> X", ["  A --> Bob!2", "  B2 --> X"]],
    ["  A --> Z", "  Y --> Z", ["  A --> Z", "  Y --> Zob!"]],
  ] as const) {
    test(`merge: the person types at the end of ${last ? "the last line" : "a line"} while an agent changes it to "${lineNow.trim()}" and adds a line below`, async ({
      context,
    }) => {
      const a = await context.newPage()
      const id = await newDiagram(a, doc("  A --> B", last))
      const tail = last ? [] : ["  C --> D"]
      await openEditor(a, id)
      const { version } = await tool<{ version: string }>(a, "get_diagram", { id })
      await caretAt(a, HEAD + "  A --> B".length)
      await a.keyboard.type("ob")
      await tool(a, "update_diagram", { id, source: ["graph TD", lineNow, added, ...tail].join("\n"), baseVersion: version })
      await a.keyboard.type("!")
      const expected = ["graph TD", ...mine, ...tail].join("\n")
      await expectEditor(a, expected)
      expect(await storedText(a, id)).toBe(expected)
    })
  }
}

// An agent's edit that leaves the person's line as it was, though its lines around it end like it or begin like
// it: the caret, and what the person typed there since the agent read ("ob" with baseVersion), stay on that line.
// Before ("^" is the caret), the agent's source, and the result.
const AROUND: [string, string, string, string][] = [
  [
    "rename above, drop a line, add one below",
    "flowchart TD\n  Start --> Check\n  Old --> Check\n  Ch^eck --> Done",
    "flowchart TD\n  Begin --> Check\n  Check --> Done\n  Retry --> Done",
    "flowchart TD\n  Begin --> Check\n  Ch^eck --> Done\n  Retry --> Done",
  ],
  [
    "change above, drop the line above mine, add one below",
    "graph TD\n  A --> G\n  F114 --> D\n  P^22 --> F",
    "graph TD\n  A --> G2\n  P22 --> F\n  C --> F",
    "graph TD\n  A --> G2\n  P^22 --> F\n  C --> F",
  ],
  [
    "rename above, add one below, caret at text start",
    "flowchart TD\n  Start --> Check\n  ^Check --> Done",
    "flowchart TD\n  Begin --> Check\n  Check --> Done\n  Retry --> Done",
    "flowchart TD\n  Begin --> Check\n  ^Check --> Done\n  Retry --> Done",
  ],
  [
    "remove above, add one below ending alike",
    "flowchart TD\n  X --> Y\n  A --> C^",
    "flowchart TD\n  A --> C\n  D --> C",
    "flowchart TD\n  A --> C^\n  D --> C",
  ],
  [
    "change above, add one below ending alike",
    "flowchart TD\n  X --> Y\n  A --> C^",
    "flowchart TD\n  X --> Z\n  A --> C\n  D --> C",
    "flowchart TD\n  X --> Z\n  A --> C^\n  D --> C",
  ],
  [
    "rename above, add one below ending alike",
    "flowchart TD\n  Start --> Check\n  Check --> Done^",
    "flowchart TD\n  Begin --> Check\n  Check --> Done\n  Retry --> Done",
    "flowchart TD\n  Begin --> Check\n  Check --> Done^\n  Retry --> Done",
  ],
  [
    "change above, add one above mine",
    "flowchart TD\n  A --> B\n  ^C --> B",
    "flowchart TD\n  A --> B2\n  D --> B\n  C --> B",
    "flowchart TD\n  A --> B2\n  D --> B\n  ^C --> B",
  ],
  [
    "change below, add one below mine",
    "flowchart TD\n  A --> B^\n  C --> D",
    "flowchart TD\n  A --> B\n  E --> B\n  C --> D2",
    "flowchart TD\n  A --> B^\n  E --> B\n  C --> D2",
  ],
]

for (const base of [false, true]) {
  for (const [name, marked, agent, merged] of AROUND) {
    test(`${base ? "merge" : "an agent"}: ${name}`, async ({ context }) => {
      const a = await context.newPage()
      const id = await newDiagram(a, marked.replace("^", ""))
      await openEditor(a, id)
      const { version } = await tool<{ version: string }>(a, "get_diagram", { id })
      await caretAt(a, marked.indexOf("^"))
      const typed = base ? "ob" : ""
      await a.keyboard.type(typed)
      await tool(a, "update_diagram", base ? { id, source: agent, baseVersion: version } : { id, source: agent })
      await a.keyboard.type("Z")
      const expected = merged.replace("^", typed + "Z")
      await expectEditor(a, expected)
      expect(await storedText(a, id)).toBe(expected)
    })
  }
}

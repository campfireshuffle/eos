import { expect, test, type Page } from "@playwright/test"

import { cursorAtEndOf, editorText, expectEditor, newDiagram, openEditor, storedText, tool, withAgentTools } from "./helpers"

// Two tabs on the same library, as a person with Eos open twice (or two windows) would have.
let a: Page
let b: Page

test.beforeEach(async ({ context }) => {
  await withAgentTools(context)
  a = await context.newPage()
  b = await context.newPage()
})

async function openInBoth(source: string) {
  const id = await newDiagram(a, source)
  await openEditor(a, id)
  await openEditor(b, id)
  return id
}

test("two tabs typing at the same time keep every keystroke", async () => {
  const id = await openInBoth("line one\nline two")
  await cursorAtEndOf(a, 0)
  await cursorAtEndOf(b, 1)
  await Promise.all([a.keyboard.type(" AAAA", { delay: 5 }), b.keyboard.type(" BBBB", { delay: 5 })])
  const merged = "line one AAAA\nline two BBBB"
  await expectEditor(a, merged)
  await expectEditor(b, merged)
  expect(await storedText(a, id)).toBe(merged)
})

// Loro's undo manager ends a step at any change not on the person's stack (here the other tab's keystrokes), so a
// burst typed alongside them takes several ⌘Z, each removing only this tab's typing, from the end.
test("undo in one tab removes only that tab's typing", async () => {
  await openInBoth("one\ntwo")
  await cursorAtEndOf(a, 0)
  await cursorAtEndOf(b, 1)
  await Promise.all([a.keyboard.type(" aaaaaa", { delay: 5 }), b.keyboard.type(" bbbbbb", { delay: 5 })])
  await expectEditor(b, "one aaaaaa\ntwo bbbbbb")
  for (let i = 0; i < 7 && (await editorText(b)) !== "one aaaaaa\ntwo"; i++) {
    const before = (await editorText(b)).split("\n")[1]!
    await b.keyboard.press("ControlOrMeta+z")
    await expect.poll(async () => (await editorText(b)).split("\n")[1]).not.toBe(before)
    const now = await editorText(b)
    expect(now.startsWith("one aaaaaa\ntwo") && before.startsWith(now.split("\n")[1]!), now).toBe(true)
  }
  await expectEditor(b, "one aaaaaa\ntwo")
  await expectEditor(a, "one aaaaaa\ntwo")
})

test("redo in one tab reaches the other", async () => {
  await openInBoth("A")
  await cursorAtEndOf(a, 0)
  await a.keyboard.type(" first")
  await cursorAtEndOf(b, 0)
  await b.keyboard.type(" second")
  await expectEditor(a, "A first second")
  await a.locator(".cm-content").click()
  await a.keyboard.press("ControlOrMeta+z")
  await expectEditor(b, "A second")
  // Uppercase Z, as a real keyboard reports it with Shift held (a lowercase z reads as plain ⌘Z).
  await a.keyboard.press("ControlOrMeta+Shift+Z")
  await expectEditor(b, "A first second")
})

test("typing after an undone deletion carries on after the restored text", async () => {
  await openInBoth("")
  await cursorAtEndOf(a, 0)
  await a.keyboard.type("hello")
  // Past the store's 800ms undo grouping, so ⌘Z undoes only the deletion.
  await a.waitForTimeout(1000)
  for (let i = 0; i < 3; i++) await a.keyboard.press("Backspace")
  await expectEditor(a, "he")
  await a.keyboard.press("ControlOrMeta+z")
  await expectEditor(a, "hello")
  await a.keyboard.type("X")
  await expectEditor(a, "helloX")
})

// A line another tab or an agent appends after the end the person just deleted or typed at stays after the caret their
// ⌘Z leaves: typing then lands on the person's own line.
for (const via of ["another tab", "an agent"] as const)
  for (const selected of [true, false])
    test(`${via}'s line appended after ${selected ? "a deleted selection" : "typing"} at the end survives the person's undo`, async () => {
      const id = await openInBoth("graph TD\nA --> B\nC --> D")
      await a.bringToFront()
      await cursorAtEndOf(a, 2)
      if (selected) {
        for (let i = 0; i < 6; i++) await a.keyboard.press("Shift+ArrowLeft") // " --> D"
        await a.keyboard.press("Backspace")
      } else await a.keyboard.type(" mine")
      await a.waitForTimeout(1000) // past the undo grouping
      const appended = (await storedText(a, id)) + "\nE --> F"
      if (via === "an agent") await tool(a, "update_diagram", { id, source: appended })
      else {
        await cursorAtEndOf(b, 2)
        await b.keyboard.type("\nE --> F")
        await a.bringToFront()
      }
      await expectEditor(a, appended)
      await a.keyboard.press("ControlOrMeta+z")
      await expectEditor(a, "graph TD\nA --> B\nC --> D\nE --> F")
      await a.keyboard.type("X")
      const expected = "graph TD\nA --> B\nC --> DX\nE --> F"
      await expectEditor(a, expected)
      await expect.poll(() => storedText(a, id)).toBe(expected)
    })

test("an agent's line appended where the person is typing doesn't take their caret", async () => {
  const id = await openInBoth("graph TD\n  A --> B")
  await cursorAtEndOf(a, 1)
  await a.keyboard.type("1")
  await expectEditor(a, "graph TD\n  A --> B1")
  const { diagram, version } = await tool<{ diagram: { source: string }; version: string }>(a, "get_diagram", { id })
  await tool(a, "update_diagram", { id, source: diagram.source + "\n  C --> D", baseVersion: version })
  await expectEditor(a, "graph TD\n  A --> B1\n  C --> D")
  await a.keyboard.type("2")
  await expectEditor(a, "graph TD\n  A --> B12\n  C --> D")
  expect(await storedText(a, id)).toBe("graph TD\n  A --> B12\n  C --> D")
})

// The agent's source is diffed by lines, so its line goes in at the start of the person's line: before the caret, which
// stays with its line's text, after an indent or at column 0.
for (const [indent, source, typed] of [
  ["indented", "graph TD\n  A --> B", "graph TD\n  NEW\n  ZA --> B"],
  ["at column 0", "sequenceDiagram\nAlice->>Bob: hi", "sequenceDiagram\nNEW\nZAlice->>Bob: hi"],
] as const) {
  test(`an agent's line inserted above the person's ${indent} line leaves their caret before its text`, async () => {
    const id = await openInBoth(source)
    await cursorAtEndOf(a, 1)
    await a.keyboard.press("Home") // the start of the line's text
    const lines = source.split("\n")
    const added = [lines[0], lines[1]!.match(/^ */)![0] + "NEW", lines[1]].join("\n")
    const { version } = await tool<{ version: string }>(a, "get_diagram", { id })
    await tool(a, "update_diagram", { id, source: added, baseVersion: version })
    await expectEditor(a, added)
    await a.keyboard.type("Z")
    await expectEditor(a, typed)
    expect(await storedText(a, id)).toBe(typed)
  })
}

// A line someone else adds where the person's caret is at the start of a line (an empty one too) goes above it: the
// caret, and what they type, stay on their line. Before ("^" is the caret) and after the line is added.
const LINE_START: [string, string, string][] = [
  ["an empty last line, a line appended", "graph TD\nA --> B\nC --> D\n^", "graph TD\nA --> B\nC --> D\nD --> E\n^"],
  ["a blank line, a line added above", "graph TD\nA --> B\n^\nC --> D", "graph TD\nA --> B\nX --> Y\n^\nC --> D"],
  ["column 0, a line added above", "graph TD\nA --> B\n^B --> C", "graph TD\nA --> B\nX --> Y\n^B --> C"],
]
for (const [name, marked, after] of LINE_START)
  for (const via of ["an agent with baseVersion", "an agent", "another tab"] as const)
    test(`${via}: the caret at the start of ${name} stays on its line`, async () => {
      const before = marked.replace("^", "")
      const next = after.replace("^", "")
      const id = await openInBoth(before)
      const { version } = await tool<{ version: string }>(a, "get_diagram", { id })
      await a.bringToFront()
      await a.locator(".cm-content").click()
      await a.keyboard.press("ControlOrMeta+Home")
      for (let i = 0; i < marked.indexOf("^"); i++) await a.keyboard.press("ArrowRight")
      if (via === "another tab")
        await b.evaluate(
          ([at, insert]) => {
            const content = document.querySelector(".cm-content") as unknown as {
              cmTile: { root: { view: { dispatch(spec: unknown): void } } }
            }
            content.cmTile.root.view.dispatch({ changes: { from: at, insert }, userEvent: "input.paste" })
          },
          [marked.indexOf("^"), next.slice(marked.indexOf("^"), after.indexOf("^"))] as const
        )
      else await tool(a, "update_diagram", via === "an agent" ? { id, source: next } : { id, source: next, baseVersion: version })
      await expectEditor(a, next)
      await a.keyboard.type("Z")
      await expectEditor(a, after.replace("^", "Z"))
      expect(await storedText(a, id)).toBe(after.replace("^", "Z"))
    })

test("an agent's text inserted at the person's caret within a line goes after the caret", async () => {
  const id = await openInBoth("graph TD\n  A --> B")
  await cursorAtEndOf(a, 1)
  for (let i = 0; i < 6; i++) await a.keyboard.press("ArrowLeft") // just after the A
  const { version } = await tool<{ version: string }>(a, "get_diagram", { id })
  await tool(a, "update_diagram", { id, source: "graph TD\n  AX --> B", baseVersion: version })
  await expectEditor(a, "graph TD\n  AX --> B")
  await a.keyboard.type("Z")
  await expectEditor(a, "graph TD\n  AZX --> B")
  expect(await storedText(a, id)).toBe("graph TD\n  AZX --> B")
})

test("an agent's line appended to a new diagram while the person types a new last line stays a line of its own", async () => {
  await a.goto("/#/")
  await a.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const { id } = await tool<{ id: string }>(a, "create_diagram", { title: "New", open: false })
  await openEditor(a, id)
  const read = await tool<{ diagram: { source: string }; version: string }>(a, "get_diagram", { id })
  expect(read.diagram.source).toBe("flowchart TD\n  A[Start] --> B[End]\n")
  await a.locator(".cm-line").last().click()
  await a.keyboard.type("  B --> C")
  await tool(a, "update_diagram", { id, source: read.diagram.source + "  B --> D[Done]\n", baseVersion: read.version })
  await a.keyboard.type("[Next]")
  const merged = "flowchart TD\n  A[Start] --> B[End]\n  B --> D[Done]\n  B --> C[Next]"
  await expectEditor(a, merged)
  expect(await tool(a, "get_diagram", { id })).toMatchObject({ diagram: { source: merged }, valid: true })
})

test("an agent's edit merges with typing done after the version it read", async () => {
  const id = await openInBoth("flowchart TD\n  A --> B")
  // The agent works through tab b; the person types in tab a.
  const { diagram, version } = await tool<{ diagram: { source: string }; version: string }>(b, "get_diagram", { id })
  await cursorAtEndOf(a, 1)
  await a.keyboard.type("\nC --> D")
  await expectEditor(b, "flowchart TD\n  A --> B\n  C --> D")
  await tool(b, "update_diagram", { id, source: diagram.source.replace("A --> B", "A --> Z"), baseVersion: version })
  const merged = "flowchart TD\n  A --> Z\n  C --> D"
  await expectEditor(a, merged)
  expect(await storedText(a, id)).toBe(merged)
})

test("restoring a version updates the editor and the preview", async () => {
  await openInBoth("flowchart TD\n  Old1 --> Old2")
  await a.locator(".cm-content").click()
  await a.keyboard.press("ControlOrMeta+a")
  await a.keyboard.type("flowchart TD\n  New1 --> New2")
  await expect(a.locator("svg").getByText("New1")).toBeVisible()
  await a.getByRole("button", { name: "Version history" }).click()
  await a.locator("[data-slot=popover-content] button").last().click()
  await a.getByRole("button", { name: "Restore this version" }).click()
  await expectEditor(a, "flowchart TD\n  Old1 --> Old2")
  await expect(a.locator("svg").getByText("Old1")).toBeVisible()
  await expectEditor(b, "flowchart TD\n  Old1 --> Old2")
})

test("typing still saves after a backup replaces the open diagram", async () => {
  const id = await openInBoth("flowchart TD\n  A --> B")
  const { data } = await tool<{ data: string }>(a, "export", { format: "backup" })
  const replacing = tool(a, "import_backup", { data, mode: "replace" })
  await a.getByRole("alertdialog").getByRole("button", { name: "Replace" }).click()
  expect(await replacing).toMatchObject({ ok: true })
  await cursorAtEndOf(a, 1)
  await a.keyboard.type(" %% after")
  await expect.poll(() => storedText(a, id)).toBe("flowchart TD\n  A --> B %% after")
  await a.reload()
  await a.locator(".cm-content").waitFor()
  expect(await editorText(a)).toBe("flowchart TD\n  A --> B %% after")
})

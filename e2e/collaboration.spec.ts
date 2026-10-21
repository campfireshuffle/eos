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

test("undo in one tab removes only that tab's burst of typing", async () => {
  await openInBoth("one\ntwo")
  await cursorAtEndOf(a, 0)
  await cursorAtEndOf(b, 1)
  await Promise.all([a.keyboard.type(" aaaaaa", { delay: 5 }), b.keyboard.type(" bbbbbb", { delay: 5 })])
  await expectEditor(b, "one aaaaaa\ntwo bbbbbb")
  await b.keyboard.press("ControlOrMeta+z")
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

import { expect, test } from "@playwright/test"

import { newDiagram, openEditor, tool, withAgentTools } from "./helpers"

// 400 lines, with a word found only on the last, which CodeMirror doesn't draw until it's scrolled to.
const LONG = ["flowchart TD", ...Array.from({ length: 398 }, (_, i) => `  N${i} --> N${i + 1}`), "  N398 --> Zanzibar"].join("\n")

test.beforeEach(async ({ context }) => {
  await withAgentTools(context)
})

test("Mod-f in the source finds a word on a line that isn't drawn, selects it and scrolls to it", async ({ page }) => {
  await openEditor(page, await newDiagram(page, LONG))
  const editor = page.getByRole("textbox", { name: "Mermaid source" })
  await expect(page.locator(".cm-line", { hasText: "Zanzibar" })).toHaveCount(0)
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+f")
  const find = page.getByRole("textbox", { name: "Find" })
  await expect(find).toBeFocused()
  await page.keyboard.type("Zanzibar")
  await page.keyboard.press("Enter")
  const match = page.locator(".cm-searchMatch-selected")
  await expect(match).toHaveText("Zanzibar")
  await expect(match).toBeInViewport()
  // The match is the selection: Escape goes back to the text with it selected.
  await page.keyboard.press("Escape")
  await expect(editor).toBeFocused()
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Zanzibar")
})

test("Escape closes the search panel and returns focus to the source, then Escape and Tab still leave", async ({ page }) => {
  await openEditor(page, await newDiagram(page, "flowchart TD\n  A --> B"))
  const editor = page.getByRole("textbox", { name: "Mermaid source" })
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+f")
  await expect(page.getByRole("textbox", { name: "Find" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("textbox", { name: "Find" })).toBeHidden()
  await expect(editor).toBeFocused()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Tab")
  await expect(editor).not.toBeFocused()
})

test("a past version can be searched, but offers no replace", async ({ page }) => {
  const id = await newDiagram(page, "flowchart TD\n  A --> B")
  await tool(page, "update_diagram", { id, source: "flowchart TD\n  A --> C" })
  await openEditor(page, id)
  const { history } = await tool<{ history: { version: string }[] }>(page, "get_diagram", { id, history: true })
  await tool(page, "set_view", { diagramId: id, previewVersion: history.at(-1)!.version })
  await expect(page.getByText("Viewing the version from")).toBeVisible()
  await page.getByRole("textbox", { name: "Mermaid source" }).focus()
  await page.keyboard.press("ControlOrMeta+f")
  await expect(page.getByRole("textbox", { name: "Find" })).toBeFocused()
  await expect(page.getByRole("textbox", { name: "Replace" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "replace" })).toHaveCount(0)
})

test("Escape in a settings editor's search panel closes the panel, not the dialog", async ({ page }) => {
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  const editor = dialog.getByRole("textbox", { name: "App theme CSS" })
  await expect(editor).toContainText("--eos-ink")
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+f")
  await expect(dialog.getByRole("textbox", { name: "Find" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog.getByRole("textbox", { name: "Find" })).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(editor).toBeFocused()
})

test("⌘⇧L in the source copies the share link and leaves the selection alone", async ({ context, page }) => {
  // Records what's copied, in every engine.
  await context.addInitScript(() => {
    const copied: string[] = []
    Object.assign(window, { __copied: copied })
    navigator.clipboard.writeText = async (text: string) => void copied.push(text)
  })
  await openEditor(page, await newDiagram(page, "flowchart TD\n  Alpha --> B\n  B --> Alpha"))
  await page.locator(".cm-line", { hasText: "Alpha --> B" }).getByText("Alpha").dblclick()
  await expect(page.locator(".cm-selectionBackground")).toHaveCount(1)
  await page.keyboard.press("ControlOrMeta+Shift+L")
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied))
    .toEqual([expect.stringContaining("/#/import?d=")])
  await expect(page.locator(".cm-selectionBackground")).toHaveCount(1)
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Alpha")
})

import { expect, test, type Page } from "@playwright/test"

import { newDiagram, openEditor, tool, withAgentTools } from "./helpers"

const storedTitle = async (page: Page, id: string) =>
  (await tool<{ diagram: { meta: { title: string } } }>(page, "get_diagram", { id })).diagram.meta.title

test("a title still being typed is saved when the person or an agent leaves the diagram", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  const title = page.getByRole("textbox", { name: "Diagram title" })

  // Going back (⌘[, a swipe) while the title field still has focus.
  await openEditor(page, id)
  await title.fill("Renamed by me")
  await page.goBack()
  await expect.poll(() => storedTitle(page, id)).toBe("Renamed by me")

  // An agent opening the library instead.
  await openEditor(page, id)
  await title.fill("Second rename")
  await tool(page, "set_view", { page: "library" })
  await expect.poll(() => storedTitle(page, id)).toBe("Second rename")
})

// Leaving the page neither blurs the title nor unmounts it.
for (const how of ["reloaded", "hidden"] as const)
  for (const wait of [0, 1000])
    test(`a title still being typed is saved when the page is ${how} ${wait} ms later`, async ({ context }) => {
      await withAgentTools(context)
      const page = await context.newPage()
      const id = await newDiagram(page, "flowchart LR\n  A --> B")
      const versions = async (p: Page) => (await tool<{ history: unknown[] }>(p, "get_diagram", { id, history: true })).history.length
      const before = await versions(page)
      await openEditor(page, id)
      await page.getByRole("textbox", { name: "Diagram title" }).fill("Quarterly plan")
      await page.waitForTimeout(wait)
      if (how === "reloaded") await page.reload()
      // As switching to another tab does, with the title field still focused.
      else
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
          document.dispatchEvent(new Event("visibilitychange"))
        })
      const other = await context.newPage()
      await other.goto("/#/")
      await other.waitForFunction(() => "__tools" in window && "get_diagram" in (window as unknown as { __tools: object }).__tools)
      await expect.poll(() => storedTitle(other, id)).toBe("Quarterly plan")
      expect(await versions(other)).toBe(before + 1)
    })

test("the Enter that confirms an IME candidate doesn't leave the title", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await openEditor(page, id)
  const title = page.getByRole("textbox", { name: "Diagram title" })
  await title.click()
  // What browsers send for the Enter that picks a candidate: still composing (Safari: keyCode 229).
  for (const init of [{ isComposing: true }, { keyCode: 229 }])
    await title.evaluate((el, i) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...i })), init)
  await expect(title).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(title).not.toBeFocused()
})

test("code scrolled sideways passes under the line numbers, not through them", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "erDiagram\n  CUSTOMER ||--o{ ORDER : places " + "and more ".repeat(40))
  await openEditor(page, id)
  const gutter = page.locator(".cm-gutters").first()
  const [own, panel] = await gutter.evaluate((el) => [
    getComputedStyle(el).backgroundColor,
    getComputedStyle(el.closest("section")!).backgroundColor,
  ])
  expect(own).toBe(panel)
})

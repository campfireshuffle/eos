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

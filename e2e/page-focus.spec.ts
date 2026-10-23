import { expect, test, type Page } from "@playwright/test"

import { newDiagram, tool, withAgentTools } from "./helpers"

// Arriving at another history entry swaps the page: focus goes to the new page's title, and the tab is named after it.
// A replace (typing a search) is the same page, so focus stays. An agent's navigation leaves focus alone.

const heading = (page: Page) => page.getByRole("heading", { level: 1 })
const title = (page: Page) => page.getByRole("textbox", { name: "Diagram title" })

test("Enter on a card focuses the diagram's title, and Back and Forward focus each page's title", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await tool(page, "update_diagram", { id, title: "Checkout flow" })
  await expect(page).toHaveTitle("Diagrams · Eos")
  await page.locator(`[data-card-id="${id}"]`).focus()
  await page.keyboard.press("Enter")
  await expect(title(page)).toBeFocused()
  await expect(title(page)).toHaveValue("Checkout flow")
  await expect(page).toHaveTitle("Checkout flow · Eos")

  await page.getByRole("button", { name: "Back" }).focus()
  await page.keyboard.press("Enter")
  await expect(heading(page)).toBeFocused()
  await expect(heading(page)).toHaveText("Diagrams")
  await expect(page).toHaveTitle("Diagrams · Eos")

  await page.getByRole("button", { name: "Forward" }).focus()
  await page.keyboard.press("Enter")
  await expect(title(page)).toBeFocused()
  await expect(page).toHaveTitle("Checkout flow · Eos")
})

test("New diagram focuses the new diagram's title", async ({ page }) => {
  await page.goto("/#/")
  await page.getByRole("button", { name: "New diagram" }).click()
  await expect(title(page)).toBeFocused()
  await expect(page).toHaveTitle("Untitled · Eos")
})

test("a library view chosen in the sidebar focuses the heading, and the tab names the view", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await newDiagram(page, "flowchart LR\n  A --> B")
  await tool(page, "create_diagram", { title: "Tagged", tags: ["work"], open: false })
  const sidebar = page.locator("aside")
  await sidebar.getByRole("link", { name: /^Starred/ }).click()
  await expect(heading(page)).toBeFocused()
  await expect(page).toHaveTitle("Starred · Eos")
  await sidebar.getByText("work", { exact: true }).click()
  await expect(heading(page)).toBeFocused()
  await expect(page).toHaveTitle("#work · Eos")
  await tool(page, "set_view", { filters: { deleted: true, tags: [] } })
  await expect(page).toHaveTitle("Deleted · Eos")
})

test("typing in the search box keeps focus there", async ({ page }) => {
  await page.goto("/#/")
  const search = page.getByRole("textbox", { name: "Search diagrams" })
  await search.focus()
  await search.pressSequentially("flow", { delay: 100 })
  await expect(page).toHaveURL(/#\/\?q=flow$/)
  // Past the last write, and the render after it.
  await page.waitForTimeout(300)
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("flow")
})

test("an agent opening a diagram doesn't move the person's focus to it", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await page.getByRole("textbox", { name: "Search diagrams" }).focus()
  await tool(page, "set_view", { page: "diagram", diagramId: id })
  await expect(title(page)).toHaveValue("Test")
  await expect(page).toHaveTitle("Test · Eos")
  await expect(title(page)).not.toBeFocused()
})

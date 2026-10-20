import { expect, test, type BrowserContext } from "@playwright/test"

import { tool, withAgentTools } from "./helpers"

/** Two diagrams tagged `tag`, with the library open at it. */
async function viewing(context: BrowserContext, tag: string) {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  for (const title of ["A", "B"]) await tool(page, "create_diagram", { title, tags: [tag], open: false })
  await page.evaluate((t) => (location.hash = `/?tag=${encodeURIComponent(t)}`), tag)
  await expect(page.locator("[data-card-id]")).toHaveCount(2)
  return page
}

test("moving the tag being viewed keeps showing its diagrams", async ({ context }) => {
  const page = await viewing(context, "projects/work")
  await page.getByRole("row", { name: "projects/work" }).click({ button: "right" })
  await page.getByRole("button", { name: "Move to top level" }).click()
  await expect(page).toHaveURL(/#\/\?tag=work$/)
  await expect(page.locator("[data-card-id]")).toHaveCount(2)
})

test("deleting a tag above the one being viewed goes back to the whole library", async ({ context }) => {
  const page = await viewing(context, "work/notes")
  await page.getByRole("row", { name: "work", exact: true }).click({ button: "right" })
  await page.getByRole("button", { name: "Delete tag" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText("No diagrams match.")).toBeHidden()
})

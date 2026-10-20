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

test("Enter in the Tags menu toggles the tag typed, not the first that contains it", async ({ context }) => {
  const page = await viewing(context, "archive/work")
  const ids = await page.locator("[data-card-id]").evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.cardId!))
  await tool(page, "create_diagram", { title: "C", tags: ["work"], open: false })
  await page
    .locator("[data-card-id]")
    .first()
    .click({ modifiers: ["ControlOrMeta"] })
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).click()
  // As someone might type it: with a #, which saving drops.
  await page.getByPlaceholder("Find or create a tag").fill("#work")
  await page.keyboard.press("Enter")
  const tagged = async () =>
    (await tool<{ diagrams: { id: string; tags: string[] }[] }>(page, "get_library")).diagrams.find(
      (d) => ids.includes(d.id) && d.tags.includes("work")
    )
  await expect.poll(tagged).toBeTruthy()
})

test("rows hold still while a tag is dragged over them", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  for (const tag of ["ideas", "pele", "work/backend", "work/payments"])
    await tool(page, "create_diagram", { title: tag, tags: [tag], open: false })
  const tree = page.getByRole("treegrid", { name: "Tags" })
  const rows = tree.locator("[role=row][data-key]")
  await expect(tree.getByRole("row", { name: "work/payments" })).toBeVisible()
  const tops = () => rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))
  const before = await tops()

  const backend = tree.getByRole("row", { name: "work/backend" })
  const from = (await backend.boundingBox())!
  await page.mouse.move(from.x + 40, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 46, from.y + from.height / 2, { steps: 3 })
  await expect(backend).toHaveAttribute("data-dragging", "true")
  const pele = tree.getByRole("row", { name: "pele", exact: true })
  const over = (await pele.boundingBox())!
  // Browsers repeat dragover while the pointer rests, but Playwright sends one per move, and Chromium and
  // WebKit only show the new drop target on the next one; the 1px nudge stands in for that.
  const hover = async (dy: number) => {
    await page.mouse.move(over.x + 40, over.y + dy, { steps: 3 })
    await page.mouse.move(over.x + 41, over.y + dy)
  }
  await hover(over.height / 2)
  await expect(pele).toHaveAttribute("data-drop-target", "true")
  expect(await tops()).toEqual(before)
  // Down across the row and over its edges, where the drop target changes; then back onto it to drop.
  for (let dy = -6; dy <= over.height + 6; dy += 3) {
    await hover(dy)
    expect(await tops()).toEqual(before)
  }
  await hover(over.height / 2)
  await expect(pele).toHaveAttribute("data-drop-target", "true")
  await page.mouse.up()
  await expect(tree.getByRole("row", { name: "pele/backend" })).toBeVisible()
})

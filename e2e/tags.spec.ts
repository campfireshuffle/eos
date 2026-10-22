import { expect, test, type BrowserContext, type Locator } from "@playwright/test"

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

test("an agent moving the tag being viewed keeps showing its diagrams, as the person's Move does", async ({ context }) => {
  const page = await viewing(context, "projects/work")
  // Written as the sidebar shows it: the URL holds the normalised tag either way.
  await tool(page, "update_tag", { path: "#projects/work", moveTo: "#Work" })
  await expect(page).toHaveURL(/#\/\?tag=work$/)
  await expect(page.locator("[data-card-id]")).toHaveCount(2)
})

test("an agent deleting a tag above the one being viewed goes back to the whole library, as the person's Delete does", async ({
  context,
}) => {
  const page = await viewing(context, "work/notes")
  const call = tool(page, "delete_tag", { path: "work" })
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  expect((await call).ok).toBe(true)
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText("No diagrams match.")).toBeHidden()
})

test("Enter in the Tags menu toggles the tag typed, not the first that contains it", async ({ context }) => {
  const page = await viewing(context, "archive/work")
  const ids = await page.locator("[data-card-id]").evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.cardId!))
  await tool(page, "create_diagram", { title: "C", tags: ["work"], open: false })
  await page.locator("[data-card-id]").first().click({ button: "right" })
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

test("a card dragged onto a tag or Starred gets it, and so does the selection it's part of", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const ids: Record<string, string> = {}
  for (const title of ["One", "Two", "Three"]) ids[title] = (await tool<{ id: string }>(page, "create_diagram", { title, open: false })).id
  await tool(page, "create_diagram", { title: "Tagged", tags: ["target"], open: false })
  const card = (title: string) => page.locator("[data-card-id]", { hasText: title })
  const row = page.getByRole("treegrid", { name: "Tags" }).getByRole("row", { name: /target/ })
  await expect(card("Tagged")).toBeVisible()
  const diagram = async (title: string) =>
    (await tool<{ diagrams: { id: string; tags: string[]; starred: boolean }[] }>(page, "get_library")).diagrams.find(
      (d) => d.id === ids[title]
    )!

  // By title, so tagging a card (which bumps its Modified time) doesn't move it from under the next drag.
  await page.getByLabel("Sort").selectOption("title")
  await expect(page.locator("[data-card-id]").first()).toContainText("One")
  // Drags the card onto `to` until `landed` passes. Playwright's drag in Chromium now and then misses the
  // dragstart on a busy machine, and a drag that never started is safe to make again.
  const drag = (title: string, to: Locator, landed: () => Promise<unknown>) =>
    expect(async () => {
      const from = (await card(title).boundingBox())!
      const over = (await to.boundingBox())!
      await page.mouse.move(from.x + 20, from.y + 20)
      await page.mouse.down()
      await page.mouse.move(over.x + 20, over.y + over.height / 2, { steps: 5 })
      // Browsers repeat dragover while the pointer rests, but Playwright sends one per move, and Chromium and
      // WebKit only take the drop after the next one; the 1px nudge stands in for that.
      await page.mouse.move(over.x + 21, over.y + over.height / 2)
      await page.mouse.up()
      await landed()
    }).toPass()
  const within = { timeout: 1000 }

  await drag("One", row, () => expect.poll(async () => (await diagram("One")).tags, within).toEqual(["target"]))
  expect((await diagram("Two")).tags).toEqual([])

  // Dragging a selected card carries the whole selection.
  await card("Two").click({ button: "right" })
  await card("Three").click()
  await drag("Three", row, () => expect.poll(async () => (await diagram("Two")).tags, within).toEqual(["target"]))
  expect((await diagram("Three")).tags).toEqual(["target"])

  await drag("Two", page.getByRole("link", { name: /Starred/ }).first(), () =>
    expect.poll(async () => (await diagram("Two")).starred, within).toBe(true)
  )
  expect((await diagram("Three")).starred).toBe(true)
  expect((await diagram("One")).starred).toBe(false)
})

test("the Tags menu closes once its change takes the selected cards out of view", async ({ context }) => {
  const page = await viewing(context, "inbox")
  const cards = page.locator("[data-card-id]")
  await cards.nth(0).click({ button: "right" })
  await cards.nth(1).click()
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).click()
  await page.getByRole("checkbox", { name: /inbox/ }).click()
  // Both left the inbox view, so nothing is selected: the menu goes rather than acting on nothing.
  await expect(cards).toHaveCount(0)
  await expect(page.getByPlaceholder("Find or create a tag")).toBeHidden()

  // The next selection brings the bar back without the menu: that waits for Tags to be pressed.
  await page.evaluate(() => (location.hash = "/"))
  await cards.first().click({ button: "right" })
  await expect(page.getByText("1 selected")).toBeVisible()
  await expect(page.getByPlaceholder("Find or create a tag")).toBeHidden()
  expect(await page.evaluate(() => document.activeElement?.matches("input[placeholder='Find or create a tag']"))).toBe(false)
})

test("the Tags menu finds a tag typed as the sidebar shows it, with its #", async ({ context }) => {
  const page = await viewing(context, "work")
  await tool(page, "create_diagram", { title: "Untagged", open: false })
  await page.evaluate(() => (location.hash = "/"))
  await page.locator("[data-card-id]", { hasText: "Untagged" }).click({ button: "right" })
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).click()
  await page.getByPlaceholder("Find or create a tag").fill("#work")
  await expect(page.getByRole("checkbox", { name: "work" })).toBeVisible()
  await expect(page.getByText("No tags yet.")).toBeHidden()
})

test("on a phone, a long unbroken tag name keeps the delete confirm's buttons inside it", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const tag = "kubernetes_clusterautoscaler_migration_plan"
  await tool(page, "create_diagram", { title: "Cluster", tags: [tag], open: false })
  await page.getByRole("button", { name: "Show sidebar" }).click()
  await page.getByRole("row", { name: tag }).click({ button: "right" })
  await page.getByRole("button", { name: "Delete tag" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toBeVisible()
  // Measure once it has finished zooming in.
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
  const box = (await dialog.boundingBox())!
  for (const name of ["Delete", "Cancel"]) {
    const button = (await dialog.getByRole("button", { name }).boundingBox())!
    expect(button.x).toBeGreaterThanOrEqual(box.x)
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width)
  }
})

test("a keyboard moves a tag under another, and back to the top level, from its row's drag button", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  for (const tag of ["alpha", "beta"]) await tool(page, "create_diagram", { title: tag, tags: [tag], open: false })
  const tree = page.getByRole("treegrid", { name: "Tags" })
  await tree.getByRole("row", { name: "alpha", exact: true }).focus()
  // Across the row: its icon button, then the drag button, which shows while it has focus.
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  const drag = tree.getByRole("button", { name: "Drag alpha" })
  await expect(drag).toBeFocused()
  expect((await drag.boundingBox())!.width).toBeGreaterThan(10)
  await page.keyboard.press("Enter")
  // React Aria focuses the first drop target, the row after alpha's.
  await expect(page.getByRole("button", { name: /^Drop on beta/ })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(tree.getByRole("row", { name: "beta/alpha" })).toBeVisible()
  const tags = async () =>
    (await tool<{ diagrams: { title: string; tags: string[] }[] }>(page, "get_library")).diagrams.find((d) => d.title === "alpha")?.tags
  await expect.poll(tags).toEqual(["beta/alpha"])
  // Back to the top level: the drop zone goes away, so focus goes to the moved row.
  await tree.getByRole("row", { name: "beta/alpha" }).focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await expect(tree.getByRole("button", { name: "Drag beta/alpha" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: /^Drop on/ }).first()).toBeFocused()
  // Tab goes from the tree's drop targets to the top-level zone.
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Move to top level" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect.poll(tags).toEqual(["alpha"])
  await expect(tree.getByRole("row", { name: "alpha", exact: true })).toBeFocused()
})

test("in the narrow window's drawer, Escape cancels a keyboard tag drag and leaves the drawer open", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.setViewportSize({ width: 700, height: 800 })
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  for (const tag of ["alpha", "beta"]) await tool(page, "create_diagram", { title: tag, tags: [tag], open: false })
  const drawer = page.getByRole("dialog", { name: "Navigation" })
  const tree = page.getByRole("treegrid", { name: "Tags" })
  const alpha = tree.getByRole("row", { name: "alpha", exact: true })
  // With no drag, Escape still closes the drawer.
  await page.getByRole("button", { name: "Show sidebar" }).click()
  await alpha.focus()
  await page.keyboard.press("Escape")
  await expect(drawer).toBeHidden()
  await page.getByRole("button", { name: "Show sidebar" }).click()
  await alpha.focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  const drag = tree.getByRole("button", { name: "Drag alpha" })
  await expect(drag).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: /^Drop on beta/ })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(drag).toBeFocused()
  // Not visibility: a closing drawer stays visible while it slides out.
  await expect(drawer).toHaveAttribute("data-state", "open")
  const library = await tool<{ diagrams: { title: string; tags: string[] }[] }>(page, "get_library")
  expect(library.diagrams.find((d) => d.title === "alpha")?.tags).toEqual(["alpha"])
})

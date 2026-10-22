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
  await page.getByRole("menuitem", { name: "Move to top level" }).click()
  await expect(page).toHaveURL(/#\/\?tag=work$/)
  await expect(page.locator("[data-card-id]")).toHaveCount(2)
})

test("deleting a tag above the one being viewed goes back to the whole library", async ({ context }) => {
  const page = await viewing(context, "work/notes")
  await page.getByRole("row", { name: "work", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete tag" }).click()
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
  await expect(page.locator(".eos-library-scroller")).toBeFocused()

  // The next selection brings the bar back without the menu: that waits for Tags to be pressed.
  await page.evaluate(() => (location.hash = "/"))
  await cards.first().click({ button: "right" })
  await expect(page.getByText("1 selected")).toBeVisible()
  await expect(page.getByPlaceholder("Find or create a tag")).toBeHidden()
  expect(await page.evaluate(() => document.activeElement?.matches("input[placeholder='Find or create a tag']"))).toBe(false)
})

for (const by of ["keyboard", "mouse"]) {
  test(`removing the view's tag from the Tags menu by ${by} leaves focus on a card still in view`, async ({ context }) => {
    const page = await viewing(context, "x")
    const cards = page.locator("[data-card-id]")
    const tags = page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" })
    if (by === "keyboard") {
      await cards.first().focus()
      await page.keyboard.press(" ")
      await tags.focus()
      await page.keyboard.press("Enter")
      await page.keyboard.type("x")
      await page.keyboard.press("Enter")
    } else {
      await cards.first().click({ button: "right" })
      await tags.click()
      await page.getByRole("checkbox", { name: "x", exact: true }).click()
    }
    await expect(cards).toHaveCount(1)
    await expect(page.getByText("0 selected")).toBeAttached()
    await expect(page.getByPlaceholder("Find or create a tag")).toBeHidden()
    // Not dropped to the page with the menu, nor left on the bar's inert Tags button.
    await expect(cards.first()).toBeFocused()
  })
}

test("unchecking a tag's last use in the Tags menu keeps focus on its row, and checking it again brings the tag back", async ({
  context,
}) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const { id } = await tool<{ id: string }>(page, "create_diagram", { title: "Alpha", tags: ["x", "y"], open: false })
  await tool(page, "create_diagram", { title: "Beta", tags: ["x"], open: false })
  const hasY = async () =>
    (await tool<{ diagrams: { id: string; tags: string[] }[] }>(page, "get_library")).diagrams.find((d) => d.id === id)?.tags.includes("y")
  await page.locator(`[data-card-id="${id}"]`).focus()
  await page.keyboard.press(" ")
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).focus()
  await page.keyboard.press("Enter")
  const y = page.getByRole("checkbox", { name: "y", exact: true })
  await y.focus()
  await page.keyboard.press(" ")
  await expect.poll(hasY).toBe(false)
  await expect(y).toHaveAttribute("aria-checked", "false")
  await expect(y).toBeFocused()

  await page.keyboard.press(" ")
  await expect(y).toHaveAttribute("aria-checked", "true")
  await expect.poll(hasY).toBe(true)

  await page.keyboard.press("Tab")
  expect(
    await page.evaluate(() => {
      const f = document.activeElement!
      return !f.matches("[data-radix-focus-guard]") && (!!f.closest("[data-selection-menu]") || f.textContent === "Tags")
    })
  ).toBe(true)
})

test("unchecking a tag just created in the Tags menu keeps focus on its row", async ({ browserName, context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const { id } = await tool<{ id: string }>(page, "create_diagram", { title: "Alpha", tags: ["x"], open: false })
  await page.locator(`[data-card-id="${id}"]`).focus()
  await page.keyboard.press(" ")
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).focus()
  await page.keyboard.press("Enter")
  await page.keyboard.type("fresh")
  await page.keyboard.press("Enter")
  const fresh = page.getByRole("checkbox", { name: "fresh", exact: true })
  await expect(fresh).toHaveAttribute("aria-checked", "true")
  await fresh.focus()
  await page.keyboard.press(" ")
  // Its last use is gone, so the sidebar drops it; the menu keeps the row.
  await expect(page.getByRole("row", { name: "fresh", exact: true })).toHaveCount(0)
  await expect(fresh).toHaveAttribute("aria-checked", "false")
  await expect(fresh).toBeFocused()
  // WebKit doesn't Tab to buttons, so from a row with one below it Tab reaches Radix's focus guard, unchecked or not.
  if (browserName === "webkit") return
  await page.keyboard.press("Tab")
  expect(
    await page.evaluate(() => {
      const f = document.activeElement!
      return !f.matches("[data-radix-focus-guard]") && (!!f.closest("[data-selection-menu]") || f.textContent === "Tags")
    })
  ).toBe(true)
})

test("a tag an agent renames while the Tags menu is open shows only under its new name", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const { id } = await tool<{ id: string }>(page, "create_diagram", { title: "Alpha", tags: ["old"], open: false })
  await page.locator(`[data-card-id="${id}"]`).click({ button: "right" })
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).click()
  await expect(page.getByRole("checkbox", { name: "old", exact: true })).toBeVisible()
  await tool(page, "update_tag", { path: "old", moveTo: "renamed" })
  await expect(page.getByRole("checkbox", { name: "renamed", exact: true })).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("checkbox", { name: "old", exact: true })).toHaveCount(0)
})

test("unchecking the view's tag in the Tags menu when every card of it is selected leaves focus on the library", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "A", tags: ["x"], open: false })
  await page.evaluate(() => (location.hash = "/?tag=x"))
  const cards = page.locator("[data-card-id]")
  await expect(cards).toHaveCount(1)
  await cards.first().focus()
  await page.keyboard.press(" ")
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).focus()
  await page.keyboard.press("Enter")
  await page.getByRole("checkbox", { name: "x", exact: true }).focus()
  await page.keyboard.press(" ")
  await expect(cards).toHaveCount(0)
  await expect(page.getByPlaceholder("Find or create a tag")).toBeHidden()
  await expect(page.locator(".eos-library-scroller")).toBeFocused()
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

test("with more tags than the Tags menu has room for, its rows keep their height", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const tags = Array.from({ length: 12 }, (_, i) => `tag-${i}`)
  const { id } = await tool<{ id: string }>(page, "create_diagram", { title: "Alpha", tags, open: false })
  await page.locator(`[data-card-id="${id}"]`).click({ button: "right" })
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).click()
  // Matches every tag, and isn't one, so the Create row shows below them.
  await page.getByPlaceholder("Find or create a tag").fill("tag")
  const menu = page.locator("[data-selection-menu]")
  const rows = menu.getByRole("checkbox").or(menu.getByRole("button", { name: /^Create/ }))
  await expect(rows).toHaveCount(13)
  // At least WCAG's 24px target size.
  for (const height of await rows.evaluateAll((all) => all.map((r) => r.getBoundingClientRect().height)))
    expect(height).toBeGreaterThanOrEqual(24)
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
  await page.getByRole("menuitem", { name: "Delete tag" }).click()
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
  await expect(drawer).toHaveAttribute("open")
  const library = await tool<{ diagrams: { title: string; tags: string[] }[] }>(page, "get_library")
  expect(library.diagrams.find((d) => d.title === "alpha")?.tags).toEqual(["alpha"])
})

for (const width of [700, 1200]) {
  test(`at ${width}px, a keyboard tag drag's announcement reaches the accessibility tree`, async ({ browserName, context }) => {
    test.skip(browserName !== "chromium", "Reads the accessibility tree over Chromium's DevTools protocol")
    await withAgentTools(context)
    const page = await context.newPage()
    await page.setViewportSize({ width, height: 800 })
    await page.goto("/#/")
    await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
    for (const tag of ["alpha", "beta"]) await tool(page, "create_diagram", { title: tag, tags: [tag], open: false })
    // In the narrow window the tree is in the modal drawer, which makes the rest of the page inert.
    if (width < 768) await page.getByRole("button", { name: "Show sidebar" }).click()
    const tree = page.getByRole("treegrid", { name: "Tags" })
    await tree.getByRole("row", { name: "alpha", exact: true }).focus()
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("button", { name: /^Drop on beta/ })).toBeFocused()
    const cdp = await context.newCDPSession(page)
    const announced = async () => {
      const { nodes } = await cdp.send("Accessibility.getFullAXTree")
      return nodes.some((n) => !n.ignored && /^Started dragging/.test(String(n.name?.value ?? "")))
    }
    await expect.poll(announced).toBe(true)
  })
}

test("a tag tree long enough to scroll keeps the app shell, and the phone drawer, in place", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  for (let i = 0; i < 24; i++)
    await tool(page, "create_diagram", { title: `D${i}`, tags: [`project-${String(i).padStart(2, "0")}`], open: false })
  const tree = page.getByRole("treegrid", { name: "Tags" })
  await expect(tree.getByRole("row", { name: /project-23/ })).toBeAttached()
  expect(await tree.evaluate((t) => t.scrollHeight > t.clientHeight)).toBe(true)
  const documentScroll = () => page.evaluate(() => document.scrollingElement!.scrollTop)

  // A wheel over the header, then scrolling the library to its end and past it.
  await page.mouse.move(640, 25)
  await page.mouse.wheel(0, 600)
  await page.mouse.move(700, 400)
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 400)
  await expect
    .poll(() => page.locator(".eos-library-scroller").evaluate((s) => s.scrollHeight - s.clientHeight - s.scrollTop))
    .toBeLessThanOrEqual(1)
  await page.mouse.wheel(0, 400)
  expect(await documentScroll()).toBe(0)
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBe(720)

  await page.setViewportSize({ width: 375, height: 667 })
  await page.getByRole("button", { name: "Show sidebar" }).click()
  const drawer = page.locator("dialog[open]")
  await expect(drawer).toBeVisible()
  await page.mouse.move(150, 30)
  await page.mouse.wheel(0, 500)
  await page.mouse.move(150, 400)
  await page.mouse.wheel(0, 2000)
  expect(await drawer.evaluate((d) => [d.scrollTop, d.scrollHeight - d.clientHeight])).toEqual([0, 0])
})

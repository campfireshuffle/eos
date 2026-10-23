import { expect, test, type Page } from "@playwright/test"

import { newDiagram, openEditor, tabTo, tool, withAgentTools } from "./helpers"

// Arriving at another history entry owes the page focus, on its heading, which is named from the route as the tab's
// title is. A replace (typing a search, an import opening its diagram) keeps what's owed; an agent's navigation owes
// nothing. What's owed is settled by the next focus anywhere: the heading taking it, or the person moving it.

const heading = (page: Page) => page.getByRole("heading", { level: 1 })
const titleField = (page: Page) => page.getByRole("textbox", { name: "Diagram title" })
const go = (page: Page, hash: string) => page.evaluate((h) => (location.hash = h), hash)

test("Enter on a card focuses the diagram's heading, and Back and Forward focus each page's heading", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await tool(page, "update_diagram", { id, title: "Checkout flow" })
  await expect(page).toHaveTitle("Diagrams · Eos")
  await page.locator(`[data-card-id="${id}"]`).focus()
  await page.keyboard.press("Enter")
  await expect(heading(page)).toBeFocused()
  await expect(heading(page)).toHaveText("Checkout flow")
  await expect(page).toHaveTitle("Checkout flow · Eos")

  await page.getByRole("button", { name: "Back" }).focus()
  await page.keyboard.press("Enter")
  await expect(heading(page)).toBeFocused()
  await expect(heading(page)).toHaveText("Diagrams")
  await expect(page).toHaveTitle("Diagrams · Eos")

  await page.getByRole("button", { name: "Forward" }).focus()
  await page.keyboard.press("Enter")
  await expect(heading(page)).toBeFocused()
  await expect(page).toHaveTitle("Checkout flow · Eos")
})

test("typing just after opening a diagram with Enter leaves its title alone", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await page.locator(`[data-card-id="${id}"]`).focus()
  await page.keyboard.press("Enter")
  await expect(heading(page)).toBeFocused()
  await page.keyboard.type("xyz")
  await expect(titleField(page)).toHaveValue("Test")
  expect((await tool<{ diagram: { meta: { title: string } } }>(page, "get_diagram", { id })).diagram.meta.title).toBe("Test")
})

test("New diagram focuses the new diagram's heading", async ({ page }) => {
  await page.goto("/#/")
  await page.getByRole("button", { name: "New diagram" }).click()
  await expect(heading(page)).toBeFocused()
  await expect(heading(page)).toHaveText("Untitled")
  await expect(page).toHaveTitle("Untitled · Eos")
})

test("each library view's heading reads as the tab's title does", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await newDiagram(page, "flowchart LR\n  A --> B")
  await tool(page, "create_diagram", { title: "Tagged", tags: ["work"], open: false })
  for (const [hash, name] of [
    ["/", "Diagrams"],
    ["/?starred=1", "Starred"],
    ["/?tag=work", "#work"],
    ["/?deleted=1", "Deleted"],
  ] as const) {
    await go(page, hash)
    await expect(heading(page)).toHaveText(name)
    await expect(page).toHaveTitle(`${name} · Eos`)
  }
})

test("a library view chosen in the sidebar focuses its heading", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await newDiagram(page, "flowchart LR\n  A --> B")
  await tool(page, "create_diagram", { title: "Tagged", tags: ["work"], open: false })
  const sidebar = page.locator("aside")
  await sidebar.getByRole("link", { name: /^Starred/ }).click()
  await expect(heading(page)).toBeFocused()
  await sidebar.getByText("work", { exact: true }).click()
  await expect(heading(page)).toBeFocused()
  await expect(heading(page)).toHaveText("#work")
})

test("a view chosen in the phone's drawer focuses its heading, from the library or a diagram", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  const drawer = page.getByRole("dialog", { name: "Navigation" })
  for (const start of [() => page.goto("/#/"), () => openEditor(page, id)]) {
    await start()
    await page.getByRole("button", { name: "Show sidebar" }).click()
    await drawer.getByRole("link", { name: /^Starred/ }).click()
    await expect(drawer).toBeHidden()
    await expect(heading(page)).toBeFocused()
    await expect(heading(page)).toHaveText("Starred")
  }
})

// The drawer is open only for the page it was opened on: it closes when the history entry changes, and not for
// anything else that starts a navigation, such as a download.
test("on a phone, a backup exported from Settings over the drawer leaves the drawer open, and Escape returns to its Settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/#/")
  await page.getByRole("button", { name: "Show sidebar" }).click()
  const drawer = page.getByRole("dialog", { name: "Navigation" })
  // From the keyboard, so the button has focus to return to: Safari doesn't focus a button it clicks.
  await drawer.getByRole("button", { name: "Settings" }).focus()
  await page.keyboard.press("Enter")
  const settings = page.getByRole("dialog", { name: "Settings" })
  await settings.getByRole("button", { name: "Storage" }).click()
  const download = page.waitForEvent("download")
  await settings.getByRole("button", { name: "Export backup" }).click()
  await download
  await page.keyboard.press("Escape")
  await expect(settings).toBeHidden()
  await expect(drawer.getByRole("button", { name: "Settings" })).toBeFocused()
  await expect(drawer).toHaveAttribute("open")
})

test("on a phone, closing Settings opened from the drawer after an agent changed the page doesn't lose focus", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await openEditor(page, id)
  await page.getByRole("button", { name: "Show sidebar" }).click()
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("button", { name: "Settings" }).focus()
  await page.keyboard.press("Enter")
  const settings = page.getByRole("dialog", { name: "Settings" })
  await expect(settings).toBeVisible()
  await tool(page, "set_view", { page: "library" })
  await expect(page).toHaveTitle("Diagrams · Eos")
  await page.keyboard.press("Escape")
  await expect(settings).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY")
})

test("focus the person moves while a diagram is still loading stays where they put it", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  let release!: () => void
  const released = new Promise<void>((r) => (release = r))
  // The editor's code, held back until the person has moved on.
  await page.route(/\/assets\/editor-[^/]*\.js$/, async (route) => (await released, route.continue()))
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await page.locator(`[data-card-id="${id}"]`).focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`#/d/${id}$`))
  const starred = page.locator("aside").getByRole("link", { name: /^Starred/ })
  await starred.focus()
  release()
  await expect(titleField(page)).toBeVisible()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await expect(starred).toBeFocused()
})

test("a diagram that doesn't exist names itself, and takes focus", async ({ page }) => {
  await page.goto("/#/")
  await expect(heading(page)).toHaveText("Diagrams")
  await go(page, "/d/nope")
  await expect(heading(page)).toHaveText("Not found")
  await expect(heading(page)).toBeFocused()
  await expect(page).toHaveTitle("Not found · Eos")
})

test("a share link opened in an open tab focuses the imported diagram's heading", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await newDiagram(page, "flowchart LR\n  A --> B")
  const { url } = await tool<{ url: string }>(page, "export", { format: "link", source: "flowchart LR\n  X --> Y" })
  await go(page, new URL(url).hash)
  await expect(page).toHaveURL(/#\/d\//)
  await expect(heading(page)).toBeFocused()
  await expect(heading(page)).toHaveText("diagram")
})

test("going back under an open dialog focuses the page's heading once the dialog closes with nowhere to return to", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await page.locator(`[data-card-id="${id}"]`).focus()
  await page.keyboard.press("Enter")
  await expect(heading(page)).toBeFocused()
  // Settings opens over the diagram's heading, which going back takes away.
  await tool(page, "set_view", { settingsOpen: true })
  const settings = page.getByRole("dialog", { name: "Settings" })
  await expect(settings).toBeVisible()
  await page.goBack()
  await expect(page).toHaveTitle("Diagrams · Eos")
  await page.keyboard.press("Escape")
  await expect(settings).toBeHidden()
  await expect(heading(page)).toBeFocused()
  await expect(heading(page)).toHaveText("Diagrams")
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
  await expect(titleField(page)).toHaveValue("Test")
  await expect(page).toHaveTitle("Test · Eos")
  await expect(heading(page)).not.toBeFocused()
})

// Whose navigation it is comes from the navigation itself: nothing an agent did earlier carries over to the person's.
test.describe("the person's navigation after an agent's still focuses the page", () => {
  test("Enter on a card, after an agent showed Starred", async ({ context }) => {
    await withAgentTools(context)
    const page = await context.newPage()
    const id = await newDiagram(page, "flowchart LR\n  A --> B")
    await tool(page, "update_diagram", { id, starred: true })
    await tool(page, "set_view", { filters: { starred: true } })
    await expect(heading(page)).toHaveText("Starred")
    await page.locator(`[data-card-id="${id}"]`).focus()
    await page.keyboard.press("Enter")
    await expect(heading(page)).toBeFocused()
    await expect(heading(page)).toHaveText("Test")
  })

  test("the Starred link, after an agent opened a diagram", async ({ context }) => {
    await withAgentTools(context)
    const page = await context.newPage()
    const id = await newDiagram(page, "flowchart LR\n  A --> B")
    await tool(page, "set_view", { page: "diagram", diagramId: id })
    await expect(heading(page)).toHaveText("Test")
    await page
      .locator("aside")
      .getByRole("link", { name: /^Starred/ })
      .click()
    await expect(heading(page)).toBeFocused()
    await expect(heading(page)).toHaveText("Starred")
  })

  test("Enter on a card, after an agent's navigation and a reload", async ({ context }) => {
    await withAgentTools(context)
    const page = await context.newPage()
    const id = await newDiagram(page, "flowchart LR\n  A --> B")
    await tool(page, "set_view", { filters: { sort: "title" } })
    await page.reload()
    await page.locator(`[data-card-id="${id}"]`).focus()
    await page.keyboard.press("Enter")
    await expect(heading(page)).toBeFocused()
    await expect(heading(page)).toHaveText("Test")
  })
})

test("back on the library, its heading has focus, not the cards' grid, and Tab goes on into the grid", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await page.locator(`[data-card-id="${id}"]`).focus()
  await page.keyboard.press("Enter")
  await expect(heading(page)).toBeFocused()
  await page.getByRole("button", { name: "Back" }).focus()
  await page.keyboard.press("Enter")
  await expect(heading(page)).toHaveText("Diagrams")
  await expect(heading(page)).toBeFocused()
  await tabTo(page, page.locator("[data-card-id]").first(), 10)
})

import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import { tool, withAgentTools } from "./helpers"

test("Esc cancels a confirm without dropping the selection", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "Keep me", open: false })

  await page
    .locator("[data-card-id]")
    .first()
    .click({ modifiers: ["ControlOrMeta"] })
  await expect(page.getByText("1 selected")).toBeVisible()
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("alertdialog")).toBeHidden()
  await expect(page.getByText("1 selected")).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(page.getByText("1 selected")).toBeHidden()
})

test("an agent's confirm doesn't replace one the person has open", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "Keep me", open: false })

  await page
    .locator("[data-card-id]")
    .first()
    .click({ modifiers: ["ControlOrMeta"] })
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText("Move this diagram to Deleted?")

  expect(await tool(page, "delete_all_data")).toMatchObject({ ok: false, code: "busy" })
  await expect(dialog).toContainText("Move this diagram to Deleted?")
})

test.describe("marquee", () => {
  /** A library of 24 cards (plus any the app starts with), in a window short enough to scroll. */
  async function library(context: BrowserContext) {
    await withAgentTools(context)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto("/#/")
    await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
    for (let i = 0; i < 24; i++) await tool(page, "create_diagram", { title: `Card ${i}`, open: false })
    const cards = page.locator("[data-card-id]")
    await expect(cards.filter({ hasText: "Card 23" })).toBeVisible()
    return { page, cards }
  }

  /** Presses on the empty padding left of `from`, and drags in steps to just inside `to`. */
  async function dragFrom(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    await page.mouse.move(from.x - 6, from.y + 4)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++)
      await page.mouse.move(from.x - 6 + ((to.x + 10 - from.x) * i) / 10, from.y + 4 + ((to.y + 16 - from.y) * i) / 10)
  }

  const count = async (page: Page) => Number((await page.getByText(/^\d+ selected$/).textContent())?.split(" ")[0])
  const selectedIds = (page: Page) =>
    page
      .locator("[data-card-id]")
      .filter({ has: page.getByText("Selected", { exact: true }) })
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-card-id")))

  test("selects the cards it covers, including ones scrolled into it mid-drag", async ({ context }) => {
    const { page, cards } = await library(context)
    await dragFrom(page, (await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!)
    await expect(page.getByText("2 selected")).toBeVisible()

    // Scrolling while the button is held stretches the box down through more rows.
    await page.locator(".eos-library-scroller").evaluate((el) => (el.scrollTop += 600))
    await expect.poll(() => count(page)).toBeGreaterThan(2)
    const during = await count(page)
    await page.mouse.up()
    expect(await count(page)).toBe(during)
  })

  test("⇧ adds to the selection", async ({ context }) => {
    const { page, cards } = await library(context)
    const first = (await cards.nth(0).boundingBox())!
    await dragFrom(page, first, (await cards.nth(1).boundingBox())!)
    await page.mouse.up()
    await expect(page.getByText("2 selected")).toBeVisible()

    // The first card of the next row, on its own.
    const boxes = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
    const below = boxes.find((b) => b.y > first.y + first.height && Math.abs(b.x - first.x) < 1)!
    await page.keyboard.down("Shift")
    await dragFrom(page, below, below)
    await page.mouse.up()
    await page.keyboard.up("Shift")
    await expect(page.getByText("3 selected")).toBeVisible()
  })

  test("follows the cards when the library changes mid-drag", async ({ context }) => {
    const { page, cards } = await library(context)
    // By title, so the newcomer below lands first (cards made in the same instant tie on Modified).
    await page.getByLabel("Sort").selectOption("title")
    await expect(cards.first()).toContainText("Card 0")
    const [a, b] = await cards.evaluateAll((els) => els.slice(0, 2).map((el) => el.getAttribute("data-card-id")))
    const first = (await cards.nth(0).boundingBox())!
    const second = (await cards.nth(1).boundingBox())!
    await dragFrom(page, first, second)
    await expect.poll(() => selectedIds(page)).toEqual([a, b])

    // An agent's new diagram takes the first slot and pushes the others along, under the held box.
    const { id } = await tool<{ id: string }>(page, "create_diagram", { title: "A newcomer", open: false })
    await expect(cards.first()).toHaveAttribute("data-card-id", id)
    await page.mouse.move(second.x + 11, first.y + 20)
    await expect.poll(() => selectedIds(page)).toEqual([id, a])
    await page.mouse.up()
  })

  test("leaving the library mid-drag doesn't throw", async ({ context }) => {
    const { page, cards } = await library(context)
    const errors: Error[] = []
    page.on("pageerror", (e) => errors.push(e))
    const id = await cards.first().getAttribute("data-card-id")
    await dragFrom(page, (await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!)
    await page.evaluate((id) => (location.hash = `#/d/${id}`), id)
    await page.locator(".cm-content").waitFor()
    await page.mouse.move(300, 300)
    await page.mouse.up()
    await page.evaluate(() => new Promise(requestAnimationFrame))
    expect(errors).toEqual([])
  })
})

// Safari throws once a page calls history.replaceState more than 100 times in 10 seconds.
test("a long search keeps every keystroke and reaches the URL", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto("/#/")
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  await search.click()
  const text = "the quick brown fox jumps over the lazy dog ".repeat(3)
  await page.keyboard.type(text, { delay: 20 })
  await expect(search).toHaveValue(text)
  await expect.poll(() => new URL(page.url()).hash).toBe(`#/?${new URLSearchParams({ q: text })}`)
  expect(errors).toEqual([])
})

test("back and forward show each entry's search in the box", async ({ page }) => {
  await page.goto("/#/?q=one")
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  await expect(search).toHaveValue("one")
  await page.evaluate(() => (location.hash = "/?q=two"))
  await expect(search).toHaveValue("two")
  await page.goBack()
  await expect(search).toHaveValue("one")
  await page.goForward()
  await expect(search).toHaveValue("two")
})

test("going back right after typing leaves the search in the entry it was typed in", async ({ page }) => {
  await page.goto("/#/")
  await page.evaluate(() => (location.hash = "/?tag=fruit"))
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  await search.click()
  await page.keyboard.type("app")
  await page.goBack()
  // Past any write still due from the typing.
  await page.waitForTimeout(400)
  expect(new URL(page.url()).hash).toBe("#/")
  await expect(search).toHaveValue("")
  await page.goForward()
  await expect(page).toHaveURL(/tag=fruit/)
  // At least the first keystroke reached the entry's URL at once, and the box shows what did.
  await expect(page).toHaveURL(/q=a/)
  const q = new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("q")
  await expect(search).toHaveValue(q!)
})

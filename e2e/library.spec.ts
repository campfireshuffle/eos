import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test"

import { focusNext, focusPrevious, newDiagram, openEditor, selectAll, tabTo, tool, withAgentTools } from "./helpers"

test("Esc cancels a confirm without dropping the selection", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "Keep me", open: false })

  await page.locator("[data-card-id]").first().click({ button: "right" })
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("alertdialog")).toBeHidden()
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(page.getByText("1 selected", { exact: true })).toBeHidden()
})

test("an agent's confirm doesn't replace one the person has open", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "Keep me", open: false })

  await page.locator("[data-card-id]").first().click({ button: "right" })
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText("Move this diagram to Deleted?")

  expect(await tool(page, "delete_all_data")).toMatchObject({ ok: false, code: "busy" })
  await expect(dialog).toContainText("Move this diagram to Deleted?")
})

test("a search in Deleted that matches nothing says so, and an empty Deleted says it's empty", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/?deleted=1")
  await expect(page.getByRole("status").filter({ hasText: "Nothing deleted." })).toBeVisible()

  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "Old roadmap", open: false })
  await page.locator("[data-card-id]", { hasText: "Old roadmap" }).click({ button: "right" })
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await expect(page.locator("[data-card-id]", { hasText: "Old roadmap" })).toHaveCount(0)

  await page.goto("/#/?deleted=1")
  await expect(page.locator("[data-card-id]", { hasText: "Old roadmap" })).toBeVisible()
  await page.getByRole("textbox", { name: "Search diagrams" }).first().fill("zzz")
  await expect(page.getByRole("status").filter({ hasText: "No diagrams match." })).toBeVisible()
  await expect(page.getByText("Nothing deleted.")).toBeHidden()
})

/** The selection bar's count, which reads 0 while the bar is hidden. */
const selectionCount = (page: Page) => page.getByText(/^\d+ selected$/)

test.describe("selecting", () => {
  const titles = ["Apple pie", "Apple crumble", "Pear crumble"]
  /** A library with `titles` in it, each tagged with its first word. */
  async function library(context: BrowserContext) {
    await withAgentTools(context)
    const page = await context.newPage()
    await page.goto("/#/")
    await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
    for (const title of titles) await tool(page, "create_diagram", { title, tags: [title.split(" ")[0].toLowerCase()], open: false })
    for (const title of titles) await expect(card(page, title)).toBeVisible()
    return page
  }
  const card = (page: Page, title: string) => page.locator("[data-card-id]", { hasText: title })

  test("the selection survives resizing across 768px (the library stays mounted)", async ({ context }) => {
    const page = await library(context)
    await page.setViewportSize({ width: 1024, height: 700 })
    await card(page, "Apple pie").click({ button: "right" })
    await card(page, "Pear crumble").click()
    await expect(selectionCount(page)).toHaveText("2 selected")
    for (const viewport of [
      { width: 700, height: 1024 },
      { width: 1024, height: 700 },
    ]) {
      await page.setViewportSize(viewport)
      await expect(selectionCount(page)).toHaveText("2 selected")
    }
  })

  test("a right-click starts selecting, and then clicks add and remove cards instead of opening them", async ({ context }) => {
    const page = await library(context)
    await card(page, "Apple pie").click({ button: "right" })
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)

    await card(page, "Pear crumble").click()
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()
    // A right-click while selecting toggles too, as a long press does.
    await card(page, "Apple crumble").click({ button: "right" })
    await expect(page.getByText("3 selected", { exact: true })).toBeVisible()
    await card(page, "Apple crumble").click()
    // ⌥-click isn't the browser's (WebKit would open the card in place), so it toggles like a plain click.
    await card(page, "Pear crumble").click({ modifiers: ["Alt"] })
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)

    // Unselecting the last card leaves selecting, so the next click opens.
    await card(page, "Apple pie").click()
    await expect(selectionCount(page)).toHaveText("0 selected")
    await card(page, "Pear crumble").click()
    await expect(page).toHaveURL(/#\/d\//)
  })

  test("⌘-click opens a new tab and leaves the selection alone", async ({ context, browserName }) => {
    test.fail(
      browserName === "webkit",
      "React Aria opens a link row's ⌘-click in the same tab in WebKit: https://github.com/campfireshuffle/eos/issues/27"
    )
    const page = await library(context)
    const opened = context.waitForEvent("page", { timeout: 5000 })
    await card(page, "Apple pie").click({ modifiers: ["ControlOrMeta"] })
    await opened
    await expect(selectionCount(page)).toHaveText("0 selected")
    await expect(page).toHaveURL(/#\/$/)
  })

  test("while selecting, ⌘-click adds or removes a card, and Shift-click adds the ones between", async ({ context }) => {
    const page = await library(context)
    await page.getByLabel("Sort").selectOption("title")
    await expect(page.locator("[data-card-id]").first()).toContainText("Apple crumble")
    await card(page, "Apple crumble").click({ button: "right" })
    await card(page, "Apple pie").click({ modifiers: ["ControlOrMeta"] })
    await expect(selectionCount(page)).toHaveText("2 selected")
    await card(page, "Apple pie").click({ modifiers: ["ControlOrMeta"] })
    await expect(selectionCount(page)).toHaveText("1 selected")
    // From the card last selected to the one clicked.
    await card(page, "Pear crumble").click({ modifiers: ["Shift"] })
    await expect(selectionCount(page)).toHaveText("3 selected")
    expect(context.pages()).toHaveLength(1)
    await expect(page).toHaveURL(/#\/\?sort=title$/)
  })

  // A GridList convention: ⌘A selects every card while focus is in the grid, and is the page's anywhere else.
  test("⌘A on a card selects every card shown, after the tag filter and search", async ({ context }) => {
    const page = await library(context)
    const all = await page.locator("[data-card-id]").count()
    await page.locator("[data-card-id]").first().focus()
    await selectAll(page)
    await expect(page.getByText(`${all} selected`, { exact: true })).toBeVisible()
    await page.keyboard.press("Escape")

    await page.evaluate(() => (location.hash = "/?tag=apple"))
    await expect(page.locator("[data-card-id]")).toHaveCount(2)
    await page.locator("[data-card-id]").first().focus()
    await selectAll(page)
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()
    await page.keyboard.press("Escape")

    await page.evaluate(() => (location.hash = "/?q=crumble"))
    // The tag view also shows 2 cards, so wait for the search's own: Apple pie gone, Pear crumble shown.
    await expect(card(page, "Apple pie")).toBeHidden()
    await expect(card(page, "Pear crumble")).toBeVisible()
    await expect(page.locator("[data-card-id]")).toHaveCount(2)
    await page.locator("[data-card-id]").first().focus()
    await selectAll(page)
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()
    await expect(card(page, "Apple crumble")).toHaveAttribute("aria-selected", "true")
    await expect(card(page, "Pear crumble")).toHaveAttribute("aria-selected", "true")
  })

  test("a search drops the cards it hides from the selection", async ({ context }) => {
    const page = await library(context)
    const all = await page.locator("[data-card-id]").count()
    await page.locator("[data-card-id]").first().focus()
    await selectAll(page)
    await expect(page.getByText(`${all} selected`, { exact: true })).toBeVisible()
    await page.getByRole("textbox", { name: "Search diagrams" }).first().fill("pear")
    await expect(page.locator("[data-card-id]")).toHaveCount(1)
    await expect(selectionCount(page)).toHaveText("1 selected")

    // Unselecting the last card shown leaves selecting, so the next click opens.
    await card(page, "Pear crumble").click()
    await expect(selectionCount(page)).toHaveText("0 selected")
    await card(page, "Pear crumble").click()
    await expect(page).toHaveURL(/#\/d\//)
  })

  test("untagging cards in that tag's view drops them from the selection", async ({ context }) => {
    const page = await library(context)
    await page.evaluate(() => (location.hash = "/?tag=apple"))
    await expect(page.locator("[data-card-id]")).toHaveCount(2)
    await card(page, "Apple pie").click({ button: "right" })
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).click()
    await page.getByRole("checkbox", { name: "apple" }).click()
    await expect(page.locator("[data-card-id]")).toHaveCount(1)
    await expect(selectionCount(page)).toHaveText("0 selected")

    await page.keyboard.press("Escape")
    await card(page, "Apple crumble").click()
    await expect(page).toHaveURL(/#\/d\//)
  })

  /** Expects focus on `target`: not dropped to the page, and not left inside the selection bar's inert part. */
  async function expectFocusOn(page: Page, target: Locator) {
    await expect(target).toBeFocused()
    expect(await page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest("[inert]"))).toBe(true)
  }
  const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection" })
  /** Selects `target` with Space, then Tabs to the bar's `action` and presses Enter. */
  async function selectAndPress(page: Page, target: Locator, action: string) {
    await target.focus()
    await page.keyboard.press(" ")
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await tabTo(page, bar(page).getByRole("button", { name: action, exact: true }))
    await page.keyboard.press("Enter")
  }
  /** Moves the cards titled `gone` to Deleted, and opens Deleted. */
  async function deleteThenOpenDeleted(page: Page, gone: string[]) {
    for (const title of gone) await card(page, title).click({ button: "right" })
    await bar(page).getByRole("button", { name: "Delete", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
    await expect(selectionCount(page)).toHaveText("0 selected")
    await page.evaluate(() => (location.hash = "/?deleted=1"))
    await expect(page.locator("[data-card-id]")).toHaveCount(gone.length)
  }

  test("Clear selection from the keyboard leaves focus on the card last selected", async ({ context }) => {
    const page = await library(context)
    const second = page.locator("[data-card-id]").nth(1)
    await selectAndPress(page, second, "Clear selection")
    await expect(selectionCount(page)).toHaveText("0 selected")
    await expectFocusOn(page, second)
  })

  test("Esc on the selection bar leaves focus on the card last selected", async ({ context }) => {
    const page = await library(context)
    const second = page.locator("[data-card-id]").nth(1)
    await second.focus()
    await page.keyboard.press(" ")
    await focusNext(page)
    await expect(bar(page).getByRole("button", { name: "Star" })).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(selectionCount(page)).toHaveText("0 selected")
    await expectFocusOn(page, second)
  })

  test("Delete from the keyboard, once confirmed, moves focus to the next card", async ({ context }) => {
    const page = await library(context)
    const cards = page.locator("[data-card-id]")
    const [first, second] = await cards.evaluateAll((els) => els.slice(0, 2).map((el) => el.getAttribute("data-card-id")))
    const next = page.locator(`[data-card-id="${second}"]`)
    await selectAndPress(page, cards.first(), "Delete")
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
    await expect(page.locator(`[data-card-id="${first}"]`)).toHaveCount(0)
    await expect(selectionCount(page)).toHaveText("0 selected")
    await expectFocusOn(page, next)
  })

  test("Restore from the keyboard moves focus to a card still in Deleted", async ({ context }) => {
    const page = await library(context)
    await deleteThenOpenDeleted(page, ["Apple pie", "Pear crumble"])
    await selectAndPress(page, card(page, "Apple pie"), "Restore")
    await expect(page.locator("[data-card-id]")).toHaveCount(1)
    await expect(selectionCount(page)).toHaveText("0 selected")
    await expectFocusOn(page, card(page, "Pear crumble"))
  })

  test("Delete forever on the last card in Deleted moves focus to the library, not the page", async ({ context }) => {
    const page = await library(context)
    await deleteThenOpenDeleted(page, ["Apple pie"])
    await selectAndPress(page, card(page, "Apple pie"), "Delete forever")
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete forever" }).click()
    await expect(page.getByText("Nothing deleted.")).toBeVisible()
    await expectFocusOn(page, page.locator(".eos-library-scroller"))
    // Focusable for this, but never a Tab stop.
    await expect(page.locator(".eos-library-scroller")).toHaveAttribute("tabindex", "-1")
  })

  test("⌘A in the search box selects its text, not the cards", async ({ context }) => {
    const page = await library(context)
    const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
    await search.fill("crumble")
    await expect(page.locator("[data-card-id]")).toHaveCount(2)
    await page.keyboard.press("ControlOrMeta+a")
    await expect.poll(() => search.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 7])
    await expect(selectionCount(page)).toHaveText("0 selected")
  })

  test("in a large library, one Tab reaches the selection bar from any card, and Shift+Tab returns to that card", async ({ context }) => {
    test.setTimeout(90_000)
    await withAgentTools(context)
    const page = await context.newPage()
    await page.goto("/#/")
    await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
    await page.evaluate(async () => {
      const create = (window as unknown as { __tools: Record<string, { execute(x: unknown): Promise<unknown> }> }).__tools.create_diagram
      for (let i = 0; i < 300; i++) await create.execute({ title: `Card ${i}`, open: false })
    })
    const cards = page.locator("[data-card-id]")
    await expect(page.getByRole("row", { name: "Card 299", exact: true })).toBeAttached()
    const total = await cards.count()
    const star = bar(page).getByRole("button", { name: "Star" })
    for (const n of [0, total >> 1, total - 1]) {
      const target = page.locator(`[data-card-id="${await cards.nth(n).getAttribute("data-card-id")}"]`)
      await target.focus()
      await page.keyboard.press(" ")
      await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
      await focusNext(page)
      await expect(star).toBeFocused()
      await focusPrevious(page)
      await expect(target).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(selectionCount(page)).toHaveText("0 selected")
    }
  })

  test("the arrow keys move between cards, left and right in reading order, up and down by column, and the card last focused is the Tab stop", async ({
    context,
  }) => {
    const page = await library(context)
    for (let i = 0; i < 12; i++) await tool(page, "create_diagram", { title: `More ${i}`, open: false })
    const cards = page.locator("[data-card-id]")
    await expect(page.getByRole("row", { name: "More 11", exact: true })).toBeVisible()
    const tops = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))
    const perRow = tops.filter((t) => t === tops[0]).length
    expect(perRow).toBeLessThan(tops.length)
    const nth = async (n: number) => page.locator(`[data-card-id="${await cards.nth(n).getAttribute("data-card-id")}"]`)

    // From the end of the first row to the start of the next, and back.
    await (await nth(perRow - 1)).focus()
    await page.keyboard.press("ArrowRight")
    await expect(await nth(perRow)).toBeFocused()
    await page.keyboard.press("ArrowLeft")
    await expect(await nth(perRow - 1)).toBeFocused()
    // Down and up move to the card below and back, in the same column.
    await page.keyboard.press("ArrowDown")
    await expect(await nth(2 * perRow - 1)).toBeFocused()
    await page.keyboard.press("ArrowUp")
    await expect(await nth(perRow - 1)).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await focusPrevious(page)
    await expect(await nth(perRow)).not.toBeFocused()
    await focusNext(page)
    await expect(await nth(perRow)).toBeFocused()
  })
})

test.describe("selecting on touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("a long press starts selecting, and then taps add and remove cards", async ({ context }) => {
    await withAgentTools(context)
    const page = await context.newPage()
    await page.goto("/#/")
    await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
    for (const title of ["One", "Two"]) await tool(page, "create_diagram", { title, open: false })
    const one = page.locator("[data-card-id]", { hasText: "One" })
    const two = page.locator("[data-card-id]", { hasText: "Two" })
    await expect(two).toBeVisible()

    // Playwright has no long press; a held touch pointer is one.
    const box = (await one.boundingBox())!
    const at = { clientX: box.x + 20, clientY: box.y + 20, pointerType: "touch", pointerId: 7, isPrimary: true, button: 0 }
    await one.dispatchEvent("pointerdown", { ...at, buttons: 1 })
    await page.waitForTimeout(600)
    await one.dispatchEvent("pointerup", at)
    await one.dispatchEvent("click", { ...at, detail: 1 })
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)

    await two.tap()
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()
    await one.tap()
    await two.tap()
    await expect(selectionCount(page)).toHaveText("0 selected")
    await one.tap()
    await expect(page).toHaveURL(/#\/d\//)
  })
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
    page.locator("[data-card-id][aria-selected=true]").evaluateAll((els) => els.map((el) => el.getAttribute("data-card-id")))

  test("selects the cards it covers, including ones scrolled into it mid-drag", async ({ context }) => {
    const { page, cards } = await library(context)
    await dragFrom(page, (await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!)
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()

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
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()

    // The first card of the next row, on its own.
    const boxes = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
    const below = boxes.find((b) => b.y > first.y + first.height && Math.abs(b.x - first.x) < 1)!
    await page.keyboard.down("Shift")
    await dragFrom(page, below, below)
    await page.mouse.up()
    await page.keyboard.up("Shift")
    await expect(page.getByText("3 selected", { exact: true })).toBeVisible()
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

  test("Clear after a marquee focuses the first card it selected, not one unselected earlier", async ({ context }) => {
    const { page, cards } = await library(context)
    // Selected and unselected again from the keyboard, so it was the card last toggled.
    await cards.nth(0).focus()
    await page.keyboard.press(" ")
    await page.keyboard.press(" ")
    await expect(selectionCount(page)).toHaveText("0 selected")
    // The second and third cards, which share the first row.
    const second = page.locator(`[data-card-id="${await cards.nth(1).getAttribute("data-card-id")}"]`)
    await dragFrom(page, (await cards.nth(1).boundingBox())!, (await cards.nth(2).boundingBox())!)
    await page.mouse.up()
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Clear selection" }).focus()
    await page.keyboard.press("Enter")
    await expect(selectionCount(page)).toHaveText("0 selected")
    await expect(second).toBeFocused()
  })
})

test.describe("focus after a selection-bar action", () => {
  for (const action of ["Clear selection", "Delete"])
    for (const input of ["mouse", "keyboard"])
      test(`${action} by ${input} doesn't scroll the library`, async ({ context }) => {
        await withAgentTools(context)
        const page = await context.newPage()
        await page.setViewportSize({ width: 1280, height: 720 })
        await page.goto("/#/")
        await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
        for (let i = 0; i < 60; i++) await tool(page, "create_diagram", { title: `Card ${i}`, open: false })
        const cards = page.locator("[data-card-id]")
        await expect(cards.filter({ hasText: "Card 59" })).toBeVisible()

        await cards.first().click({ button: "right" })
        await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
        const scroller = page.locator(".eos-library-scroller")
        const scrollTop = () => scroller.evaluate((el) => el.scrollTop)
        // Far down, but short of the end, which a Delete pulls up by the row it empties.
        await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight - el.clientHeight - 800))
        const before = await scrollTop()
        expect(before).toBeGreaterThan(1000)

        const button = page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: action, exact: true })
        if (input === "mouse") await button.click()
        else {
          await button.focus()
          await page.keyboard.press("Enter")
        }
        if (action === "Delete") await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
        await expect(selectionCount(page)).toHaveText("0 selected")
        await page.evaluate(() => new Promise(requestAnimationFrame))
        expect(await scrollTop()).toBe(before)
        if (input === "keyboard")
          expect(await page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest("[inert]"))).toBe(
            true
          )
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

/** Types each of `values` into the search box within one task, so no write of the typing comes due in between. */
const typeAtOnce = (search: Locator, values: string[], then?: "blur") =>
  search.evaluate(
    (el: HTMLInputElement, [values, then]) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      el.focus()
      for (const v of values) {
        set.call(el, v)
        el.dispatchEvent(new Event("input", { bubbles: true }))
      }
      const typed = location.hash
      if (then === "blur") el.blur()
      return [typed, location.hash]
    },
    [values, then] as const
  )

test("leaving the search box writes the typing still due, so Back returns to it", async ({ page }) => {
  await page.goto("/#/")
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  // Only the first keystroke is written at once; leaving the box writes the rest.
  expect(await typeAtOnce(search, ["W", "We", "Wel"], "blur")).toEqual(["#/?q=W", "#/?q=Wel"])
  await search.click()
  await page.keyboard.type("come")
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("Welcome")
  await expect(page).toHaveURL(/#\/\?q=Welcome$/)
  await page.locator("[data-card-id]").first().click()
  await page.locator(".cm-content").waitFor()
  await page.goBack()
  await expect(search).toHaveValue("Welcome")
  await expect(page).toHaveURL(/#\/\?q=Welcome$/)
})

test("a search set elsewhere shows in the box at once, and typing still due isn't written over it", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/?tag=fruit")
  await page.waitForFunction(() => "__tools" in window && "set_view" in (window as unknown as { __tools: object }).__tools)
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  const q = () => new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("q")

  // The entry's URL replaced by something else, as a link to it or the person's Move tag can.
  expect(await typeAtOnce(search, ["a", "ap"])).toEqual(["#/?tag=fruit&q=a", "#/?tag=fruit&q=a"])
  await page.evaluate(() => navigation.navigate("#/?tag=fruit&q=pear", { history: "replace" }))
  await expect(search).toHaveValue("pear")
  // Past any write still due from the typing.
  await page.waitForTimeout(400)
  expect(q()).toBe("pear")
  await expect(search).toHaveValue("pear")

  // An agent's set_view opens a new entry, which shows the URL's search, not the typing.
  expect(await typeAtOnce(search, ["pearl", "pearls"])).toEqual(["#/?tag=fruit&q=pearl", "#/?tag=fruit&q=pearl"])
  await tool(page, "set_view", { filters: { starred: true } })
  await expect(page).toHaveURL(/starred=1/)
  await expect(search).toHaveValue("pearl")
  await page.waitForTimeout(400)
  expect(q()).toBe("pearl")
  await expect(search).toHaveValue("pearl")
  await page.goBack()
  await expect(search).toHaveValue("pearl")
  expect(q()).toBe("pearl")
})

test("a search composed with an IME reaches the box and the URL as committed", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium's IME can be driven")
  await page.goto("/#/")
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  await search.click()
  const cdp = await page.context().newCDPSession(page)
  for (const text of ["n", "ni", "nih", "niha", "nihao"])
    await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length })
  await cdp.send("Input.insertText", { text: "你好" })
  await page.keyboard.type("吗")
  await expect(search).toHaveValue("你好吗")
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("q")).toBe("你好吗")
  await page.waitForTimeout(400)
  await expect(search).toHaveValue("你好吗")
})

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`the last row of cards scrolls clear of the selection bar at ${viewport.width}px wide`, async ({ context }) => {
    await withAgentTools(context)
    const page = await context.newPage()
    await page.setViewportSize(viewport)
    await page.goto("/#/")
    await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
    for (let i = 0; i < 13; i++) await tool(page, "create_diagram", { title: `Diagram number ${i}`, open: false })
    const cards = page.locator("[data-card-id]")
    await expect(cards.filter({ hasText: "Diagram number 12" })).toBeVisible()

    await cards.first().click({ button: "right" })
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    const bar = page.getByRole("toolbar", { name: "Selection" })
    // Measure once the bar has slid in.
    await bar.evaluate((el) => Promise.all(el.parentElement!.getAnimations().map((a) => a.finished)))
    // The library scrolls in its own pane on desktop and with the page on a phone; scroll both to the end.
    await page.evaluate(() => {
      const scroller = document.querySelector(".eos-library-scroller")!
      scroller.scrollTop = scroller.scrollHeight
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    const top = (await bar.boundingBox())!.y
    const bottoms = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom))
    expect(Math.max(...bottoms)).toBeLessThanOrEqual(top)
  })
}

test("in a narrow content pane, the filter pill keeps clear of the controls and its ✕ removes the filter", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 })
  await page.goto("/#/?starred=1")
  const remove = page.getByRole("link", { name: "Remove Starred filter" })
  await expect(remove).toBeVisible()
  // The sidebar dragged as wide as it goes (420px), leaving the content pane about 360px.
  const handle = (await page.getByRole("separator").first().boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 300)
  await page.mouse.down()
  await page.mouse.move(700, handle.y + 300, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await page.locator("aside").boundingBox())!.width)).toBeGreaterThanOrEqual(410)

  const pill = (await remove.boundingBox())!
  const group = (await page.getByLabel("Group by").boundingBox())!
  const apart =
    pill.x + pill.width <= group.x || group.x + group.width <= pill.x || pill.y + pill.height <= group.y || group.y + group.height <= pill.y
  expect(apart).toBe(true)
  // Nothing is drawn over the ✕, so a click there lands on it.
  const at = { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2 }
  expect(await remove.evaluate((el, { x, y }) => el.contains(document.elementFromPoint(x, y)), at)).toBe(true)
  await page.mouse.click(at.x, at.y)
  await expect(page).toHaveURL(/#\/$/)
})

// Firefox's word segmenter doesn't mark a run of Chinese, Japanese or Thai that is a single word as a word.
test("Search finds a diagram by a single Chinese, Japanese or Thai word", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  for (const title of ["東京", "日本語", "ภาษาไทย"]) await tool(page, "create_diagram", { title, open: false })
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  for (const [query, title] of [
    ["東京", "東京"],
    ["日本語", "日本語"],
    ["ไทย", "ภาษาไทย"],
  ] as const) {
    await search.fill(query)
    await expect(page.locator("[data-card-id] .text-label")).toHaveText([title])
  }
})

test("search results are one list, best match first, and Group applies again once the search is cleared", async ({ context }) => {
  test.setTimeout(90_000)
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  // An exact title from 20 days ago, among 250 diagrams made today: under Group: Date it would sit in a later section.
  const now = Date.now()
  await page.clock.setSystemTime(now - 20 * 86_400_000)
  await tool(page, "create_diagram", {
    title: "Login flow",
    source: "flowchart TD\n  U[User] --> L{Valid password?}\n  L -->|yes| H[Home]",
    open: false,
  })
  await page.clock.setSystemTime(now)
  await page.evaluate(async () => {
    const create = (window as unknown as { __tools: Record<string, { execute(x: unknown): Promise<unknown> }> }).__tools.create_diagram
    const nouns =
      "warehouse inventory shipping returns refunds onboarding payroll hiring roadmap sprint retro incident outage database migration schema".split(
        " "
      )
    for (let i = 0; i < 250; i++) {
      const [a, b] = [nouns[i % nouns.length], nouns[(i * 7 + 3) % nouns.length]]
      const lines = [
        "flowchart TD",
        ...Array.from({ length: 6 }, (_, j) => `  ${nouns[(i + j) % nouns.length]} --> ${nouns[(i + j * 5 + 1) % nouns.length]}`),
      ]
      await create.execute({ title: `${a} ${b} ${i}`, source: lines.join("\n"), open: false })
    }
  })
  const headings = page.locator(".eos-library-scroller h2")
  await expect(headings.first()).toBeVisible()
  expect(await headings.count()).toBeGreaterThan(1)

  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  // The first character switches to one list only once its results are in: no frame shows every card ungrouped.
  const cards = await page.locator("[data-card-id]").count()
  await page.evaluate(() => {
    const frames: [number, number][] = []
    Object.assign(window, { __frames: frames })
    const record = () => {
      frames.push([document.querySelectorAll(".eos-library-scroller h2").length, document.querySelectorAll("[data-card-id]").length])
      if (frames.length < 600) requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
  await search.pressSequentially("L")
  await expect(page.locator("[data-card-id] .text-label").first()).toHaveText("Login flow")
  const frames = await page.evaluate(() => (window as unknown as { __frames: [number, number][] }).__frames)
  expect(frames.filter(([h, c]) => h === 0 && c === cards)).toEqual([])

  await search.fill("Login flow")
  await expect(page.locator("[data-card-id] .text-label").first()).toHaveText("Login flow")
  await expect(headings).toHaveCount(0)

  await search.fill("")
  await expect(headings.first()).toBeVisible()
  expect(await headings.count()).toBeGreaterThan(1)
  await expect(page.getByRole("combobox", { name: "Group by" })).toHaveValue("date")
})

// Nothing a page starts as it goes away is sure to land, so the row is rebuilt on the next start.
for (const how of ["reload", "close"] as const)
  for (const wait of [0, 100, 250])
    test(`a diagram's row and search catch up with typing after a ${how} ${wait}ms after the last keystroke`, async ({ context }) => {
      await withAgentTools(context)
      const library = await context.newPage()
      const id = await newDiagram(library, "flowchart TD\n  A --> B\n")
      const editor = await context.newPage()
      await openEditor(editor, id)
      await editor.locator(".cm-line").nth(1).click()
      await editor.keyboard.press("End")
      await editor.keyboard.type("\n  B --> Zebra42", { delay: 40 })
      await editor.waitForTimeout(wait)
      if (how === "reload") await editor.reload()
      else await editor.close()
      const later = await context.newPage()
      await later.goto("/#/")
      await later.waitForFunction(() => "__tools" in window && "get_library" in (window as unknown as { __tools: object }).__tools)
      const found = async () => JSON.stringify(await tool(later, "get_library", { query: "Zebra42" })).includes(id)
      await expect.poll(found).toBe(true)
    })

test.describe("the cards' Tab stop", () => {
  /** A library of `n` diagrams titled `Card i`, made in one go, open at `hash`. `both` of them are tagged a and b, the rest a. */
  async function library(context: BrowserContext, n: number, hash: string, both: number[] = []) {
    await withAgentTools(context)
    const page = await context.newPage()
    await page.goto("/#/")
    await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
    await page.evaluate(
      async ([n, both]) => {
        const create = (window as unknown as { __tools: Record<string, { execute(x: unknown): Promise<unknown> }> }).__tools.create_diagram
        for (let i = 0; i < n; i++) await create.execute({ title: `Card ${i}`, tags: both.includes(i) ? ["a", "b"] : ["a"], open: false })
      },
      [n, both] as const
    )
    await page.evaluate((h) => (location.hash = h), hash)
    await expect(byTitle(page, `Card ${n - 1}`).first()).toBeAttached()
    return page
  }
  /** The cards, every copy, of the diagram titled exactly `title`. */
  const byTitle = (page: Page, title: string) =>
    page.locator("[data-card-id]").filter({ has: page.locator(".text-label").getByText(title, { exact: true }) })
  const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection" })
  const leftCards = (page: Page) => page.evaluate(() => !document.activeElement?.closest("[data-card-id]"))

  test("after a new search, Tab lands on its best match, not the card focused before it", async ({ context }) => {
    const page = await library(context, 3, "/?sort=title")
    for (const title of ["Pear", "Pear tart"]) await tool(page, "create_diagram", { title, open: false })
    const tart = page.locator("[data-card-id]", { hasText: "Pear tart" })
    await tart.focus()
    const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
    await search.fill("pear")
    await expect(page.locator("[data-card-id]")).toHaveCount(2)
    const best = page.locator("[data-card-id]").first()
    await expect(best.locator(".text-label")).toHaveText("Pear")
    await page.getByLabel("Sort").focus()
    await focusNext(page)
    await expect(best).toBeFocused()
    const id = await best.getAttribute("data-card-id")
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(new RegExp(`#/d/${id}`))
  })

  // Shift+Tab leaves in one press too, but React Aria focuses the grid on the way out, which can scroll the library:
  // https://github.com/campfireshuffle/eos/issues/29
  test("a diagram under two groups is two copies: one press leaves the cards from either, Tab without scrolling, and they select together", async ({
    context,
  }) => {
    const page = await library(context, 30, "/?group=subtag&sort=title", [0])
    const copies = byTitle(page, "Card 0")
    await expect(copies).toHaveCount(2)
    const scroller = page.locator(".eos-library-scroller")
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
    const second = copies.nth(1)
    await second.evaluate((el) => el.focus({ preventScroll: true }))
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

    await focusPrevious(page)
    expect(await leftCards(page)).toBe(true)
    await focusNext(page)
    await expect(second).toBeFocused()
    const top = await scroller.evaluate((el) => el.scrollTop)
    await page.keyboard.press("Space")
    await expect(copies.nth(0)).toHaveAttribute("aria-selected", "true")
    await expect(second).toHaveAttribute("aria-selected", "true")
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await focusNext(page)
    await expect(bar(page).getByRole("button", { name: "Star" })).toBeFocused()
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(top)
  })

  test("in a library of 300 grouped diagrams, the selection bar is one Tab from any card or copy, and Shift+Tab comes back to it", async ({
    context,
  }) => {
    test.setTimeout(120_000)
    const page = await library(context, 300, "/?group=subtag", [10, 150, 290])
    const star = bar(page).getByRole("button", { name: "Star" })
    for (const n of [0, 10, 150, 290, 299]) {
      const copy = byTitle(page, `Card ${n}`).last()
      await copy.focus()
      await page.keyboard.press(" ")
      await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
      await focusNext(page)
      await expect(star).toBeFocused()
      await focusPrevious(page)
      await expect(copy).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(page.getByText(/^\d+ selected$/)).toHaveText("0 selected")
    }
  })

  test("Shift-click selects the range from the card last right-clicked", async ({ context }) => {
    const page = await library(context, 6, "/?sort=title&group=none")
    await byTitle(page, "Card 0").click({ button: "right" })
    await byTitle(page, "Card 3").click({ modifiers: ["Shift"] })
    await expect(page.getByText("4 selected", { exact: true })).toBeVisible()
    for (const n of [0, 1, 2, 3]) await expect(byTitle(page, `Card ${n}`)).toHaveAttribute("aria-selected", "true")
  })

  test("Shift-click selects the range from a copy last toggled, under its own group", async ({ context }) => {
    const page = await library(context, 6, "/?sort=title&group=subtag", [0, 1, 2])
    // Group b, after group a, holds the second copy of each of the first three.
    await byTitle(page, "Card 0").nth(1).focus()
    await page.keyboard.press(" ")
    await byTitle(page, "Card 2")
      .nth(1)
      .click({ modifiers: ["Shift"] })
    await expect(page.getByText("3 selected", { exact: true })).toBeVisible()
    for (const n of [0, 1, 2])
      for (const copy of [0, 1]) await expect(byTitle(page, `Card ${n}`).nth(copy)).toHaveAttribute("aria-selected", "true")
  })

  // A GridList convention: Tab enters a list on its first selected card, else its first card.
  test("after a search that keeps the selection, Tab enters on the first selected card", async ({ context }) => {
    const page = await library(context, 6, "/?sort=title&group=none")
    await byTitle(page, "Card 3").focus()
    await page.keyboard.press(" ")
    await page.getByRole("textbox", { name: "Search diagrams" }).first().fill("Card")
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await page.getByLabel("Sort").focus()
    await focusNext(page)
    await expect(byTitle(page, "Card 3")).toBeFocused()
  })

  test("a card deleted in another tab hands focus, and the Tab stop, to its neighbour", async ({ context }) => {
    const page = await library(context, 6, "/?sort=title")
    const card = (n: number) => byTitle(page, `Card ${n}`)
    const remove = async (n: number) => {
      const other = await context.newPage()
      await other.goto("/#/?sort=title")
      const target = byTitle(other, `Card ${n}`)
      await target.click({ button: "right" })
      await bar(other).getByRole("button", { name: "Delete", exact: true }).click()
      await other.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
      await expect(card(n)).toHaveCount(0)
      await other.close()
    }

    // Focused when it goes: focus moves to the next card.
    await card(2).focus()
    await remove(2)
    await expect(card(3)).toBeFocused()

    // Focused before it goes: Tab comes back to the next card, not the first.
    await page.getByLabel("Sort").focus()
    await remove(3)
    await focusNext(page)
    await expect(card(4)).toBeFocused()
  })
})

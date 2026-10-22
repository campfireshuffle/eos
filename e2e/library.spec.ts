import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test"

import { newDiagram, openEditor, tool, withAgentTools } from "./helpers"

test("Esc cancels a confirm without dropping the selection", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "Keep me", open: false })

  await page.locator("[data-card-id]").first().click({ button: "right" })
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

  test("a right-click starts selecting, and then clicks add and remove cards instead of opening them", async ({ context }) => {
    const page = await library(context)
    await card(page, "Apple pie").click({ button: "right" })
    await expect(page.getByText("1 selected")).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)

    await card(page, "Pear crumble").click()
    await expect(page.getByText("2 selected")).toBeVisible()
    // A right-click while selecting toggles too, as a long press does.
    await card(page, "Apple crumble").click({ button: "right" })
    await expect(page.getByText("3 selected")).toBeVisible()
    await card(page, "Apple crumble").click()
    // ⌥-click isn't the browser's (WebKit would open the card in place), so it toggles like a plain click.
    await card(page, "Pear crumble").click({ modifiers: ["Alt"] })
    await expect(page.getByText("1 selected")).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)

    // Unselecting the last card leaves selecting, so the next click opens.
    await card(page, "Apple pie").click()
    await expect(selectionCount(page)).toHaveText("0 selected")
    await card(page, "Pear crumble").click()
    await expect(page).toHaveURL(/#\/d\//)
  })

  test("⌘-click opens a new tab, selecting or not, and leaves the selection alone", async ({ context }) => {
    const page = await library(context)
    const opened = context.waitForEvent("page")
    await card(page, "Apple pie").click({ modifiers: ["ControlOrMeta"] })
    await opened
    await expect(selectionCount(page)).toHaveText("0 selected")

    await card(page, "Apple pie").click({ button: "right" })
    const again = context.waitForEvent("page")
    await card(page, "Pear crumble").click({ modifiers: ["ControlOrMeta"] })
    await again
    await expect(page.getByText("1 selected")).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)
  })

  test("⌘A selects every card shown, after the tag filter and search", async ({ context }) => {
    const page = await library(context)
    const all = await page.locator("[data-card-id]").count()
    await page.keyboard.press("ControlOrMeta+a")
    await expect(page.getByText(`${all} selected`)).toBeVisible()
    await page.keyboard.press("Escape")

    await page.evaluate(() => (location.hash = "/?tag=apple"))
    await expect(page.locator("[data-card-id]")).toHaveCount(2)
    await page.keyboard.press("ControlOrMeta+a")
    await expect(page.getByText("2 selected")).toBeVisible()
    await page.keyboard.press("Escape")

    await page.evaluate(() => (location.hash = "/?q=crumble"))
    // The tag view also shows 2 cards, so wait for the search's own: Apple pie gone, Pear crumble shown.
    await expect(card(page, "Apple pie")).toBeHidden()
    await expect(card(page, "Pear crumble")).toBeVisible()
    await expect(page.locator("[data-card-id]")).toHaveCount(2)
    await page.keyboard.press("ControlOrMeta+a")
    await expect(page.getByText("2 selected")).toBeVisible()
    await expect(card(page, "Apple crumble").getByText("Selected", { exact: true })).toBeAttached()
    await expect(card(page, "Pear crumble").getByText("Selected", { exact: true })).toBeAttached()
  })

  test("a search drops the cards it hides from the selection", async ({ context }) => {
    const page = await library(context)
    const all = await page.locator("[data-card-id]").count()
    await page.keyboard.press("ControlOrMeta+a")
    await expect(page.getByText(`${all} selected`)).toBeVisible()
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
    await expect(page.getByText("1 selected")).toBeVisible()
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
  /** Selects `target` with Space, then presses Enter on the bar's `action`. */
  async function selectAndPress(page: Page, target: Locator, action: string) {
    await target.focus()
    await page.keyboard.press(" ")
    await expect(page.getByText("1 selected")).toBeVisible()
    await bar(page).getByRole("button", { name: action, exact: true }).focus()
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
    await bar(page).getByRole("button", { name: "Star" }).focus()
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
    await one.dispatchEvent("click", at)
    await expect(page.getByText("1 selected")).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)

    await two.tap()
    await expect(page.getByText("2 selected")).toBeVisible()
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
    await expect(page.getByText("1 selected")).toBeVisible()
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

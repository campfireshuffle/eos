import { expect, test, type BrowserContext } from "@playwright/test"

import { focusNext, tool, withAgentTools } from "./helpers"

/** A library long enough to scroll, open at `hash`. */
async function library(context: BrowserContext, hash: string) {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  for (let i = 0; i < 24; i++) await tool(page, "create_diagram", { title: `Diagram ${i}`, open: false })
  await page.evaluate((h) => (location.hash = h), hash)
  const scroller = page.locator(".eos-library-scroller")
  const cards = scroller.locator("a")
  const scrollTo = async (y: number) => {
    await expect.poll(() => scroller.evaluate((el, top) => (el.scrollTo({ top }), el.scrollTop), y)).toBe(y)
    // The scroll event for getting there fires with the next frame; wait it out, so it's saved and not mistaken for a later scroll.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  }
  // Past the frames a scroll restore takes to settle.
  const settledTop = async () => (await page.waitForTimeout(300), scroller.evaluate((el) => el.scrollTop))
  return { page, cards, scrollTo, settledTop }
}

test("a new page starts at the top, even where a page gone back from was scrolled", async ({ context }) => {
  const { page, cards, scrollTo, settledTop } = await library(context, "/?sort=title")
  await expect(cards.first()).toContainText("Diagram 0")
  await scrollTo(600)
  await page.goBack()
  await page.evaluate(() => (location.hash = "/?sort=created"))
  await expect(cards.first()).toContainText("Diagram 23")
  expect(await settledTop()).toBe(0)
  // Nor does changing the sort there pick up the old page's position.
  await page.getByLabel("Sort").selectOption("title")
  await expect(cards.first()).toContainText("Diagram 0")
  expect(await settledTop()).toBe(0)
})

test("changing the sort keeps the scroll position, however the page was reached", async ({ context }) => {
  const { page, cards, scrollTo, settledTop } = await library(context, "/?sort=title")
  await expect(cards.first()).toContainText("Diagram 0")
  await scrollTo(500)
  await page.getByLabel("Sort").selectOption("created")
  await expect(cards.first()).toContainText("Diagram 23")
  expect(await settledTop()).toBe(500)
})

test("back returns to where the library was scrolled after searching", async ({ context }) => {
  const { page, cards, scrollTo, settledTop } = await library(context, "/?sort=title")
  await expect(cards.first()).toContainText("Diagram 0")
  await scrollTo(200)
  await page.getByPlaceholder("Search").first().fill("Diagram")
  await expect(page).toHaveURL(/q=Diagram/)
  // A new search's results scroll the library to the top once they arrive; scroll after that.
  expect(await settledTop()).toBe(0)
  await scrollTo(500)
  // Clicked where it sits: Playwright's own click would first scroll it into view.
  await cards.nth(12).evaluate((a: HTMLElement) => a.click())
  await page.locator(".cm-content").waitFor()
  await page.goBack()
  await expect(cards).toHaveCount(24)
  expect(await settledTop()).toBe(500)
})

test("opening a diagram leaves the library where it was scrolled", async ({ context }) => {
  const { page, cards, scrollTo } = await library(context, "/?sort=title")
  await expect(cards.first()).toContainText("Diagram 0")
  await scrollTo(500)
  const scrolls = await cards.nth(12).evaluate(async (a: HTMLElement) => {
    const scroller = a.closest(".eos-library-scroller")!
    const seen: number[] = []
    scroller.addEventListener("scroll", () => seen.push(scroller.scrollTop))
    a.click()
    await new Promise((r) => setTimeout(r, 300))
    return seen
  })
  await page.locator(".cm-content").waitFor()
  expect(scrolls).toEqual([])
})

test("the library's view controls stay put while the cards scroll", async ({ context }) => {
  const { page, cards, scrollTo } = await library(context, "/?sort=title")
  await expect(cards.first()).toContainText("Diagram 0")
  const sort = page.getByRole("combobox", { name: "Sort" })
  const before = (await sort.boundingBox())!.y
  // Its header's line only shows once cards have scrolled under it.
  const line = () =>
    page
      .locator("main header")
      .last()
      .evaluate((el) => getComputedStyle(el).borderBottomColor)
  expect(await line()).toBe("rgba(0, 0, 0, 0)")
  await scrollTo(600)
  expect((await sort.boundingBox())!.y).toBe(before)
  await expect.poll(line).not.toBe("rgba(0, 0, 0, 0)")
  await scrollTo(0)
  await expect.poll(line).toBe("rgba(0, 0, 0, 0)")
})

test("an agent hides and shows the sidebar as the person's buttons do, and get_view reports it", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "set_view" in (window as unknown as { __tools: object }).__tools)
  const view = async () => (await tool<{ view: { sidebarOpen: boolean } }>(page, "get_view")).view.sidebarOpen
  expect(await view()).toBe(true)
  await tool(page, "set_view", { sidebarOpen: false })
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible()
  await expect(page.locator(".eos-shell")).toHaveAttribute("data-collapsed", "true")
  expect(await view()).toBe(false)
  // Already hidden: nothing to do.
  await tool(page, "set_view", { sidebarOpen: false })
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible()
  // The same state the button keeps, so it survives a reload.
  await page.reload()
  await page.waitForFunction(() => "__tools" in window && "set_view" in (window as unknown as { __tools: object }).__tools)
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible()
  await tool(page, "set_view", { sidebarOpen: true })
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeHidden()
  await expect(page.locator(".eos-shell")).toHaveAttribute("data-collapsed", "false")
  expect(await view()).toBe(true)
})

test("get_view answers while Eos is in a background tab, which runs no animation frames", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "get_view" in (window as unknown as { __tools: object }).__tools)
  // Playwright's pages always count as visible, so stand in for a hidden one: its frame callbacks never run.
  await page.evaluate(() => (window.requestAnimationFrame = () => 0))
  const answer = tool<{ ok: boolean }>(page, "get_view").then((r) => r.ok)
  const timeout = new Promise((r) => setTimeout(() => r("no answer within 2s"), 2000))
  expect(await Promise.race([answer, timeout])).toBe(true)
})

test("a hidden sidebar takes no focus and isn't read out, and showing it brings both back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/#/")
  const sidebar = page.locator("aside")
  // Playwright's role queries don't treat inert as hidden, so these still find the sidebar's controls.
  const settings = sidebar.getByRole("button", { name: "Settings" })
  const show = page.getByRole("button", { name: "Show sidebar" })
  const isChromium = page.context().browser()?.browserType().name() === "chromium"
  /** The names the browser's own accessibility tree gives the sidebar's controls (Chromium exposes it). */
  const readOut = async () => {
    const cdp = await page.context().newCDPSession(page)
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: { ignored: boolean; role?: { value: string }; name?: { value: string } }[]
    }
    await cdp.detach()
    return nodes
      .filter((n) => !n.ignored && n.role?.value === "button" && ["Settings", "Hide sidebar"].includes(n.name?.value ?? ""))
      .map((n) => n.name!.value)
  }
  const handle = page.getByRole("separator")
  /** The window's pixels where the resize handle's pill is, which must be a non-empty box inside the window. */
  const pillArea = async () => {
    await page.waitForFunction(() => document.getAnimations().length === 0)
    const r = await handle.evaluate((el) => el.firstElementChild!.getBoundingClientRect().toJSON() as DOMRect)
    expect(r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= page.viewportSize()!.width).toBe(true)
    return () => page.screenshot({ clip: { x: r.left, y: r.top, width: r.width, height: r.height } })
  }

  await page.getByRole("button", { name: "Hide sidebar" }).click()
  await expect(show).toBeVisible()
  await settings.evaluate((el: HTMLElement) => el.focus())
  await expect(settings).not.toBeFocused()
  if (isChromium) await expect.poll(readOut).toEqual([])
  // From the top of a fresh page, Tab skips everything in the sidebar. Its first stop is the resize handle, which
  // reopens the sidebar with the arrow keys and shows its pill at the window's edge; the next is Show sidebar.
  await page.reload()
  await expect(show).toBeVisible()
  const pill = await pillArea()
  const unfocused = await pill()
  await focusNext(page)
  await expect(handle).toBeFocused()
  // Focus is drawn: the pill shows over what was there before.
  await expect.poll(async () => (await pill()).equals(unfocused)).toBe(false)
  await focusNext(page)
  await expect(show).toBeFocused()

  await show.click()
  await expect(settings).toBeVisible()
  await settings.evaluate((el: HTMLElement) => el.focus())
  await expect(settings).toBeFocused()
  if (isChromium) await expect.poll(readOut).toEqual(["Hide sidebar", "Settings"])
  await page.reload()
  await expect(settings).toBeVisible()
  await focusNext(page)
  await expect(sidebar.getByRole("link", { name: "Eos" })).toBeFocused()
})

test("with the sidebar hidden, the window's left edge still scrolls the page, and dragging from it reopens the sidebar", async ({
  context,
}) => {
  const { page } = await library(context, "#/")
  const scroller = page.locator(".eos-library-scroller")
  await page.getByRole("button", { name: "Hide sidebar" }).click()
  await expect(page.locator(".eos-shell")).toHaveAttribute("data-collapsed", "true")
  await expect(page.locator("[data-animating]")).toHaveCount(0)
  // Within the 8px strip the collapsed sidebar's resize handle keeps at the edge.
  await page.mouse.move(4, 400)
  await page.mouse.wheel(0, 400)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.mouse.down()
  await page.mouse.move(120, 400, { steps: 5 })
  await page.mouse.move(250, 400, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator(".eos-shell")).toHaveAttribute("data-collapsed", "false")
})

// A link to the page already shown keeps its history entry, and so the entry's key.
test("clicking a link to the page already shown keeps in-app Back inside Eos, and the search in the URL", async ({ page }) => {
  await page.goto("about:blank")
  await page.goto("/#/?starred=1")
  const sidebar = page.locator("aside")
  await sidebar.getByRole("link", { name: /^Starred/ }).click() // Starred while on Starred
  await sidebar.getByRole("link", { name: "Eos" }).click()
  await sidebar.getByRole("link", { name: "Eos" }).click() // the logo while on the library
  await page.getByRole("textbox", { name: "Search diagrams" }).fill("flow")
  await expect(page).toHaveURL(/#\/\?q=flow$/)
  await page.getByRole("button", { name: "Back" }).click()
  await expect(page).toHaveURL(/#\/\?starred=1$/)
  // The first Eos entry: going back would leave Eos, so there's no Back.
  await expect(page.getByRole("button", { name: "Back" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Forward" })).toBeEnabled()
})

test("pressing in-app Back or Forward with the keyboard to the end of history keeps focus on it", async ({ page }) => {
  await page.goto("about:blank")
  await page.goto("/#/?starred=1")
  await page.locator("aside").getByRole("link", { name: "Eos" }).click()
  for (const [name, url] of [
    ["Back", /#\/\?starred=1$/],
    ["Forward", /#\/$/],
  ] as const) {
    const button = page.getByRole("button", { name })
    await button.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(url)
    await expect(button).toBeDisabled()
    await expect(button).toBeFocused()
    await page.keyboard.press("Enter") // nowhere to go
    await expect(page).toHaveURL(url)
  }
})

for (const [size, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } })) {
  test.describe(`searching while scrolled, at ${size} width`, () => {
    test.use({ viewport })
    const phone = size === "phone"

    /** 150 cards, sorted so "Login flow" comes last. Desktop scrolls the library's pane; phones scroll the page. */
    async function longLibrary(context: BrowserContext) {
      await withAgentTools(context)
      const page = await context.newPage()
      await page.goto("/#/")
      await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
      await page.evaluate(async () => {
        const tools = (window as unknown as { __tools: Record<string, { execute(x: unknown): Promise<unknown> }> }).__tools
        for (let i = 0; i < 149; i++) await tools.create_diagram.execute({ title: `Diagram ${String(i).padStart(3, "0")}`, open: false })
        await tools.create_diagram.execute({ title: "Login flow", open: false })
      })
      await page.evaluate(() => (location.hash = "/?sort=title"))
      const cards = page.locator("[data-card-id]")
      await expect(cards).toHaveCount(151) // and the welcome diagram
      const top = () => page.evaluate((phone) => (phone ? scrollY : document.querySelector(".eos-library-scroller")!.scrollTop), phone)
      const scrollTo = async (y: number) => {
        const scrolled = () =>
          page.evaluate(
            ([phone, y]) => {
              const el = phone ? document.scrollingElement! : document.querySelector(".eos-library-scroller")!
              el.scrollTo({ top: y })
              return el.scrollTop
            },
            [phone, y] as const
          )
        await expect.poll(scrolled).toBe(y)
        // The scroll event for getting there fires with the next frame; wait it out, so it's saved.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      }
      const search = page.getByRole("textbox", { name: "Search diagrams" }).locator("visible=true")
      return { page, cards, top, scrollTo, search }
    }

    test("a new search starts at the top, showing its best match, with the caret still in the search box", async ({ context }) => {
      const { cards, top, scrollTo, search } = await longLibrary(context)
      await scrollTo(3000)
      await search.click()
      await search.pressSequentially("Login flow")
      await expect(cards.first()).toContainText("Login flow")
      await expect.poll(top).toBe(0)
      // In view, below the search box (and the header it's in, which sticks to the top on phones).
      const below = await search.evaluate((el) => el.getBoundingClientRect().bottom)
      const card = (await cards.first().boundingBox())!
      expect(card.y).toBeGreaterThanOrEqual(below)
      expect(card.y + card.height).toBeLessThanOrEqual(viewport.height)
      await expect(search).toBeFocused()
      // Clearing the search is a new search too.
      await search.fill("Diagram")
      await expect(cards.filter({ hasText: "Login flow" })).toHaveCount(0)
      await scrollTo(2000)
      await search.fill("")
      await expect(cards).toHaveCount(151)
      await expect.poll(top).toBe(0)
    })

    test("back to a search returns to where its results were scrolled", async ({ context }) => {
      const { page, cards, top, scrollTo, search } = await longLibrary(context)
      await search.fill("Diagram")
      await expect(page).toHaveURL(/q=Diagram/)
      await expect(cards.filter({ hasText: "Login flow" })).toHaveCount(0)
      await scrollTo(1500)
      // Clicked where it sits: Playwright's own click would first scroll it into view.
      const shown = await cards.evaluateAll((all) => all.findIndex((c) => c.getBoundingClientRect().top > 200))
      await cards.nth(shown).evaluate((a: HTMLElement) => a.click())
      await page.locator(".cm-content").waitFor()
      await page.goBack()
      await expect(cards.filter({ hasText: "Diagram 148" })).toHaveCount(1)
      await page.waitForTimeout(300)
      expect(await top()).toBe(1500)
    })
  })
}

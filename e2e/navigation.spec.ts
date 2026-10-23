import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import { focusNext, tool, withAgentTools } from "./helpers"

/** Waits out the frame after a search's results show, in which a phone puts the position back again while typing. */
const searchScrolled = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

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
  // Past any scroll still to come, so a position that holds is the one kept.
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

test("crossing 768px puts the library's scroll position in the scroller it moves to, and back", async ({ context }) => {
  const { page, cards, scrollTo, settledTop } = await library(context, "/?sort=title")
  await expect(cards.first()).toContainText("Diagram 0")
  await scrollTo(400)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(400)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect.poll(() => page.locator(".eos-library-scroller").evaluate((el) => el.scrollTop)).toBe(400)
  expect(await settledTop()).toBe(400)
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

// Going back or forward swaps the page, so focus goes to its heading; the button, now with nowhere to go, still takes focus.
test("in-app Back or Forward with the keyboard focuses the page, and at the end of history the button keeps focus", async ({ page }) => {
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
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused()
    await expect(button).toBeDisabled()
    await button.focus()
    await page.keyboard.press("Enter") // nowhere to go
    await expect(button).toBeFocused()
    await expect(page).toHaveURL(url)
  }
})

for (const [size, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } })) {
  test.describe(`searching while scrolled, at ${size} width`, () => {
    test.use({ viewport })
    const phone = size === "phone"

    const numbered = (name: string, n: number, starred = false) =>
      Array.from({ length: n }, (_, i) => ({ title: `${name} ${String(i).padStart(3, "0")}`, starred }))

    /** By default 150 cards, sorted so "Login flow" comes last. Desktop scrolls the library's pane; phones scroll the page. */
    async function longLibrary(context: BrowserContext, diagrams = [...numbered("Diagram", 149), { title: "Login flow", starred: false }]) {
      await withAgentTools(context)
      const page = await context.newPage()
      await page.goto("/#/")
      await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
      await page.evaluate(async (diagrams) => {
        const tools = (window as unknown as { __tools: Record<string, { execute(x: unknown): Promise<unknown> }> }).__tools
        for (const d of diagrams) await tools.create_diagram.execute({ ...d, open: false })
      }, diagrams)
      await page.evaluate(() => (location.hash = "/?sort=title"))
      const cards = page.locator("[data-card-id]")
      await expect(cards).toHaveCount(diagrams.length + 1) // and the welcome diagram
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

    test("a search typed while scrolled stays at the top once its results show", async ({ context }) => {
      const { page, cards, top, scrollTo, search } = await longLibrary(context)
      await search.fill("Diagram")
      await expect(cards).toHaveCount(149)
      await searchScrolled(page)
      await scrollTo(2000)
      await search.fill("")
      await expect(cards).toHaveCount(151)
      // Past the frame in which anything else could still move the page.
      await page.waitForTimeout(300)
      expect(await top()).toBe(0)
    })

    test("back to a search returns to where its results were scrolled", async ({ context }) => {
      const { page, cards, top, scrollTo, search } = await longLibrary(context)
      await search.fill("Diagram")
      await expect(page).toHaveURL(/q=Diagram/)
      await expect(cards.filter({ hasText: "Login flow" })).toHaveCount(0)
      await searchScrolled(page)
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

    test("back to a search from a view without one returns to where its results were scrolled", async ({ context }) => {
      const { page, cards, top, scrollTo, search } = await longLibrary(context)
      await search.fill("Diagram")
      await expect(page).toHaveURL(/q=Diagram/)
      await expect(cards.filter({ hasText: "Login flow" })).toHaveCount(0)
      await searchScrolled(page)
      await scrollTo(1500)
      if (phone) await page.getByRole("button", { name: "Show sidebar" }).click()
      await page.getByRole("link", { name: /^Starred/ }).click()
      await expect(page).not.toHaveURL(/q=/)
      await page.goBack()
      await expect(cards.filter({ hasText: "Diagram 148" })).toHaveCount(1)
      await page.waitForTimeout(300)
      expect(await top()).toBe(1500)
    })

    test("back and forward between two searches return to where each one's results were scrolled", async ({ context }) => {
      const { page, cards, top, scrollTo, search } = await longLibrary(context)
      await search.fill("Diagram")
      await expect(page).toHaveURL(/q=Diagram/)
      await expect(cards.filter({ hasText: "Login flow" })).toHaveCount(0)
      await searchScrolled(page)
      await scrollTo(1500)
      await page.evaluate(() => (location.hash = "/?sort=title&q=Diagram+0"))
      await expect(search).toHaveValue("Diagram 0")
      await expect.poll(top).toBe(0)
      await scrollTo(800)
      await page.goBack()
      await expect(search).toHaveValue("Diagram")
      await page.waitForTimeout(300)
      expect(await top()).toBe(1500)
      await page.goForward()
      await expect(search).toHaveValue("Diagram 0")
      await page.waitForTimeout(300)
      expect(await top()).toBe(800)
    })

    test("reload returns to where a search's results were scrolled", async ({ context }) => {
      const { page, cards, top, scrollTo, search } = await longLibrary(context)
      await search.fill("Diagram")
      await expect(page).toHaveURL(/q=Diagram/)
      await expect(cards.filter({ hasText: "Login flow" })).toHaveCount(0)
      await searchScrolled(page)
      await scrollTo(1500)
      await page.reload()
      await expect(search).toHaveValue("Diagram")
      await expect(cards.filter({ hasText: "Diagram 148" })).toHaveCount(1)
      await page.waitForTimeout(300)
      expect(await top()).toBe(1500)
    })

    test("changes from another tab leave the library where it was scrolled", async ({ context }) => {
      const { page, cards, top, scrollTo } = await longLibrary(context)
      await scrollTo(1500)
      const other = await context.newPage()
      await other.goto("/#/")
      await other.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
      const { id } = await tool<{ id: string }>(other, "create_diagram", { title: "Zebra", open: false })
      await expect(cards).toHaveCount(152)
      expect(await top()).toBe(1500)
      await tool(other, "update_diagram", { id, starred: true })
      await expect(cards.filter({ hasText: "Zebra" }).locator(".lucide-star")).toHaveCount(1)
      expect(await top()).toBe(1500)
      await other.locator(`[data-card-id="${id}"]`).click({ button: "right" })
      await other.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
      await other.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
      await expect(cards).toHaveCount(151)
      await page.waitForTimeout(300)
      expect(await top()).toBe(1500)
    })

    test("a search typed right after going back to one whose position no longer fits starts at the top", async ({ context }) => {
      const { page, cards, top, scrollTo, search } = await longLibrary(context)
      await search.fill("Diagram")
      await expect(page).toHaveURL(/q=Diagram/)
      await expect(cards.filter({ hasText: "Login flow" })).toHaveCount(0)
      await searchScrolled(page)
      await scrollTo(3000)
      await page.evaluate(() => (location.hash = "/?starred=1"))
      await expect(search).toHaveValue("")
      // All but five of its results renamed while away, so its position no longer fits.
      await page.evaluate(async () => {
        const tools = (window as unknown as { __tools: Record<string, { execute(x: unknown): Promise<unknown> }> }).__tools
        const { diagrams } = (await tools.get_library.execute({})) as { diagrams: { id: string; title: string }[] }
        for (const d of diagrams.filter((d) => /^Diagram (0(0[5-9]|[1-9]\d)|1\d\d)$/.test(d.title)))
          await tools.update_diagram.execute({ id: d.id, title: d.title.replace("Diagram", "Other") })
      })
      await page.goBack()
      await expect(cards).toHaveCount(5)
      await search.selectText()
      await search.pressSequentially("Other")
      await expect(cards).toHaveCount(144)
      await page.waitForTimeout(300)
      expect(await top()).toBe(0)
    })

    test("back and forward between a search and Starred return to where each was scrolled", async ({ context }) => {
      // Nothing starred matches the search, so neither view's rows hold the other's position.
      const { page, cards, top, scrollTo, search } = await longLibrary(context, [...numbered("Alpha", 120), ...numbered("Beta", 120, true)])
      await search.fill("Alpha")
      await expect(page).toHaveURL(/q=Alpha/)
      await expect(cards.filter({ hasText: "Beta" })).toHaveCount(0)
      await searchScrolled(page)
      await scrollTo(600)
      if (phone) await page.getByRole("button", { name: "Show sidebar" }).click()
      await page.getByRole("link", { name: /^Starred/ }).click()
      await expect(cards.filter({ hasText: "Alpha" })).toHaveCount(0)
      await scrollTo(3000)
      for (let i = 0; i < 2; i++) {
        await page.goBack()
        await expect(search).toHaveValue("Alpha")
        await page.waitForTimeout(300)
        expect(await top()).toBe(600)
        await page.goForward()
        await expect(search).toHaveValue("")
        await page.waitForTimeout(300)
        expect(await top()).toBe(3000)
      }
    })
  })
}

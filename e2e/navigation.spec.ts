import { expect, test, type BrowserContext } from "@playwright/test"

import { tool, withAgentTools } from "./helpers"

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
  await scrollTo(600)
  expect((await sort.boundingBox())!.y).toBe(before)
})

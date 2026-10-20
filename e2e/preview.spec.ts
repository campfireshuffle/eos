import { expect, test, type Page } from "@playwright/test"

import { cursorAtEndOf, newDiagram, openEditor, storedText, tool, withAgentTools } from "./helpers"

test.use({ viewport: { width: 1280, height: 860 } })

/** A left-to-right flowchart of `nodes` nodes, starting from the two in the report. */
const chain = (nodes: number) =>
  [
    "flowchart LR",
    "  user([Request]) --> n1[Edge]",
    ...Array.from({ length: nodes - 2 }, (_, i) => `  n${i + 1} --> n${i + 2}[Step ${i + 2}]`),
  ].join("\n")

const zoom = async (page: Page) => (await tool<{ view: { zoom: number } }>(page, "get_view")).view.zoom

/** Where the diagram sits relative to the preview pane. */
const placement = (page: Page) =>
  page.locator(".pele-preview svg").evaluate((svg) => {
    const s = svg.getBoundingClientRect()
    // The pane is the preview's scroll container.
    let pane = svg.closest(".pele-preview")!.parentElement!
    while (getComputedStyle(pane).overflowY !== "auto") pane = pane.parentElement!
    const p = pane.getBoundingClientRect()
    const [cx, cy] = [p.left + p.width / 2, p.top + p.height / 2]
    return {
      inside: s.left >= p.left && s.top >= p.top && s.right <= p.right && s.bottom <= p.bottom,
      overCentre: s.left <= cx && cx <= s.right && s.top <= cy && cy <= s.bottom,
    }
  })

/** Opens a two-node diagram (fitted at 200%) and returns a function that grows it to nine nodes, as an agent would. */
async function opened(page: Page) {
  const id = await newDiagram(page, chain(2))
  await openEditor(page, id)
  await expect.poll(() => zoom(page)).toBe(2)
  return async () => {
    for (const n of [4, 6, 8, 9]) await tool(page, "update_diagram", { id, source: chain(n) })
  }
}

test("an untouched preview keeps fitting the diagram as it grows", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const grow = await opened(page)
  await grow()
  await expect.poll(() => zoom(page)).toBeLessThan(2)
  await expect.poll(async () => (await placement(page)).inside).toBe(true)
})

test("a zoomed preview keeps its zoom, and the part of the diagram in view, as it grows", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const grow = await opened(page)
  await tool(page, "set_view", { zoom: "out" })
  await expect.poll(() => zoom(page)).toBeCloseTo(1.6)
  await grow()
  await expect.poll(() => zoom(page)).toBeCloseTo(1.6)
  // What was in the middle of the pane (the first two nodes) still is, rather than the diagram drifting off into a corner.
  await expect.poll(async () => (await placement(page)).overCentre).toBe(true)
})

test("typing into a fitted diagram never zooms it in", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  // Wide enough that the fit is limited by the pane's width, not the 200% cap.
  const id = await newDiagram(page, "flowchart LR\n  A --> B --> C --> D --> E --> F")
  await openEditor(page, id)
  await expect.poll(() => zoom(page)).toBeLessThan(2)
  const start = await zoom(page)
  await cursorAtEndOf(page, 1)
  await page.keyboard.press("Enter")
  // Half-typed lines briefly add nodes (X, then B) or drop them again; none of that should zoom the preview back in.
  const seen: number[] = []
  for (const key of "X --> B1") {
    await page.keyboard.press(key === " " ? "Space" : key)
    seen.push(await zoom(page))
  }
  expect(Math.max(...seen)).toBeLessThanOrEqual(start)
  await expect.poll(async () => (await placement(page)).inside).toBe(true)
})

test("after a click on the preview, its shortcuts and Space go to it rather than into the source", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const source = chain(2)
  const id = await newDiagram(page, source)
  await openEditor(page, id)
  await expect.poll(() => zoom(page)).toBe(2)
  // Focus starts in the editor, where a click on the preview used to leave it.
  await cursorAtEndOf(page, 1)
  await page.locator(".pele-preview").click()
  await page.keyboard.press("Shift+Digit0")
  await expect.poll(() => zoom(page)).toBe(1)
  await page.keyboard.press("Shift+Digit1")
  await expect.poll(() => zoom(page)).toBe(2)
  await page.keyboard.press("Space")
  // Keys are handled in order, so once this one has zoomed the preview, a typed space would be saved by now.
  await page.keyboard.press("Shift+Digit0")
  await expect.poll(() => zoom(page)).toBe(1)
  expect(await storedText(page, id)).toBe(source)
})

test("an edge label is backed, so its line doesn't strike through it", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart TD\n  A -->|yes| B")
  await openEditor(page, id)
  const backing = page.locator(".pele-preview svg .pele-edge-label rect")
  await expect(backing).toHaveCount(1)
  expect(await backing.evaluate((rect) => getComputedStyle(rect).fill)).not.toMatch(/^(rgba\(0, 0, 0, 0\)|transparent|none)$/)
})

test("zooming only scales the diagram, even once it overflows the pane", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(
    page,
    "sequenceDiagram\n  User->>App: Place order\n  App->>Payments: Create charge\n  Payments-->>App: Charge succeeded\n  App-->>User: Order confirmed"
  )
  await openEditor(page, id)
  const svg = page.locator(".pele-preview svg").first()
  await expect(svg).toBeVisible()
  // A re-layout replaces the SVG, so a mark on it shows the layout was kept.
  await svg.evaluate((el) => el.setAttribute("data-probe", ""))
  // Zoom in until the diagram is far wider than the pane, past the re-layout delay. Where scrollbars take
  // up room (WebKit here; macOS with "always show scrollbars"), the pane's inner width then shrinks.
  for (let i = 0; i < 6; i++) await tool(page, "set_view", { zoom: "in" })
  await page.waitForTimeout(500)
  await expect(page.locator(".pele-preview svg[data-probe]")).toHaveCount(1)
})

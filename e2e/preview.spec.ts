import { expect, test, type Page } from "@playwright/test"

import { cursorAtEndOf, focusNext, newDiagram, openEditor, storedText, tool, withAgentTools } from "./helpers"

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
    const p = svg.closest("[data-preview-frame]")!.getBoundingClientRect()
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

test("a slightly shaky click or a wheel tick doesn't stop a fitted preview fitting", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const grow = await opened(page)
  const pane = (await page.locator("[data-preview-frame]").boundingBox())!
  const [x, y] = [pane.x + pane.width / 2, pane.y + pane.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 2, y + 1)
  await page.mouse.up()
  await page.mouse.wheel(0, 100)
  await grow()
  await expect.poll(() => zoom(page)).toBeLessThan(2)
  await expect.poll(async () => (await placement(page)).inside).toBe(true)
})

test("the preview can be reached with Tab and panned with the arrow keys", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await opened(page)
  for (let i = 0; i < 4; i++) await tool(page, "set_view", { zoom: "in" })
  await page.getByRole("button", { name: "Export" }).focus()
  await focusNext(page)
  const preview = page.getByRole("group", { name: "Diagram preview" })
  await expect(preview).toBeFocused()
  const left = () => page.locator(".pele-preview svg").evaluate((svg) => svg.getBoundingClientRect().left)
  const before = await left()
  await page.keyboard.press("ArrowRight")
  await expect.poll(left).toBeCloseTo(before - 40, 0)
  // A click doesn't leave focus on it, so shortcuts and Space still go to the page.
  await preview.click()
  await expect(preview).not.toBeFocused()
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

const sequence =
  "sequenceDiagram\n  User->>App: Place order\n  App->>Payments: Create charge\n  Payments-->>App: Charge succeeded\n  App-->>User: Order confirmed"

test("pinch zoom keeps the point under the pointer still, even as the diagram outgrows the pane", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, sequence)
  await openEditor(page, id)
  const svg = page.locator(".pele-preview svg").first()
  await expect(svg).toBeVisible()
  await tool(page, "set_view", { zoom: "actual" })
  await expect.poll(() => zoom(page)).toBe(1)
  // The diagram's position and scale on screen.
  const at = () =>
    svg.evaluate((el: SVGSVGElement) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, scale: r.width / el.viewBox.baseVal.width }
    })
  const frame = (await page.locator("[data-preview-frame]").boundingBox())!
  const [px, py] = [frame.x + frame.width / 2, frame.y + 60]
  await page.mouse.move(px, py)
  await page.keyboard.down("Control")
  // Small trackpad-pinch steps in to about 170%, back out to about 110%, and in again.
  const steps = [...Array(19).fill(-4), ...Array(15).fill(4), ...Array(14).fill(-4)]
  const drift: number[] = []
  for (const dy of steps) {
    const before = await at()
    const [nx, ny] = [(px - before.left) / before.scale, (py - before.top) / before.scale]
    await page.mouse.wheel(0, dy)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const after = await at()
    drift.push(Math.hypot(after.left + nx * after.scale - px, after.top + ny * after.scale - py))
  }
  await page.keyboard.up("Control")
  expect(await zoom(page)).toBeGreaterThan(1.6)
  expect(Math.max(...drift)).toBeLessThanOrEqual(1)
})

test("zooming only scales the diagram, even once it overflows the pane", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, sequence)
  await openEditor(page, id)
  const svg = page.locator(".pele-preview svg").first()
  await expect(svg).toBeVisible()
  // A re-layout replaces the SVG, so a mark on it shows the layout was kept.
  await svg.evaluate((el) => el.setAttribute("data-probe", ""))
  // Zoom in until the diagram is far wider than the pane, and wait past the re-layout delay. The pane never
  // scrolls, so zooming mustn't change the width Pele lays the diagram out to.
  for (let i = 0; i < 6; i++) await tool(page, "set_view", { zoom: "in" })
  await page.waitForTimeout(500)
  await expect(page.locator(".pele-preview svg[data-probe]")).toHaveCount(1)
})

test("a slightly shaky click doesn't pan a zoomed preview either", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await opened(page)
  for (let i = 0; i < 4; i++) await tool(page, "set_view", { zoom: "in" })
  const left = () => page.locator(".pele-preview svg").evaluate((svg) => svg.getBoundingClientRect().left)
  const before = await left()
  const pane = (await page.locator("[data-preview-frame]").boundingBox())!
  const [x, y] = [pane.x + pane.width / 2, pane.y + pane.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 2, y + 1)
  await page.mouse.up()
  await page.waitForTimeout(300)
  expect(await left()).toBe(before)
})

test("a zoomed preview is laid out at its zoom once it settles, not stretched", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await opened(page)
  for (let i = 0; i < 4; i++) await tool(page, "set_view", { zoom: "in" })
  // While the view moves the stage scales the SVG; at rest it's drawn at the size it's shown, so the browser draws it sharp.
  await expect
    .poll(() =>
      page
        .locator(".pele-preview svg")
        .evaluate((svg) => Math.abs(svg.getBoundingClientRect().width - (svg.parentElement as HTMLElement).offsetWidth))
    )
    .toBeLessThan(1)
})

/** The preview's cursor. */
const cursor = (page: Page) => page.locator("[data-preview-frame]").evaluate((el) => getComputedStyle(el).cursor)

/**
 * Zooms the sequence diagram in, pans it to its right-hand end, then pinches out with the pointer near the
 * pane's left edge. That leaves it smaller than the pane but mostly off its left edge.
 */
async function strandedByZoom(page: Page) {
  const id = await newDiagram(page, sequence)
  await openEditor(page, id)
  await expect(page.locator(".pele-preview svg")).toBeVisible()
  for (let i = 0; i < 4; i++) await tool(page, "set_view", { zoom: "in" })
  await page.locator("[data-preview-frame]").focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight")
  const pane = (await page.locator("[data-preview-frame]").boundingBox())!
  await page.mouse.move(pane.x + 20, pane.y + pane.height / 2)
  await page.keyboard.down("Control")
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 20)
  await page.keyboard.up("Control")
  await expect.poll(() => zoom(page)).toBeLessThan(1)
  expect((await placement(page)).inside).toBe(false)
  await expect.poll(() => cursor(page)).toBe("grab")
  return pane
}

test("a diagram zoomed out near the pane's edge can be dragged back into view", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const pane = await strandedByZoom(page)
  const y = pane.y + pane.height / 2
  await page.mouse.move(pane.x + 100, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(pane.x + 100 + i * 35, y)
  await page.mouse.up()
  await expect.poll(async () => (await placement(page)).inside).toBe(true)
  // Once it's all in view, a pan has nothing to move.
  await expect.poll(() => cursor(page)).toBe("default")
})

test("a diagram zoomed out near the pane's edge can be swiped back into view", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const pane = await strandedByZoom(page)
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
  for (let i = 0; i < 10; i++) await page.mouse.wheel(-60, 0)
  await expect.poll(async () => (await placement(page)).inside).toBe(true)
})

test("a diagram zoomed out near the pane's edge can be brought back into view with the arrow keys", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await strandedByZoom(page)
  await page.locator("[data-preview-frame]").focus()
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft")
  await expect.poll(async () => (await placement(page)).inside).toBe(true)
})

test("a diagram an agent shrinks while it's panned can be brought back into view with the arrow keys", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, chain(10))
  await openEditor(page, id)
  await expect(page.locator(".pele-preview svg")).toBeVisible()
  await tool(page, "set_view", { zoom: "actual" })
  await expect.poll(() => zoom(page)).toBe(1)
  const preview = page.locator("[data-preview-frame]")
  await preview.focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight")
  await tool(page, "update_diagram", { id, source: chain(2) })
  await expect.poll(async () => (await placement(page)).inside).toBe(false)
  // Each arrow key moves it only towards being in view, so pressing them all brings it in on both axes.
  for (let i = 0; i < 20; i++) for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) await page.keyboard.press(key)
  await expect.poll(async () => (await placement(page)).inside).toBe(true)
})

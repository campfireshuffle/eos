import { expect, test, type Page } from "@playwright/test"

import { newDiagram, openEditor, tool, withAgentTools } from "./helpers"

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
    const p = svg.closest(".overflow-auto")!.getBoundingClientRect()
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
  expect(await zoom(page)).toBeCloseTo(1.6)
  // What was in the middle of the pane (the first two nodes) still is, rather than the diagram drifting off into a corner.
  await expect.poll(async () => (await placement(page)).overCentre).toBe(true)
})

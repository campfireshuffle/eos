import { expect, test, type Page } from "@playwright/test"

import { expectEditor, newDiagram, openEditor, tool, withAgentTools } from "./helpers"

const SOURCE = "flowchart TD\n  A --> B"

test.beforeEach(async ({ context }) => {
  await withAgentTools(context)
})

const size = async (page: Page, id: string, axis: "width" | "height") => (await page.locator(`[data-panel]#${id}`).boundingBox())![axis]

for (const { viewport, axis } of [
  { viewport: { width: 1280, height: 800 }, axis: "width" as const },
  { viewport: { width: 390, height: 844 }, axis: "height" as const },
]) {
  test(`at ${viewport.width}×${viewport.height} hiding the source gives the preview its ${axis}, and showing it brings back the split`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await openEditor(page, await newDiagram(page, SOURCE))
    const editor = page.getByRole("textbox", { name: "Mermaid source" })
    const before = { source: await size(page, "source", axis), preview: await size(page, "preview", axis) }

    const hide = page.getByRole("button", { name: "Hide source" })
    await expect(hide).toHaveAttribute("aria-expanded", "true")
    await expect(hide).toHaveAttribute("aria-controls", "source")
    await hide.click()
    const show = page.getByRole("button", { name: "Show source" })
    await expect(show).toHaveAttribute("aria-expanded", "false")
    await expect(show).toHaveAttribute("aria-controls", "source")
    // Desktop: the preview takes the whole width. Phone: the source keeps just its header bar.
    await expect.poll(() => size(page, "source", axis)).toBe(axis === "width" ? 0 : 48)
    expect(await size(page, "preview", axis)).toBeGreaterThan(before.preview + before.source - 50)
    // Still mounted, just out of reach.
    await expect(page.locator(".cm-content")).toHaveCount(1)
    await expect(editor).not.toBeInViewport()

    await show.click()
    await expect(hide).toHaveAttribute("aria-expanded", "true")
    await expect.poll(() => size(page, "source", axis)).toBeCloseTo(before.source, 0)
    expect(await size(page, "preview", axis)).toBeCloseTo(before.preview, 0)

    await editor.click()
    await page.keyboard.press("ControlOrMeta+End")
    await page.keyboard.type("\nB --> C")
    await expectEditor(page, `${SOURCE}\n  B --> C`)
  })
}

test("the toggle works from the keyboard, focus stays on it, and nothing hidden is a Tab stop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openEditor(page, await newDiagram(page, SOURCE))
  await page.getByRole("button", { name: "Hide source" }).focus()
  await page.keyboard.press("Enter")
  const show = page.getByRole("button", { name: "Show source" })
  await expect(show).toBeFocused()
  for (const key of ["Shift+Tab", "Shift+Tab", "Tab", "Tab", "Tab"]) {
    await page.keyboard.press(key)
    expect(await page.evaluate(() => document.getElementById("source")!.contains(document.activeElement))).toBe(false)
  }
  await show.focus()
  await page.keyboard.press("Space")
  await expect(page.getByRole("button", { name: "Hide source" })).toBeFocused()

  // On a phone too: showing the source doesn't put focus in the editor, which would raise the keyboard.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Hide source" }).focus()
  await page.keyboard.press("Enter")
  await expect(show).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Hide source" })).toBeFocused()
  await expect(page.getByRole("textbox", { name: "Mermaid source" })).not.toBeFocused()
})

test("an agent's edit made while the source is hidden is there when it's shown", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const id = await newDiagram(page, SOURCE)
  await openEditor(page, id)
  await page.getByRole("button", { name: "Hide source" }).click()
  await tool(page, "update_diagram", { id, source: "flowchart TD\n  A --> Z" })
  await expect(page.locator("#preview svg").getByText("Z", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Show source" }).click()
  await expectEditor(page, "flowchart TD\n  A --> Z")
})

test("the source stays hidden after a reload, and across the switch to the stacked layout and back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openEditor(page, await newDiagram(page, SOURCE))
  await page.getByRole("button", { name: "Hide source" }).click()
  await expect.poll(() => size(page, "source", "width")).toBe(0)
  await page.reload()
  await page.locator(".cm-content").waitFor({ state: "attached" })
  await expect(page.getByRole("button", { name: "Show source" })).toBeVisible()
  expect(await size(page, "source", "width")).toBe(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => size(page, "source", "height")).toBe(48)
  await expect(page.getByRole("button", { name: "Show source" })).toHaveAttribute("aria-expanded", "false")
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(() => size(page, "source", "width")).toBe(0)
  await page.getByRole("button", { name: "Show source" }).click()
  await expect.poll(() => size(page, "source", "width")).toBeGreaterThan(0)
  await expectEditor(page, SOURCE)
})

test("after a reload, showing the source brings back the split it had before it was hidden", async ({ page }) => {
  test.fail(true, "react-resizable-panels keeps the size to expand to only in memory: campfireshuffle/eos#24")
  await page.setViewportSize({ width: 1280, height: 800 })
  await openEditor(page, await newDiagram(page, SOURCE))
  const before = await size(page, "source", "width")
  await page.getByRole("button", { name: "Hide source" }).click()
  await expect.poll(() => size(page, "source", "width")).toBe(0)
  await page.reload()
  await page.getByRole("button", { name: "Show source" }).click()
  await expect.poll(() => size(page, "source", "width"), { timeout: 2000 }).toBeCloseTo(before, 0)
})

test("dragging the splitter to the edge hides the source", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openEditor(page, await newDiagram(page, SOURCE))
  const handle = (await page.getByRole("separator").last().boundingBox())!
  const source = (await page.locator("[data-panel]#source").boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + 10, handle.y + handle.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => size(page, "source", "width")).toBe(0)
  await expect(page.getByRole("button", { name: "Show source" })).toHaveAttribute("aria-expanded", "false")
})

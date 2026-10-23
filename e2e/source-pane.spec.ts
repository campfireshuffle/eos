import { expect, test, type Page } from "@playwright/test"

import { cursorAtEndOf, expectEditor, newDiagram, openEditor, tool, withAgentTools } from "./helpers"

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

/** Records each time the editor's panel group starts ("on") and stops ("off") animating. */
async function watchAnimating(page: Page) {
  await page.evaluate(() => {
    const group = document.getElementById("source")!.parentElement!
    const seen: string[] = []
    Object.assign(window, { __animating: seen })
    new MutationObserver(() => seen.push(group.hasAttribute("data-animating") ? "on" : "off")).observe(group, {
      attributes: true,
      attributeFilter: ["data-animating"],
    })
  })
  return () => page.evaluate(() => (window as unknown as { __animating: string[] }).__animating)
}

test("dragging the splitter to the edge hides the source, without animating", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openEditor(page, await newDiagram(page, SOURCE))
  const animating = await watchAnimating(page)
  const handle = (await page.getByRole("separator").last().boundingBox())!
  const source = (await page.locator("[data-panel]#source").boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + 10, handle.y + handle.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => size(page, "source", "width")).toBe(0)
  await expect(page.getByRole("button", { name: "Show source" })).toHaveAttribute("aria-expanded", "false")
  expect(await animating()).toEqual([])
})

test("the toggle animates hiding and showing the source, as the sidebar's does, and only while it does", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openEditor(page, await newDiagram(page, SOURCE))
  const animating = await watchAnimating(page)
  await page.getByRole("button", { name: "Hide source" }).click()
  await expect.poll(animating).toEqual(["on", "off"])
  expect(await size(page, "source", "width")).toBe(0)
  await page.getByRole("button", { name: "Show source" }).click()
  await expect.poll(animating).toEqual(["on", "off", "on", "off"])
  expect(await size(page, "source", "width")).toBeGreaterThan(0)

  // Not across 768px, nor after a reload.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setViewportSize({ width: 1280, height: 800 })
  expect(await animating()).toHaveLength(4)
  await page.reload()
  await page.locator(".cm-content").waitFor()
  expect(await page.locator("[data-animating]").count()).toBe(0)

  // With reduced motion, nothing moves.
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.getByRole("button", { name: "Hide source" }).click()
  expect(await page.locator("[data-panel]#source").evaluate((el) => el.getAnimations().length)).toBe(0)
  await expect(page.locator("[data-animating]")).toHaveCount(0)
})

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`at ${viewport.width}×${viewport.height} clicking Hide source with the caret in the editor leaves focus on the toggle`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await openEditor(page, await newDiagram(page, SOURCE))
    await cursorAtEndOf(page, 1)
    // Safari doesn't focus a button that's clicked, so focus would stay in the editor as it goes out of reach.
    await page.getByRole("button", { name: "Hide source" }).click()
    await expect(page.getByRole("button", { name: "Show source" })).toBeFocused()
  })
}

test("an agent showing a past version, and then the latest, never leaves focus on the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const id = await newDiagram(page, SOURCE)
  await tool(page, "update_diagram", { id, source: "flowchart TD\n  A --> C" })
  await openEditor(page, id)
  const { history } = await tool<{ history: { version: string }[] }>(page, "get_diagram", { id, history: true })
  const editor = page.getByRole("textbox", { name: "Mermaid source" })
  const banner = page.getByText("Viewing the version from")

  // From the live editor, which the past version hides.
  await cursorAtEndOf(page, 1)
  await tool(page, "set_view", { diagramId: id, previewVersion: history.at(-1)!.version })
  await expect(banner).toBeVisible()
  await expect(page.getByRole("button", { name: "Hide source" })).toBeFocused()

  // From the banner's button, which goes with it: back to the live editor.
  await page.getByRole("button", { name: "Back to latest" }).focus()
  await tool(page, "set_view", { diagramId: id, previewVersion: "latest" })
  await expect(banner).toHaveCount(0)
  await expect(editor).toBeFocused()
  await expect(editor).not.toHaveAttribute("aria-readonly", "true")

  // From the past version's editor, which goes too.
  await tool(page, "set_view", { diagramId: id, previewVersion: history.at(-1)!.version })
  await expect(editor).toHaveAttribute("aria-readonly", "true")
  await editor.focus()
  await tool(page, "set_view", { diagramId: id, previewVersion: "latest" })
  await expect(banner).toHaveCount(0)
  await expect(editor).toBeFocused()
  await expect(editor).not.toHaveAttribute("aria-readonly", "true")
})

// Whether the live source can take focus is one thing, read by everything that moves focus or hides it: nothing sends
// focus into the source while it's hidden, and nothing leaves it on the page itself.

for (const name of ["Back to latest", "Restore this version"]) {
  test(`with the source hidden, ${name} leaves focus on the source toggle`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    // A version from an earlier day, so the edit below is a version of its own.
    const now = Date.now()
    await page.clock.setSystemTime(now - 86_400_000)
    const id = await newDiagram(page, SOURCE)
    await page.clock.setSystemTime(now)
    await openEditor(page, id)
    await cursorAtEndOf(page, 1)
    await page.keyboard.type(" --> C")
    await expect.poll(async () => (await tool<{ history: unknown[] }>(page, "get_diagram", { id, history: true })).history.length).toBe(2)
    await page.getByRole("button", { name: "Version history" }).click()
    await page.locator("[data-slot=popover-content] button").last().click()
    await expect(page.getByText("Viewing the version from")).toBeVisible()
    await page.getByRole("button", { name: "Hide source" }).click()
    await expect.poll(() => size(page, "source", "width")).toBe(0)

    await page.getByRole("button", { name }).focus()
    await page.keyboard.press("Enter")
    await expect(page.getByText("Viewing the version from")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Show source" })).toBeFocused()
  })
}

test("crossing 768px with the source toggle focused keeps focus on the same toggle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openEditor(page, await newDiagram(page, SOURCE))
  const toggle = page.locator("button[aria-controls=source]")
  await toggle.evaluate((el) => (el.dataset.mark = "1"))
  for (const collapse of [false, true]) {
    await toggle.focus()
    if (collapse) await page.keyboard.press("Enter")
    for (const width of [390, 1280, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(page.locator("button[aria-controls=source][data-mark]")).toBeFocused()
      await expect(toggle).toHaveAttribute("aria-expanded", String(!collapse))
    }
  }
})

test("widening past 768px with focus in the hidden source's header bar moves focus to the toggle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(page, await newDiagram(page, SOURCE))
  await page.getByRole("button", { name: "Hide source" }).click()
  // On a phone the hidden source keeps its header bar, and its buttons work.
  await page.getByRole("button", { name: "Copy source" }).focus()
  await expect(page.getByRole("button", { name: "Copy source" })).toBeFocused()
  // On desktop the whole pane is out of reach.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(() => size(page, "source", "width")).toBe(0)
  await expect(page.getByRole("button", { name: "Show source" })).toBeFocused()
})

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`at ${viewport.width}×${viewport.height} with the source hidden, whether it's valid is still announced`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const id = await newDiagram(page, SOURCE)
    await openEditor(page, id)
    const status = page.locator("[role=status]")
    await expect(status).toHaveText("Valid")
    await page.getByRole("button", { name: "Hide source" }).click()
    await expect(page.getByRole("button", { name: "Show source" })).toHaveAttribute("aria-expanded", "false")
    await tool(page, "update_diagram", { id, source: "flowchart TD\n  A -->" })
    await expect(status).toContainText("Line 2")
    // Not in a part of the page that's out of reach, where screen readers don't follow it.
    expect(await status.evaluate((el) => el.closest("[inert], [hidden], [aria-hidden=true]") === null)).toBe(true)
  })
}

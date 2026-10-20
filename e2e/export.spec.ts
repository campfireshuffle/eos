import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"

import { expect, test, type Page } from "@playwright/test"

import { cursorAtEndOf, focusNext, newDiagram, openEditor, tool, withAgentTools } from "./helpers"

/** Downloads `item` from the Export menu and returns the file's text. */
async function exported(page: Page, item: string) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByRole("button", { name: "Export" }).click()
      await page.getByRole("menuitem", { name: item }).click()
    })(),
  ])
  return readFile(await file.path(), "utf8")
}

test("a diagram too big for a share link says so instead of copying nothing", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  // Random text barely compresses, so this is well past what fits in a link.
  const id = await newDiagram(page, `flowchart TD\n  %% ${randomBytes(40_000).toString("hex")}\n  A --> B`)
  await openEditor(page, id)
  await page.keyboard.press("ControlOrMeta+Shift+L")
  await expect(page.getByRole("alertdialog")).toContainText("This diagram is too large to share as a link.")
  await page.getByRole("button", { name: "OK" }).click()
  await expect(page.getByRole("alertdialog")).toBeHidden()

  await page.getByRole("button", { name: "Export" }).click()
  await page.getByRole("menuitem", { name: "Copy share link" }).click()
  await expect(page.getByRole("alertdialog")).toContainText("This diagram is too large to share as a link.")
})

test("while a past version is shown, the source export is of that version too", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const old = "flowchart LR\n  OLD1 --> OLD2"
  const id = await newDiagram(page, old)
  await openEditor(page, id)
  await cursorAtEndOf(page, 1)
  await page.keyboard.type(" --> NEW3")
  // The person's edit is listed apart from the agent's that created the diagram.
  const versions = async () =>
    (await tool<{ history: { version: string }[] }>(page, "get_diagram", { id, history: true })).history.map((h) => h.version)
  await expect.poll(async () => (await versions()).length).toBe(2)
  await tool(page, "set_view", { diagramId: id, previewVersion: (await versions()).at(-1) })
  await expect(page.getByText("Viewing the version from")).toBeVisible()
  await expect(page.locator(".pele-preview svg")).not.toContainText("NEW3")
  expect(await exported(page, "SVG .svg")).not.toContain("NEW3")
  expect(await exported(page, "Mermaid source .mmd")).toBe(old)
})

test("back from a past version, a broken source still shows the person's last good diagram", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  OLD1 --> OLD2")
  await openEditor(page, id)
  await cursorAtEndOf(page, 1)
  await page.keyboard.type(" --> NEW3")
  await expect(page.locator(".pele-preview svg")).toContainText("NEW3")
  // Break it, then look at the first version and come back.
  await page.keyboard.type(" -->")
  const versions = async () =>
    (await tool<{ history: { version: string }[] }>(page, "get_diagram", { id, history: true })).history.map((h) => h.version)
  await expect.poll(async () => (await versions()).length).toBe(2)
  await tool(page, "set_view", { diagramId: id, previewVersion: (await versions()).at(-1) })
  await expect(page.locator(".pele-preview svg")).not.toContainText("NEW3")
  await page.getByRole("button", { name: "Back to latest" }).click()
  await expect(page.locator(".pele-preview svg")).toContainText("NEW3")
  expect(await exported(page, "SVG .svg")).toContain("NEW3")
})

test("an exported SVG opens at the diagram's own size, whatever the preview's zoom", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  A --> B")
  await openEditor(page, id)
  // Two nodes fit the pane zoomed in.
  await expect.poll(async () => (await tool<{ view: { zoom: number } }>(page, "get_view")).view.zoom).toBeGreaterThan(1)
  const viewer = await context.newPage()
  await viewer.setContent(await exported(page, "SVG .svg"))
  const size = await viewer.locator("svg").evaluate((svg) => {
    const r = svg.getBoundingClientRect()
    return { shown: [r.width, r.height], own: [+svg.getAttribute("width")!, +svg.getAttribute("height")!] }
  })
  expect(size.shown).toEqual(size.own)
})

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" })

  test("an agent's SVG export inlines the theme, as the Export menu's does", async ({ context }) => {
    await withAgentTools(context)
    const page = await context.newPage()
    const id = await newDiagram(page, "flowchart LR\n  A --> B")
    await openEditor(page, id)
    await expect(page.locator("html")).toHaveClass(/dark/)
    // The colours inlined on the root <svg>, which override Pele's built-in fallbacks outside Eos.
    const colours = (svg: string) => {
      const style = /^<svg[^>]*\sstyle="([^"]*)"/.exec(svg)?.[1] ?? ""
      return Object.fromEntries([...style.matchAll(/(--pele-[\w-]+|background):([^;]+)/g)].map(([, k, v]) => [k, v.trim()]))
    }
    const agent = colours((await tool<{ data: string }>(page, "export", { id, format: "svg" })).data)
    expect(agent["--pele-fg"]).toBeTruthy()
    expect(agent["--pele-fg"]).not.toBe("#1f1f1f")
    expect(agent).toEqual(colours(await exported(page, "SVG .svg")))
  })
})

test("the Version history tooltip doesn't stay up after picking a version, but still shows on keyboard focus", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  const id = await newDiagram(page, "flowchart LR\n  OLD1 --> OLD2")
  await openEditor(page, id)
  await cursorAtEndOf(page, 1)
  await page.keyboard.type(" --> NEW3")
  await expect.poll(async () => (await tool<{ history: unknown[] }>(page, "get_diagram", { id, history: true })).history.length).toBe(2)
  const button = page.getByRole("button", { name: "Version history" })
  await button.click()
  await page.locator("[data-slot=popover-content] button").last().click()
  await expect(page.getByText("Viewing the version from")).toBeVisible()
  await page.mouse.move(5, 5)
  // "Never appears" needs a wait: longer than the tooltip's 400ms delay.
  await page.waitForTimeout(800)
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  // Focus from the keyboard still shows it.
  await page.keyboard.press("Escape")
  await button.focus()
  // Safari's Tab skips buttons; Option+Tab reaches them (see focusNext).
  const webkit = page.context().browser()?.browserType().name() === "webkit"
  await page.keyboard.press(webkit ? "Alt+Shift+Tab" : "Shift+Tab")
  await focusNext(page)
  await expect(page.getByRole("tooltip", { name: "Version history" })).toBeVisible()
})

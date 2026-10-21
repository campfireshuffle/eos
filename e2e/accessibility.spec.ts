import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"

import { focusNext, openEditor, tool, withAgentTools } from "./helpers"

const FLOWCHART = "flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|Yes| C[Ship]\n  B -->|No| A"

/** Runs axe against the page as it is now, at WCAG 2.2 A and AA. */
async function audit(page: Page, { menuOpen = false } = {}) {
  // Let open/close animations finish, so colours are measured at rest, however slow the machine.
  // Two frames first, so one that's about to start (a menu just opened) has.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity)
  )
  const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
  // A Radix menu is modal: it aria-hides the rest of the page and keeps focus inside itself until it closes,
  // so the hidden controls can't be reached; axe only sees that they're focusable.
  if (menuOpen) axe.disableRules(["aria-hidden-focus"])
  const { violations } = await axe.analyze()
  const summary = violations
    .map((v) => ({
      ...v,
      // CodeMirror's scroller holds a contenteditable, which Tab reaches; axe only counts tabindex and native controls.
      nodes: v.id === "scrollable-region-focusable" ? v.nodes.filter((n) => !String(n.target.at(-1)).endsWith(".cm-scroller")) : v.nodes,
    }))
    .filter((v) => v.nodes.length)
    .map((v) => `${v.id}: ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(" ")} ${n.failureSummary ?? ""}`).join("\n")}`)
  expect(summary).toEqual([])
}

/** A library with tagged, starred and broken diagrams. Returns the first diagram's id. */
async function library(page: Page) {
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const { id } = await tool<{ id: string }>(page, "create_diagram", {
    title: "Release flow",
    source: FLOWCHART,
    tags: ["work/backend"],
    starred: true,
    open: false,
  })
  await tool(page, "create_diagram", { title: "Sequence", source: "sequenceDiagram\n  A->>B: Hi", tags: ["personal"], open: false })
  await tool(page, "create_diagram", { title: "Broken", source: "flowchart TD\n  A -->", open: false })
  await tool(page, "update_tag", { path: "personal", emoji: "🏠" })
  await expect(page.locator("[data-card-id]", { hasText: "Broken" })).toBeVisible()
  return id
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme })

    test.beforeEach(async ({ context }) => {
      await withAgentTools(context)
    })

    test("library, tag filter, selection and its menus", async ({ page }) => {
      await library(page)
      await audit(page)

      await page
        .getByRole("treegrid", { name: "Tags" })
        .getByRole("row", { name: /work\/backend/ })
        .click()
      await expect(page).toHaveURL(/tag=work%2Fbackend|tag=work\/backend/)
      await audit(page)

      await page.goto("/#/")
      const cards = page.locator("[data-card-id]")
      await cards.nth(0).click({ button: "right" })
      await cards.nth(1).click()
      await expect(page.getByText("2 selected")).toBeVisible()
      await audit(page)

      await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).click()
      await expect(page.getByPlaceholder("Find or create a tag")).toBeFocused()
      await audit(page)
      await page.keyboard.press("Escape")

      await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
      await expect(page.getByRole("alertdialog")).toBeVisible()
      await audit(page)
    })

    test("tag menu and icon picker", async ({ page }) => {
      await library(page)
      await page.getByRole("row", { name: /personal/ }).click({ button: "right" })
      await expect(page.getByRole("button", { name: "Change icon", exact: true })).toBeVisible()
      await audit(page)
      await page.getByRole("button", { name: "Change icon", exact: true }).click()
      await expect(page.getByPlaceholder("Search emoji")).toBeFocused()
      await audit(page)
    })

    test("editor with valid and invalid source, its menus and a past version", async ({ page }) => {
      const id = await library(page)
      await openEditor(page, id)
      await expect(page.locator(".pele-preview svg")).toBeVisible()
      await audit(page)

      await page.getByRole("button", { name: "Export" }).click()
      await expect(page.getByRole("menu")).toBeVisible()
      await audit(page, { menuOpen: true })
      await page.keyboard.press("Escape")

      await page.getByRole("button", { name: /^Zoom/ }).click()
      await expect(page.getByRole("menu")).toBeVisible()
      await audit(page, { menuOpen: true })
      await page.keyboard.press("Escape")

      await tool(page, "update_diagram", { id, source: "flowchart TD\n  A[Start] -->" })
      await expect(page.getByText("Couldn’t render")).toBeVisible()
      await audit(page)

      await page.getByRole("button", { name: "Version history" }).click()
      await expect(page.getByText("· Current")).toBeVisible()
      await audit(page)
      await page.keyboard.press("Escape")
      const { history } = await tool<{ history: { version: string }[] }>(page, "get_diagram", { id, history: true })
      await tool(page, "set_view", { diagramId: id, previewVersion: history.at(-1)!.version })
      await expect(page.getByText("Viewing the version from")).toBeVisible()
      await audit(page)
    })

    test("settings, every section", async ({ page }) => {
      await library(page)
      await page.getByRole("button", { name: "Settings" }).click()
      const dialog = page.getByRole("dialog", { name: "Settings" })
      for (const section of ["Theming", "MCP", "Storage", "About"]) {
        await dialog.getByRole("button", { name: section, exact: true }).click()
        await expect(dialog.getByRole("heading", { name: section, exact: true })).toBeVisible()
        await audit(page)
      }
    })

    test("phone layout and navigation drawer", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await library(page)
      await audit(page)
      await page.getByRole("button", { name: "Show sidebar" }).click()
      await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible()
      await audit(page)
    })
  })
}

test.describe("keyboard", () => {
  test.beforeEach(async ({ context }) => {
    await withAgentTools(context)
  })

  test("cards are named by their title, and the selection bar is out of the tab order until something is selected", async ({ page }) => {
    await library(page)
    await expect(page.getByRole("link", { name: /^Release flow/ })).toBeVisible()
    const card = page.locator("[data-card-id]").last()
    await expect(card).toHaveAccessibleDescription(/^Press Space, right-click or long-press to select\./)
    const star = page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Star" })
    await card.focus()
    await focusNext(page)
    await expect(star).not.toBeFocused()

    await card.focus()
    await page.keyboard.press("Space")
    await expect(page.getByText("1 selected")).toBeVisible()
    await focusNext(page)
    await expect(star).toBeFocused()
  })

  test("focus goes back where it was when settings, the tag menu and the icon picker close", async ({ page }) => {
    await library(page)
    const settings = page.getByRole("button", { name: "Settings" })
    await settings.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(settings).toBeFocused()

    const row = page.getByRole("row", { name: /personal/ })
    const box = (await row.boundingBox())!
    await row.dispatchEvent("contextmenu", { clientX: box.x + 10, clientY: box.y + 10 })
    await page.getByRole("button", { name: "Change icon", exact: true }).click()
    await expect(page.getByPlaceholder("Search emoji")).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(row).toBeFocused()

    await row.dispatchEvent("contextmenu", { clientX: box.x + 10, clientY: box.y + 10 })
    await page.getByRole("button", { name: "Delete tag" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click()
    await expect(row).toBeFocused()
  })

  test("the tag menu opens from the keyboard too", async ({ page }) => {
    await library(page)
    const row = page.getByRole("row", { name: /personal/ })
    const changeIcon = page.getByRole("button", { name: "Change icon", exact: true })
    for (const key of ["Shift+F10", "ContextMenu"]) {
      await row.focus()
      await page.keyboard.press(key)
      await expect(changeIcon).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(row).toBeFocused()
    }
  })

  test("Escape in a settings CSS editor leaves the editor, not the dialog", async ({ page }) => {
    await library(page)
    await page.getByRole("button", { name: "Settings" }).click()
    const dialog = page.getByRole("dialog", { name: "Settings" })
    const editor = dialog.getByRole("textbox", { name: "App theme CSS" })
    // The editor fills in the current theme as it opens; typing before then would be mixed into it.
    await expect(editor).toContainText("--eos-ink")
    await editor.click()
    await page.keyboard.type("/* draft */")
    await page.keyboard.press("Escape")
    await expect(dialog).toBeVisible()
    await focusNext(page)
    await expect(editor).not.toBeFocused()
    await expect(editor).toContainText("/* draft */")
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  })

  test("Escape then Tab leaves the source editor, as its description says", async ({ page }) => {
    const id = await library(page)
    await openEditor(page, id)
    const editor = page.getByRole("textbox", { name: "Mermaid source" })
    await expect(editor).toHaveAccessibleDescription(/Press Escape, then Tab/)
    await editor.focus()
    await page.keyboard.press("Tab")
    await expect(editor).toBeFocused()
    await page.keyboard.press("Escape")
    await page.keyboard.press("Tab")
    await expect(editor).not.toBeFocused()
  })
})

test("type roles: sidebar rows are 14px medium on desktop and 16px on phones, dialog titles semibold", async ({ context, page }) => {
  await withAgentTools(context)
  await library(page)
  const font = (l: Locator) => l.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight])
  await expect.poll(() => font(page.getByRole("link", { name: /^Starred/ }))).toEqual(["14px", "500"])
  await page.getByRole("button", { name: "Settings" }).click()
  expect(await font(page.getByRole("dialog", { name: "Settings" }).locator("[data-slot=dialog-title]"))).toEqual(["15px", "600"])
  await page.keyboard.press("Escape")

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Show sidebar" }).click()
  const drawer = page.getByRole("dialog", { name: "Navigation" })
  await expect.poll(() => font(drawer.getByRole("link", { name: /^Starred/ }))).toEqual(["16px", "500"])
})

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("the selection's tag menu waits for a tap before raising the keyboard", async ({ context, page }) => {
    await withAgentTools(context)
    await library(page)
    await page.locator("[data-card-id]").first().focus()
    await page.keyboard.press("Space")
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Tags" }).tap()
    const search = page.getByPlaceholder("Find or create a tag")
    await expect(search).toBeVisible()
    await expect(search).not.toBeFocused()
    await search.tap()
    await expect(search).toBeFocused()
  })
})

test("a chrome:// address in Settings › MCP says Copied once it's copied", async ({ browserName, context, page }) => {
  test.skip(browserName !== "chromium", "Only Chromium lets a test grant clipboard access")
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  await dialog.getByRole("button", { name: "MCP", exact: true }).click()
  await dialog.getByRole("button", { name: /^chrome:\/\/flags\/#enable-webmcp-testing/ }).click()
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible()
})

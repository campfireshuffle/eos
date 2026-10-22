import { expect, test, type Locator, type Page } from "@playwright/test"

import { newDiagram, openEditor, tool, withAgentTools } from "./helpers"

test("importing a file that isn't a backup says why, and changes nothing", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "set_view" in (window as unknown as { __tools: object }).__tools)
  const before = await tool<{ counts: unknown }>(page, "get_library")
  await tool(page, "set_view", { settingsOpen: true })
  await page.getByRole("dialog").getByRole("button", { name: "Storage" }).click()
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("not json") })
  await expect(page.getByRole("alert")).toHaveText("This file isn't an Eos backup (it isn't JSON)")
  expect((await tool<{ counts: unknown }>(page, "get_library")).counts).toEqual(before.counts)
})

test("Escape closes Settings from the read-only MCP config", async ({ page }) => {
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  await dialog.getByRole("button", { name: "MCP" }).click()
  await dialog.getByRole("textbox", { name: "MCP config" }).click()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
})

test("the browser's theme colour follows the chosen mode, not only the system's", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/#/")
  const themeColors = () =>
    page.locator('meta[name="theme-color"]').evaluateAll((metas) => metas.map((m) => (m as HTMLMetaElement).content))
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("radio", { name: "Dark" }).click()
  await expect.poll(themeColors).toEqual(["rgb(14, 14, 14)", "rgb(14, 14, 14)"])
  await page.getByRole("radio", { name: "System" }).click()
  await expect.poll(themeColors).toEqual(["rgb(241, 240, 236)", "rgb(241, 240, 236)"])
})

test("theme CSS drops values that could fetch something", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "set_theme" in (window as unknown as { __tools: object }).__tools)
  const fetches = [
    "url(https://example.invalid/a)",
    "URL(https://example.invalid/b)",
    "\\75 rl(https://example.invalid/c)",
    "image-set('https://example.invalid/d' 1x)",
    "u/**/rl(https://example.invalid/e)",
  ]
  const appCss = `:root {\n${fetches.map((v, i) => `  --eos-x${i}: ${v};`).join("\n")}\n  --eos-primary: #ff0000;\n}`
  await tool(page, "set_theme", { appCss, diagramCss: ".pele { --pele-surface: url(https://example.invalid/f); }" })
  await expect(page.locator("#eos-theme-app")).toHaveJSProperty("textContent", ":root, .dark {\n  --eos-primary: #ff0000;\n}")
  await expect(page.locator("#eos-theme-diagram")).toHaveJSProperty("textContent", "")
})

test("an agent changing one app variable keeps the other mode's defaults", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "set_theme" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "set_theme", { mode: "dark" })
  // As set_theme says: start from the CSS get_settings returns, which is the dark palette here.
  const { theme } = await tool<{ theme: { appCss: string } }>(page, "get_settings")
  await tool(page, "set_theme", { appCss: theme.appCss.replace(/--eos-line:[^;]+;/, "--eos-line: #ff0000;") })
  await tool(page, "set_theme", { mode: "light" })
  const vars = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return [cs.getPropertyValue("--eos-ink").trim(), cs.getPropertyValue("--eos-line").trim()]
    })
  await expect.poll(vars).toEqual(["#f1f0ec", "#ff0000"])
})

test("saving one edited app variable keeps the other mode's defaults", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  await dialog.getByRole("radio", { name: "Light" }).click()
  // Replace only the value of the pre-filled --eos-line declaration.
  await dialog.locator(".cm-line", { hasText: "--eos-line: #dddad3;" }).click()
  await page.keyboard.press("End")
  for (let i = 0; i < "#dddad3;".length; i++) await page.keyboard.press("Backspace")
  await page.keyboard.type("#ff0000;")
  await dialog.getByRole("button", { name: "Save" }).click()
  await dialog.getByRole("radio", { name: "Dark" }).click()
  const vars = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return [cs.getPropertyValue("--eos-ink").trim(), cs.getPropertyValue("--eos-line").trim()]
    })
  await expect.poll(vars).toEqual(["#0e0e0e", "#ff0000"])
})

test("on a short screen, Theming's editors leave its headings and Save clear", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  const appEditor = dialog.locator(".cm-editor", { has: page.getByRole("textbox", { name: "App theme CSS" }) })
  await expect(appEditor).toBeVisible()
  // Scrolls Save into view, then fails if anything else would take the click.
  await dialog.getByRole("button", { name: "Save" }).click({ trial: true, timeout: 2000 })
  const heading = (await dialog.getByRole("heading", { name: "Diagram theme" }).boundingBox())!
  const editor = (await appEditor.boundingBox())!
  expect(heading.y).toBeGreaterThanOrEqual(editor.y + editor.height)
})

test("resetting the theme after a save shows the default app CSS again", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  await dialog.getByRole("radio", { name: "Light" }).click()
  const line = dialog.locator(".cm-line", { hasText: "--eos-line:" })
  await line.click()
  await page.keyboard.press("End")
  for (let i = 0; i < "#dddad3;".length; i++) await page.keyboard.press("Backspace")
  await page.keyboard.type("#ff0000;")
  await dialog.getByRole("button", { name: "Save" }).click()
  const lineVar = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--eos-line").trim())
  await expect.poll(lineVar).toBe("#ff0000")
  await dialog.getByRole("button", { name: "Reset to default" }).click()
  await expect.poll(lineVar).toBe("#dddad3")
  // In WebKit the editor used to keep #ff0000, which then became the baseline, so the next Save did nothing.
  await expect(line).toContainText("--eos-line: #dddad3;")
})

test("a confirm keeps its text while it fades out", async ({ browserName, page }) => {
  test.skip(browserName !== "chromium", "Only Chromium fades a dialog out (overlay); elsewhere it closes at once")
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  await dialog.getByRole("button", { name: "Storage", exact: true }).click()
  await dialog.getByRole("button", { name: "Delete all diagrams" }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  // Its text stays after Cancel, while it fades out.
  const closing = await page.evaluate(async () => {
    const alert = document.querySelector("[role=alertdialog]")!
    ;[...alert.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click()
    await new Promise(requestAnimationFrame)
    return document.querySelector("[role=alertdialog]")?.textContent
  })
  expect(closing).toContain("Delete")
  await expect(page.getByRole("alertdialog")).toBeHidden()
})

for (const delay of [0, 50]) {
  test(`a confirm that opens ${delay}ms after the last one is answered starts on Cancel`, async ({ context, page }) => {
    await withAgentTools(context)
    const id = await newDiagram(page, "flowchart TD\n  A --> B")
    await tool(page, "update_diagram", { id, addTags: ["alpha"] })
    await openEditor(page, id)
    await page.locator(".cm-content").click()
    type W = { __tools: Record<string, { execute(x: unknown): Promise<unknown> }>; __second: Promise<unknown> }
    // An agent asking twice in a row: the second confirm can open while the first is still fading out.
    await page.evaluate((delay) => {
      const w = window as unknown as W
      void w.__tools.delete_tag
        .execute({ path: "alpha" })
        .then(() => setTimeout(() => (w.__second = w.__tools.delete_all_data.execute({})), delay))
    }, delay)
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("alpha")
    await dialog.getByRole("button", { name: "Delete" }).click()
    await expect(dialog).toContainText("delete all your diagrams")
    // The Delete just clicked must not keep focus, or Enter would confirm the new action.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
    await page.keyboard.press("Enter")
    expect(await page.evaluate(() => (window as unknown as W).__second)).toMatchObject({ ok: false, code: "user_declined" })
    // Focus goes back to where it was before the first confirm.
    await expect(page.locator(".cm-content")).toBeFocused()
  })
}

/** Whether `dialog` has focus and matches :focus-visible, whether it has an outline, and its box-shadow. */
const dialogFocus = (dialog: Locator) =>
  dialog.evaluate((d) => {
    const cs = getComputedStyle(d)
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0
    return { focused: document.activeElement === d, visible: d.matches(":focus-visible"), outline, shadow: cs.boxShadow }
  })

/** The focused dialog shows an indicator: an outline, or a box-shadow other than its resting one (its 1px border ring). */
async function expectFocusRing(dialog: Locator, resting: string) {
  const f = await dialogFocus(dialog)
  expect(f).toMatchObject({ focused: true, visible: true })
  expect(f.outline || f.shadow !== resting, JSON.stringify(f)).toBe(true)
}

const shiftTab = (page: Page, browserName: string) => page.keyboard.press(browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab")

// Firefox and WebKit make a modal <dialog> itself a Tab stop (issue #19); Chromium leaves it. Where it's a stop, it shows a ring.
test("Shift+Tab from Settings' first control shows a ring on the dialog it lands on", async ({ browserName, page }) => {
  test.skip(browserName === "chromium", "Chromium's Shift+Tab leaves the dialog")
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  const resting = (await dialogFocus(dialog)).shadow
  // A click on blank space in the dialog (low in its tab list, inside its rounded corners) shows no ring.
  await dialog.click({ position: { x: 24, y: 560 } })
  await expect(dialog).toBeVisible()
  expect(await dialogFocus(dialog)).toMatchObject({ visible: false, outline: false, shadow: resting })
  await dialog.getByRole("button", { name: "Theming", exact: true }).focus()
  await shiftTab(page, browserName)
  await expectFocusRing(dialog, resting)
})

test("Shift+Tab from a confirm's Cancel shows a ring on the confirm it lands on", async ({ browserName, page }) => {
  test.skip(browserName === "chromium", "Chromium's Shift+Tab leaves the dialog")
  await page.goto("/#/")
  await page.getByRole("button", { name: "Settings" }).click()
  const settings = page.getByRole("dialog", { name: "Settings" })
  await settings.getByRole("button", { name: "Storage", exact: true }).click()
  await settings.getByRole("button", { name: "Delete all diagrams" }).click()
  const confirm = page.getByRole("alertdialog")
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused()
  const resting = (await dialogFocus(confirm)).shadow
  await shiftTab(page, browserName)
  await expectFocusRing(confirm, resting)
})

const EDITOR_CHUNK = /\/assets\/editor-[^/]+\.js$/

test("Settings opens offline once the app has loaded", async ({ context, page }) => {
  // CodeMirror comes with the editor's chunk, which the app preloads when idle.
  const preloaded = page.waitForResponse(EDITOR_CHUNK)
  await page.goto("/#/")
  await preloaded
  await context.setOffline(true)
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: "Settings" })
  const appCss = dialog.getByRole("textbox", { name: "App theme CSS" })
  await expect(appCss).toBeVisible()
  await expect(dialog.getByRole("textbox", { name: "Diagram theme CSS" })).toBeVisible()
  await appCss.click()
  await page.keyboard.press("ControlOrMeta+End")
  await page.keyboard.type("--eos-offline: 1;")
  await expect(appCss).toContainText("--eos-offline: 1;")
  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("a part that can't load offline says so, not that Eos was updated", async ({ context, page }) => {
  await context.route(EDITOR_CHUNK, (route) => route.abort())
  await page.goto("/#/")
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible()
  await context.setOffline(true)
  await page.getByRole("button", { name: "Settings" }).click()
  const alert = page.getByRole("alert")
  await expect(alert).toContainText("offline")
  await expect(alert).not.toContainText("updated")
  await expect(alert.getByRole("button", { name: "Reload" })).toBeVisible()
})

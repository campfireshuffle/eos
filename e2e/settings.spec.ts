import { expect, test } from "@playwright/test"

import { tool, withAgentTools } from "./helpers"

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

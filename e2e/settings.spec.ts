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

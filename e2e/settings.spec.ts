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

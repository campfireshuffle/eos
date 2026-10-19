import { expect, test } from "@playwright/test"

import { tool, withAgentTools } from "./helpers"

test("Esc cancels a confirm without dropping the selection", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "Keep me", open: false })

  await page
    .locator("[data-card-id]")
    .first()
    .click({ modifiers: ["ControlOrMeta"] })
  await expect(page.getByText("1 selected")).toBeVisible()
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("alertdialog")).toBeHidden()
  await expect(page.getByText("1 selected")).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(page.getByText("1 selected")).toBeHidden()
})

test("an agent's confirm doesn't replace one the person has open", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "Keep me", open: false })

  await page
    .locator("[data-card-id]")
    .first()
    .click({ modifiers: ["ControlOrMeta"] })
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText("Move this diagram to Deleted?")

  expect(await tool(page, "delete_all_data")).toMatchObject({ ok: false, code: "user_declined" })
  await expect(dialog).toContainText("Move this diagram to Deleted?")
})

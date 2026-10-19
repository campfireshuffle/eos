import { randomBytes } from "node:crypto"

import { expect, test } from "@playwright/test"

import { newDiagram, openEditor, withAgentTools } from "./helpers"

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

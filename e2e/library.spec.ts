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

  expect(await tool(page, "delete_all_data")).toMatchObject({ ok: false, code: "busy" })
  await expect(dialog).toContainText("Move this diagram to Deleted?")
})

// Safari throws once a page calls history.replaceState more than 100 times in 10 seconds.
test("a long search keeps every keystroke and reaches the URL", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto("/#/")
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  await search.click()
  const text = "the quick brown fox jumps over the lazy dog ".repeat(3)
  await page.keyboard.type(text, { delay: 20 })
  await expect(search).toHaveValue(text)
  await expect.poll(() => new URL(page.url()).hash).toBe(`#/?${new URLSearchParams({ q: text })}`)
  expect(errors).toEqual([])
})

test("back and forward show each entry's search in the box", async ({ page }) => {
  await page.goto("/#/?q=one")
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  await expect(search).toHaveValue("one")
  await page.evaluate(() => (location.hash = "/?q=two"))
  await expect(search).toHaveValue("two")
  await page.goBack()
  await expect(search).toHaveValue("one")
  await page.goForward()
  await expect(search).toHaveValue("two")
})

test("going back right after typing leaves the search in the entry it was typed in", async ({ page }) => {
  await page.goto("/#/")
  await page.evaluate(() => (location.hash = "/?tag=fruit"))
  const search = page.getByRole("textbox", { name: "Search diagrams" }).first()
  await search.click()
  await page.keyboard.type("app")
  await page.goBack()
  // Past any write still due from the typing.
  await page.waitForTimeout(400)
  expect(new URL(page.url()).hash).toBe("#/")
  await expect(search).toHaveValue("")
  await page.goForward()
  await expect(page).toHaveURL(/tag=fruit/)
  // At least the first keystroke reached the entry's URL at once, and the box shows what did.
  await expect(page).toHaveURL(/q=a/)
  const q = new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("q")
  await expect(search).toHaveValue(q!)
})

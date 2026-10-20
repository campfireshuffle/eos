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

test("a marquee selects the cards it covers, including ones scrolled into it mid-drag", async ({ context }) => {
  await withAgentTools(context)
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  for (let i = 0; i < 24; i++) await tool(page, "create_diagram", { title: `Card ${i}`, open: false })
  const cards = page.locator("[data-card-id]")
  await expect(cards.filter({ hasText: "Card 23" })).toBeVisible()

  // From the empty padding left of the first card, across the first row's first two cards.
  const first = (await cards.nth(0).boundingBox())!
  const second = (await cards.nth(1).boundingBox())!
  await page.mouse.move(first.x - 6, first.y + 4)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(first.x - 6 + ((second.x + 10 - first.x) * i) / 10, first.y + 20)
  await expect(page.getByText("2 selected")).toBeVisible()

  // Scrolling while the button is held stretches the box down through more rows.
  await page.locator(".eos-library-scroller").evaluate((el) => (el.scrollTop += 600))
  const count = async () => Number((await page.getByText(/^\d+ selected$/).textContent())?.split(" ")[0])
  await expect.poll(count).toBeGreaterThan(2)
  const during = await count()
  await page.mouse.up()
  expect(await count()).toBe(during)
})

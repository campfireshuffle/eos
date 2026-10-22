import { expect, test, type Page } from "@playwright/test"

import { newDiagram, openEditor, storedText, tool, withAgentTools } from "./helpers"

/**
 * Where focus goes when a confirm closes: back to what had focus when it opened, which for a confirm opened as the
 * last one closed is that one's opener. If nothing had focus, nothing has it after. The browser's <dialog> does this
 * (see dialog.tsx). Every case also checks that the new confirm starts on Cancel.
 */

type W = {
  __tools: Record<string, { execute(x: unknown, c?: { signal: AbortSignal }): Promise<unknown> }>
  __p: Record<string, Promise<unknown>>
  __r: Record<string, unknown>
  __ac: Record<string, AbortController>
}

const SOURCE = "flowchart TD\n  A --> B"
const answers = ["Cancel", "the action", "Escape", "agent abort"] as const
type Answer = (typeof answers)[number]
const results: Record<Answer, Record<string, unknown>> = {
  Cancel: { ok: false, code: "user_declined" },
  "the action": { ok: true },
  Escape: { ok: false, code: "user_declined" },
  "agent abort": { ok: false, code: "cancelled" },
}

/**
 * An agent asks to delete `tag`, without waiting for the answer. With `after`, it asks once that call has been
 * answered, `delay` ms later: so it can open while the first confirm is still fading out.
 */
function agentDeletesTag(page: Page, tag: string, after?: { tag: string; delay: number }) {
  return page.evaluate(
    ([tag, after]) => {
      const w = window as unknown as W
      w.__p ??= {}
      w.__r ??= {}
      w.__ac ??= {}
      const ac = (w.__ac[tag] = new AbortController())
      let done: (r: unknown) => void
      w.__p[tag] = new Promise((r) => (done = r))
      const ask = () => void w.__tools.delete_tag.execute({ path: tag }, { signal: ac.signal }).then((r) => done((w.__r[tag] = r)))
      if (after) void w.__p[after.tag].then(() => setTimeout(ask, after.delay))
      else ask()
    },
    [tag, after] as const
  )
}

const result = (page: Page, tag: string) => page.evaluate((tag) => (window as unknown as W).__r?.[tag], tag)

/** Waits for the confirm about `tag`, checks it starts on Cancel, and answers it. */
async function answer(page: Page, tag: string, how: Answer) {
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText(`“${tag}”`)
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  if (how === "Cancel") await dialog.getByRole("button", { name: "Cancel" }).click()
  else if (how === "the action") await dialog.getByRole("button", { name: "Delete" }).click()
  else if (how === "Escape") await page.keyboard.press("Escape")
  else await page.evaluate((tag) => (window as unknown as W).__ac[tag].abort(), tag)
  await expect.poll(() => result(page, tag)).toMatchObject(results[how])
}

/** Waits until the confirm has faded out and its close event has run. */
async function closed(page: Page) {
  await expect(page.getByRole("alertdialog")).toBeHidden()
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)))
}

async function editorWithTags(page: Page) {
  const id = await newDiagram(page, SOURCE)
  await tool(page, "update_diagram", { id, addTags: ["alpha", "beta"] })
  await openEditor(page, id)
  return id
}

test.beforeEach(async ({ context }) => {
  await withAgentTools(context)
})

for (const how of answers) {
  test(`opened from the editor, answered by ${how}: focus goes back to the editor`, async ({ page }) => {
    await editorWithTags(page)
    await page.locator(".cm-content").click()
    await agentDeletesTag(page, "alpha")
    await answer(page, "alpha", how)
    await expect(page.locator(".cm-content")).toBeFocused()
  })

  test(`opened with nothing focused, answered by ${how}: focus stays put, so typing changes nothing`, async ({ page }) => {
    const id = await editorWithTags(page)
    // An earlier confirm, from the editor, whose opener must not be reused.
    await page.locator(".cm-content").click()
    await agentDeletesTag(page, "beta")
    await answer(page, "beta", "Cancel")
    await expect(page.locator(".cm-content")).toBeFocused()
    await closed(page)
    // The person clicks somewhere unfocusable.
    await page.locator(".pele-preview svg").first().click()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)

    await agentDeletesTag(page, "alpha")
    await answer(page, "alpha", how)
    await closed(page)
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    await page.keyboard.type("ZZ")
    expect(await storedText(page, id)).toBe(SOURCE)
  })

  for (const delay of [0, 50]) {
    test(`opened ${delay}ms after the last confirm was answered, answered by ${how}: focus goes back to the first one's opener`, async ({
      page,
    }) => {
      await editorWithTags(page)
      await page.locator(".cm-content").click()
      await agentDeletesTag(page, "alpha")
      await agentDeletesTag(page, "beta", { tag: "alpha", delay })
      // The first confirm's Delete is clicked, so it must not keep focus into the next one.
      await answer(page, "alpha", "the action")
      await answer(page, "beta", how)
      await expect(page.locator(".cm-content")).toBeFocused()
    })
  }
}

test("opened from the selection bar's Delete: Cancel goes back to it, and Delete leaves focus on the page", async ({ page }) => {
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  await tool(page, "create_diagram", { title: "One", source: SOURCE, open: false })
  const card = page.locator("[data-card-id]", { hasText: "One" })
  await card.focus()
  await page.keyboard.press("Space")
  const del = page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Delete" })
  const dialog = page.getByRole("alertdialog")

  // Safari doesn't focus a clicked button, so it's pressed from the keyboard.
  await del.focus()
  await page.keyboard.press("Enter")
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(del).toBeFocused()

  await page.keyboard.press("Enter")
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  await dialog.getByRole("button", { name: "Delete" }).click()
  await expect(card).toHaveCount(0)
  await closed(page)
  // The bar is out of reach once nothing is selected, so focus isn't sent back into it.
  await expect(del).not.toBeFocused()
})

test("a confirm asked for while one is open answers busy, and leaves the first one open", async ({ page }) => {
  await editorWithTags(page)
  await agentDeletesTag(page, "alpha")
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText("“alpha”")
  expect(await tool(page, "delete_tag", { path: "beta" })).toMatchObject({ ok: false, code: "busy" })
  await expect(dialog).toContainText("“alpha”")
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect.poll(() => result(page, "alpha")).toMatchObject({ code: "user_declined" })
})

test("a confirm an agent aborts keeps its text while it fades out", async ({ browserName, page }) => {
  test.skip(browserName !== "chromium", "Only Chromium fades a dialog out (overlay); elsewhere it closes at once")
  await editorWithTags(page)
  await agentDeletesTag(page, "alpha")
  await expect(page.getByRole("alertdialog")).toContainText("“alpha”")
  const closing = await page.evaluate(async () => {
    ;(window as unknown as W).__ac.alpha.abort()
    await new Promise(requestAnimationFrame)
    return document.querySelector("[role=alertdialog]")?.textContent
  })
  expect(closing).toContain("“alpha”")
  await expect(page.getByRole("alertdialog")).toBeHidden()
})

for (const delay of [0, 50]) {
  test(`a confirm asked for ${delay}ms after an agent aborts one starts on Cancel, and Escape goes back to the editor`, async ({
    page,
  }) => {
    await editorWithTags(page)
    await page.locator(".cm-content").click()
    await agentDeletesTag(page, "alpha")
    await agentDeletesTag(page, "beta", { tag: "alpha", delay })
    await answer(page, "alpha", "agent abort")
    await answer(page, "beta", "Escape")
    await expect(page.locator(".cm-content")).toBeFocused()
  })
}

test("Escape on an agent's confirm over Settings closes only the confirm", async ({ page }) => {
  await editorWithTags(page)
  await tool(page, "set_view", { settingsOpen: true })
  const settings = page.getByRole("dialog", { name: "Settings" })
  await expect(settings).toBeVisible()
  await agentDeletesTag(page, "alpha")
  await answer(page, "alpha", "Escape")
  await closed(page)
  await expect(settings).toBeVisible()
  // Focus goes back into Settings, where it was.
  expect(await settings.evaluate((d) => d.contains(document.activeElement))).toBe(true)
})

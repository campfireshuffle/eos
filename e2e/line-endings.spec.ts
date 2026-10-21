import { expect, test, type Page } from "@playwright/test"

import { cursorAtEndOf, editorText, newDiagram, openEditor, storedText, tool, withAgentTools } from "./helpers"

/**
 * A backup an older Eos made of a diagram with CRLF line endings, saved as it came (OLD_SOURCE).
 * Importing it leaves the diagram stored as that version stored it.
 */
const OLD_CRLF_BACKUP = JSON.stringify({
  v: 1,
  diagrams: [
    {
      id: "0b6f2c1e-5a4d-4e8b-9c1f-3d2e7a6b8c90",
      snapshot:
        "bG9ybwAAAAAAAAAAAAAAAJT5sSMAAxEBAABMT1JPAAHt2PCq3/bNtvABTAACAHZ2Ae3Y8Krf9s228AFOAAwA8G03tfVcLG0AAAAAACcAJwEQAW0sXPW1N23wAQEAAAAAABgBuIHErQ0AAQ97ImtpbmQiOiJ1c2VyIn0LAgQBAAAGBAECAAghBXRpdGxlCWNyZWF0ZWRBdAR0YWdzBG1ldGEGc291cmNlABgBBAQGAAECBgEABAIBAwQGCwEFBAYBASQAOAUIT2xkIENSTEYDgIiLpo80CQEkZmxvd2NoYXJ0IFREDQogIEEgLS0+IEINCiAgQiAtLT4gQw0KAAAMAB0AAwALgo5EAQAAAAUAAAACAGZyAAwA8G03tfVcLG0AAAAAFy5Iqe4AAADpAAAATE9STwABAgEABG1ldGEBAAABAwAAAAAGAIAEbWV0YQABAAMEdGFncwcB7djwqt/2zbbwAQQCCWNyZWF0ZWRBdAOAkJbMnmgFdGl0bGUECE9sZCBDUkxGAAFtLFz1tTdt8AABAAIAAAAIAIIGc291cmNlAgEAJGZsb3djaGFydCBURA0KICBBIC0tPiBCDQogIEIgLS0+IEMNCgFtLFz1tTdt8AMEAgEAAgEGAgEAAgFIAAAAABEAYgADAP3beRoBAAAABQAAAA0AAW0sXPW1N23wAgAAAAAIAIIGc291cmNl+jReZb8AAAAAAAAA",
    },
  ],
})
const OLD_ID = "0b6f2c1e-5a4d-4e8b-9c1f-3d2e7a6b8c90"
const OLD_SOURCE = "flowchart TD\r\n  A --> B\r\n  B --> C\r\n"

/** Imports the backup above, and returns the version its diagram is at. */
async function importOldCrlf(page: Page) {
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "import_backup" in (window as unknown as { __tools: object }).__tools)
  expect(await tool(page, "import_backup", { data: OLD_CRLF_BACKUP, mode: "merge" })).toMatchObject({ ok: true })
  const { diagram, version } = await tool<{ diagram: { source: string }; version: string }>(page, "get_diagram", { id: OLD_ID })
  expect(diagram.source).toBe(OLD_SOURCE)
  return version
}

/**
 * Types at the end of a line (0-based), then expects what's saved to be exactly what the editor shows, and returns it.
 * The editor shows a "\r" as the marker "␍".
 */
async function typeAndCompare(page: Page, id: string, line: number) {
  await cursorAtEndOf(page, line)
  await page.keyboard.type("X")
  await expect.poll(() => editorText(page)).toContain("X")
  await expect.poll(async () => (await storedText(page, id)).replace(/\r/g, "␍") === (await editorText(page))).toBe(true)
  return storedText(page, id)
}

test("typing in a diagram an agent wrote with CRLF line endings saves what the editor shows", async ({ context, page }) => {
  await withAgentTools(context)
  const id = await newDiagram(page, "flowchart TD\r\n  A --> B\r\n  B --> C\r\n")
  await openEditor(page, id)
  await cursorAtEndOf(page, 2) // the end of line 3, "  B --> C"
  await page.keyboard.type("X")
  await expect.poll(() => editorText(page)).toBe("flowchart TD\n  A --> B\n  B --> CX\n")
  await expect.poll(() => storedText(page, id)).toBe("flowchart TD\n  A --> B\n  B --> CX\n")
})

test("typing after an agent rewrites the source with CRLF line endings saves what the editor shows", async ({ context, page }) => {
  await withAgentTools(context)
  const id = await newDiagram(page, "flowchart TD\n  A --> B\n")
  await openEditor(page, id)
  const { version } = await tool<{ version: string }>(page, "get_diagram", { id })
  await tool(page, "update_diagram", { id, source: "flowchart TD\r\n  A --> B\r\n  B --> C\r\n", baseVersion: version })
  await expect.poll(() => editorText(page)).toBe("flowchart TD\n  A --> B\n  B --> C\n")
  await tool(page, "update_diagram", { id, source: "flowchart TD\r\n  A --> B\r\n  B --> C\r\n  C --> D\r\n" })
  await expect.poll(() => editorText(page)).toBe("flowchart TD\n  A --> B\n  B --> C\n  C --> D\n")
  expect(await typeAndCompare(page, id, 2)).toBe("flowchart TD\n  A --> B\n  B --> CX\n  C --> D\n")
})

test("typing in a diagram an older version saved with CRLF line endings saves what the editor shows", async ({ context, page }) => {
  await withAgentTools(context)
  await importOldCrlf(page)
  await openEditor(page, OLD_ID)
  // Lines break at each \n; the \r before it is a character on its line, shown as a marker.
  await expect.poll(() => editorText(page)).toBe("flowchart TD␍\n  A --> B␍\n  B --> C␍\n")
  expect(await typeAndCompare(page, OLD_ID, 2)).toBe("flowchart TD\r\n  A --> B\r\n  B --> C\rX\n")
  await expect(page.locator(".pele-preview svg")).toBeVisible()
})

test("typing after restoring a version with CRLF line endings saves what the editor shows", async ({ context, page }) => {
  await withAgentTools(context)
  const old = await importOldCrlf(page)
  await openEditor(page, OLD_ID)
  await tool(page, "update_diagram", { id: OLD_ID, source: "flowchart LR\n  Z\n" })
  await expect.poll(() => editorText(page)).toBe("flowchart LR\n  Z\n")
  expect(await tool(page, "update_diagram", { id: OLD_ID, revert: old })).toMatchObject({ ok: true })
  await expect.poll(() => storedText(page, OLD_ID)).toBe(OLD_SOURCE)
  expect(await typeAndCompare(page, OLD_ID, 2)).toBe("flowchart TD\r\n  A --> B\r\n  B --> C\rX\n")
})

test("pasting CRLF text saves what the editor shows", async ({ context, page, browserName }) => {
  test.skip(browserName === "firefox", "Firefox drops the clipboardData of a paste event made by a script")
  await withAgentTools(context)
  const id = await newDiagram(page, "flowchart TD\n  A --> B\n")
  await openEditor(page, id)
  await page.locator(".cm-line").nth(1).click()
  await page.keyboard.press("End")
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData("text/plain", "\r\n  B --> C\r\n  C --> D")
    document
      .querySelector(".cm-content")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await page.keyboard.type("X")
  await expect.poll(() => editorText(page)).toBe("flowchart TD\n  A --> B\n  B --> C\n  C --> DX\n")
  await expect.poll(() => storedText(page, id)).toBe("flowchart TD\n  A --> B\n  B --> C\n  C --> DX\n")
})

for (const colorScheme of ["light", "dark"] as const)
  test(`in ${colorScheme} mode a stray \\r's marker has the contrast of text`, async ({ context, page }) => {
    await page.emulateMedia({ colorScheme })
    await withAgentTools(context)
    await importOldCrlf(page)
    await openEditor(page, OLD_ID)
    const marker = page.locator(".cm-specialChar").first()
    await expect(marker).toHaveText("␍")
    // axe skips text made only of symbols, so measure it: the marker's colour on the first opaque background behind it.
    const ratio = await marker.evaluate((el) => {
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
      const rgb = (color: string) => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data]
      }
      let back: Element = el
      while (back.parentElement && rgb(getComputedStyle(back).backgroundColor)[3] < 255) back = back.parentElement
      const luminance = (color: string) => {
        const [r, g, b] = rgb(color).map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const [fg, bg] = [luminance(getComputedStyle(el).color), luminance(getComputedStyle(back).backgroundColor)]
      const [hi, lo] = [Math.max(fg, bg), Math.min(fg, bg)]
      return (hi + 0.05) / (lo + 0.05)
    })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

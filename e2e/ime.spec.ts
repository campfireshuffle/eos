import { expect, test, type Page } from "@playwright/test"

import { cursorAtEndOf, expectEditor, newDiagram, openEditor, storedText, tool, withAgentTools } from "./helpers"

// Someone else's change landing while the person composes text with an IME (pinyin "ni" for 你) leaves the composition
// to finish: what's committed is the chosen character alone, with no stray letters. Chromium only, the one engine whose
// IME Playwright can drive (through CDP).

const SOURCE = "graph TD\n  P --> Q\n  A --> B\n  C --> D"
const CARET_LINE = 2

/** The change someone else makes, to the lines they see; the person's caret is at the end of CARET_LINE. */
const CHANGES: Record<string, (lines: string[]) => string[]> = {
  "adds a line above": (l) => [...l.slice(0, CARET_LINE), "  X --> Y", ...l.slice(CARET_LINE)],
  "adds a line below": (l) => [...l.slice(0, CARET_LINE + 1), "  X --> Y", ...l.slice(CARET_LINE + 1)],
  "changes the start of the caret's line": (l) => l.map((line, i) => (i === CARET_LINE ? line.replace("A", "A2") : line)),
  "adds a line at the top": (l) => ["%% t", ...l],
  "removes the line above": (l) => [...l.slice(0, CARET_LINE - 1), ...l.slice(CARET_LINE)],
}

const withCaretLine = (text: string, typed: string) => text.split("\n").map((line, i) => (i === CARET_LINE ? line + typed : line))

/** Makes `next` from `prev` as one edit in `page`'s editor, as typing or a paste in another tab would. */
async function editIn(page: Page, prev: string, next: string) {
  let from = 0
  let to = prev.length
  let end = next.length
  while (from < to && from < end && prev[from] === next[from]) from++
  while (to > from && end > from && prev[to - 1] === next[end - 1]) {
    to--
    end--
  }
  await page.evaluate(
    ([f, t, insert]) => {
      const content = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: { dispatch(spec: unknown): void } } } }
      content.cmTile.root.view.dispatch({ changes: { from: f, to: t, insert }, userEvent: "input.paste" })
    },
    [from, to, next.slice(from, end)] as const
  )
}

for (const [name, change] of Object.entries(CHANGES))
  for (const via of ["an agent's edit with baseVersion", "an agent's edit without one", "another tab"] as const)
    test(`a composition finishes cleanly when ${via} ${name}`, async ({ context, browserName }) => {
      test.skip(browserName !== "chromium", "only Chromium's IME can be driven")
      await withAgentTools(context)
      const page = await context.newPage()
      const id = await newDiagram(page, SOURCE)
      const other = via === "another tab" ? await context.newPage() : null
      if (other) await openEditor(other, id)
      await openEditor(page, id)
      const { version } = await tool<{ version: string }>(page, "get_diagram", { id })
      await page.bringToFront()
      await cursorAtEndOf(page, CARET_LINE)

      const cdp = await context.newCDPSession(page)
      for (const text of ["n", "ni"])
        await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length })
      await expect.poll(() => storedText(page, id)).toBe(withCaretLine(SOURCE, "ni").join("\n"))

      const now = await storedText(page, id)
      const next = change(now.split("\n")).join("\n")
      if (via === "another tab") await editIn(other!, now, next)
      else if (via === "an agent's edit without one") await tool(page, "update_diagram", { id, source: next })
      else await tool(page, "update_diagram", { id, source: change(SOURCE.split("\n")).join("\n"), baseVersion: version })
      await expectEditor(page, next)

      await cdp.send("Input.imeSetComposition", { text: "nih", selectionStart: 3, selectionEnd: 3 })
      await cdp.send("Input.insertText", { text: "你" })
      const committed = change(withCaretLine(SOURCE, "你")).join("\n")
      await expectEditor(page, committed)
      await expect.poll(() => storedText(page, id)).toBe(committed)
    })

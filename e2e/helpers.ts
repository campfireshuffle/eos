import { expect, type BrowserContext, type Page } from "@playwright/test"

/** Stands in for the browser's WebMCP API, so tests can call Eos's agent tools directly. */
export async function withAgentTools(context: BrowserContext) {
  await context.addInitScript(() => {
    const tools: Record<string, { execute(input: unknown): Promise<unknown> }> = {}
    Object.assign(window, { __tools: tools })
    Object.defineProperty(document, "modelContext", { value: { registerTool: (t: { name: string }) => (tools[t.name] = t as never) } })
  })
}

/** Calls one of Eos's WebMCP tools in `page`, as an agent would. */
export function tool<T = Record<string, unknown>>(page: Page, name: string, input: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(
    ([n, i]) => (window as unknown as { __tools: Record<string, { execute(x: unknown): Promise<unknown> }> }).__tools[n].execute(i),
    [name, input] as const
  ) as Promise<T>
}

export async function newDiagram(page: Page, source: string): Promise<string> {
  await page.goto("/#/")
  await page.waitForFunction(() => "__tools" in window && "create_diagram" in (window as unknown as { __tools: object }).__tools)
  const { id } = await tool<{ id: string }>(page, "create_diagram", { title: "Test", source, open: false })
  return id
}

export async function openEditor(page: Page, id: string) {
  await page.goto(`/#/d/${id}`)
  await page.locator(".cm-content").waitFor()
}

/** The text the editor shows (fine for short documents; CodeMirror only renders what's on screen). */
export const editorText = (page: Page) => page.locator(".cm-line").evaluateAll((lines) => lines.map((l) => l.textContent).join("\n"))

/** What's saved, as the agent tools read it. */
export const storedText = async (page: Page, id: string) =>
  (await tool<{ diagram: { source: string } }>(page, "get_diagram", { id })).diagram.source

/** Places the cursor at the end of a line (0-based) in the editor. */
export async function cursorAtEndOf(page: Page, line: number) {
  await page.locator(".cm-line").nth(line).click()
  await page.keyboard.press("End")
}

/** Waits until the editor shows `text`. */
export const expectEditor = (page: Page, text: string) => expect.poll(() => editorText(page)).toBe(text)

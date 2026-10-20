import { expect, test, type Page } from "@playwright/test"

import { editorText, openEditor, tool, withAgentTools } from "./helpers"

type Watched = Window & { __cspViolations: string[]; __tools?: Record<string, unknown> }

const violations = (page: Page) => page.evaluate(() => (window as unknown as Watched).__cspViolations)

// e2e runs against `vite preview`, which applies public/_headers as production does.
test("the app is served with its Content-Security-Policy and works under it", async ({ context }) => {
  // Collected from the first script on, so a blocked wasm or fetch is reported, not left to time out.
  await context.addInitScript(() => {
    const seen: string[] = ((window as unknown as Watched).__cspViolations = [])
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.violatedDirective} blocked ${e.blockedURI}`))
  })
  await withAgentTools(context)
  const page = await context.newPage()

  const response = await page.goto("/#/")
  const csp = response?.headers()["content-security-policy"] ?? ""
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("'wasm-unsafe-eval'")

  // The app registers its tools once the store (Loro's wasm, IndexedDB) is up; stop early on a violation.
  await page.waitForFunction(() => {
    const w = window as unknown as Watched
    return w.__cspViolations.length > 0 || "create_diagram" in (w.__tools ?? {})
  })
  expect(await violations(page)).toEqual([])

  const { id } = await tool<{ id: string }>(page, "create_diagram", { title: "CSP", source: "flowchart LR\n  a --> b", open: false })
  await openEditor(page, id)
  await expect.poll(() => editorText(page)).toContain("a --> b")
  await expect(page.locator(".pele-preview svg")).toBeVisible()
  // PNG export draws the SVG from a data: URL, which img-src must allow.
  const png = await tool<{ data?: string }>(page, "export", { format: "png", id }).catch((e: unknown) => ({ data: String(e) }))
  expect(await violations(page)).toEqual([])
  expect(png.data).toMatch(/^data:image\/png;base64,/)
})

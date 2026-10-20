import { expect, test } from "@playwright/test"

import { editorText, newDiagram, openEditor, withAgentTools } from "./helpers"

// e2e runs against `vite preview`, which applies public/_headers as production does.
test("the app is served with its Content-Security-Policy and works under it", async ({ context }) => {
  const violations: string[] = []
  await context.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`))
  )
  await withAgentTools(context)
  const page = await context.newPage()
  page.on("console", (m) => {
    if (m.text().startsWith("CSP violation")) violations.push(m.text())
  })

  const response = await page.goto("/#/")
  const csp = response?.headers()["content-security-policy"] ?? ""
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("'wasm-unsafe-eval'")

  // Opening a diagram loads Loro's wasm and renders Mermaid, the parts the policy must allow.
  const id = await newDiagram(page, "flowchart LR\n  a --> b")
  await openEditor(page, id)
  await expect.poll(() => editorText(page)).toContain("a --> b")
  await expect(page.locator(".pele-preview svg")).toBeVisible()
  expect(violations).toEqual([])
})

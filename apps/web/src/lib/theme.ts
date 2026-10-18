/** Applies the user's pasted CSS variables. Only custom-property declarations are kept. */
export function applyThemeCss(css: string | null) {
  let el = document.getElementById("eos-theme") as HTMLStyleElement | null
  if (!el) {
    el = Object.assign(document.createElement("style"), { id: "eos-theme" })
    document.head.append(el)
  }
  el.textContent = css ? sanitizeThemeCss(css) : ""
}

export function sanitizeThemeCss(css: string): string {
  const decls = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;{}<>]+);?/g)]
    .map(([, name, value]) => `${name}: ${value.trim()};`)
    .join("\n  ")
  return decls ? `:root, .dark {\n  ${decls}\n}` : ""
}

export const DEFAULT_THEME_CSS = `:root {
  /* surfaces */
  --eos-ink: #0e0e0e;
  --eos-panel: #191919;
  --eos-line: #262626;

  /* text */
  --eos-body: #ebeae6;
  --eos-muted: #8b8b88;

  /* accent */
  --eos-ivory: #fcf4e4;
  --eos-champagne: #e6cc9c;
}
`

import type { AppSettings, ThemeMode } from "@eos/core"

const MODE_KEY = "eos-theme-mode"
const media = () => matchMedia("(prefers-color-scheme: dark)")
let currentMode: ThemeMode = "system"

function resolveDark(mode: ThemeMode) {
  return mode === "dark" || (mode === "system" && media().matches)
}

function applyMode(mode: ThemeMode) {
  currentMode = mode
  document.documentElement.classList.toggle("dark", resolveDark(mode))
  // index.html's theme-color follows the system scheme; follow the mode actually shown instead (Safari tints its bars with it).
  const background = getComputedStyle(document.body).backgroundColor
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = background
  try {
    localStorage.setItem(MODE_KEY, mode) // read by the inline script in index.html to avoid a flash
  } catch {
    // Storage may be unavailable (private mode); the mode still applies for this session.
  }
}

media().addEventListener("change", () => currentMode === "system" && applyMode("system"))

/** Applies light/dark mode plus the user's app and diagram CSS variable overrides. */
export function applyTheme(theme: AppSettings["theme"]) {
  setStyle("eos-theme-app", theme.customCss ? sanitizeVars(theme.customCss, /^--/) : "")
  setStyle("eos-theme-diagram", theme.diagramCss ? sanitizeVars(theme.diagramCss, /^--pele-/) : "")
  applyMode(theme.mode)
}

function setStyle(id: string, css: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = Object.assign(document.createElement("style"), { id })
    document.head.append(el)
  }
  el.textContent = css
}

/** Keeps only custom-property declarations whose names match `allow`. */
export function sanitizeVars(css: string, allow: RegExp): string {
  const decls = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;{}<>]+);?/g)]
    .filter(([, name]) => allow.test(name))
    .map(([, name, value]) => `${name}: ${value.trim()};`)
    .join("\n  ")
  return decls ? `:root, .dark {\n  ${decls}\n}` : ""
}

const APP_VARS: [string, string[]][] = [
  ["surfaces", ["--eos-ink", "--eos-panel", "--eos-line"]],
  ["text", ["--eos-body", "--eos-muted"]],
  ["accent", ["--eos-primary", "--eos-champagne"]],
]

/** The app variables as they currently resolve, so the editor's starting point matches the active mode. */
export function currentAppCss(): string {
  const cs = getComputedStyle(document.documentElement)
  const body = APP_VARS.map(
    ([label, vars]) => `  /* ${label} */\n` + vars.map((v) => `  ${v}: ${cs.getPropertyValue(v).trim()};`).join("\n")
  ).join("\n\n")
  return `:root {\n${body}\n}\n`
}

export const DEFAULT_DIAGRAM_CSS = `.pele {
  /* colors */
  --pele-fg: var(--eos-body);
  --pele-line: var(--eos-muted);
  --pele-surface: var(--eos-raised);
  --pele-border: var(--eos-line-active);
  --pele-accent: var(--eos-champagne);

  /* shape */
  --pele-radius: 6px;
}
`

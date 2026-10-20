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
  // Thumbnails set their own --pele-bg default (app.css), which saved diagram CSS still overrides.
  setStyle("eos-theme-diagram", theme.diagramCss ? sanitizeVars(theme.diagramCss, /^--pele-/, ":root, .dark, .pele-thumb") : "")
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

/**
 * Values that could make the page fetch something: CSS functions that load a resource, and
 * backslashes, since an escaped name (`\75 rl(`) is still `url(`. Theme CSS can come from a
 * backup or an agent, and a fetch would tell someone when Eos is open.
 */
const FETCHES = /\\|(?:url|src|image|image-set|cross-fade)\s*\(/i

/** The custom-property declarations in `css` as [name, value] pairs; comments and everything else are ignored. */
function parseVars(css: string): [string, string][] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;{}<>]+);?/g)].map(([, name, value]) => [
    name,
    value.trim(),
  ])
}

/** Keeps only custom-property declarations whose names match `allow` and whose values can't fetch anything. */
export function sanitizeVars(css: string, allow: RegExp, selector = ":root, .dark"): string {
  const decls = parseVars(css)
    .filter(([name, value]) => allow.test(name) && !FETCHES.test(value))
    .map(([name, value]) => `${name}: ${value};`)
    .join("\n  ")
  return decls ? `${selector} {\n  ${decls}\n}` : ""
}

/**
 * The declarations in `css` whose values differ from `prefill`, or null if none do. The pre-fill holds one
 * mode's values and saved CSS applies to both, so saving it whole would carry that mode into the other.
 */
export function changedVars(css: string, prefill: string): string | null {
  const before = new Map(parseVars(prefill))
  const changed = parseVars(css).filter(([name, value]) => before.get(name) !== value)
  return changed.length ? `:root {\n${changed.map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}\n` : null
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

export function download(name: string, data: string | Blob, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement("a"), { href: url, download: safeName(name) })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "diagram"
}

/** Inlines the live CSS variables so an exported SVG looks the same outside Eos. */
export function standaloneSvg(svgEl: SVGSVGElement): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  const computed = getComputedStyle(svgEl)
  const vars = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules]
      } catch {
        return []
      }
    })
    .flatMap((rule) => ("style" in rule ? [...(rule as CSSStyleRule).style] : []))
    .filter((p) => p.startsWith("--pele-"))
  const style = [...new Set(vars)].map((v) => `${v}:${computed.getPropertyValue(v).trim()}`).join(";")
  // Drop any inline sizing (such as Pele's responsive max-width), so the width and height attributes size the file.
  for (const p of ["width", "height", "max-width", "display"]) clone.style.removeProperty(p)
  clone.setAttribute("style", `${clone.getAttribute("style") ?? ""};${style};background:${computed.getPropertyValue("--pele-bg").trim()}`)
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  return new XMLSerializer().serializeToString(clone)
}

/** Font files as data URLs, by URL. A failed download isn't kept, so the next export retries it. */
const fontFiles = new Map<string, Promise<string>>()

function fontFile(url: string): Promise<string> {
  let file = fontFiles.get(url)
  if (!file) {
    file = fetch(url)
      .then((r) => r.blob())
      .then(blobToDataUrl)
    file.catch(() => fontFiles.delete(url))
    fontFiles.set(url, file)
  }
  return file
}

/**
 * The page's currently loaded web fonts as @font-face rules with the font files inlined.
 * An SVG drawn as an image can't fetch anything, so without this a PNG export falls back
 * from Inter to a system font. Worked out per export, since more subsets (e.g. Greek or
 * Cyrillic) load as diagrams need them.
 */
async function embeddedFontCss(): Promise<string> {
  const plain = (v: string) => v.replace(/["'\s]/g, "").toUpperCase()
  const loaded = new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => plain(f.family) + plain(f.unicodeRange)))
  const rules = [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules].filter((r) => r instanceof CSSFontFaceRule).map((rule) => ({ rule, base: sheet.href ?? location.href }))
    } catch {
      return [] // Another origin's stylesheet.
    }
  })
  const faces = await Promise.all(
    rules
      .filter(({ rule }) =>
        loaded.has(plain(rule.style.getPropertyValue("font-family")) + plain(rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF"))
      )
      .map(async ({ rule, base }) => {
        const src = rule.style.getPropertyValue("src").match(/url\(["']?([^"')]+)["']?\)/)?.[1]
        if (!src) return ""
        try {
          return rule.cssText.replace(/src:[^;]+;/, `src: url("${await fontFile(new URL(src, base).href)}");`)
        } catch {
          return "" // This face falls back to a system font; the rest still embed.
        }
      })
  )
  return faces.join("\n")
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type};base64,${(await blob.bytes()).toBase64()}`
}

export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const fonts = await embeddedFontCss()
  const withFonts = fonts ? svg.replace(/<svg[^>]*>/, (open) => `${open}<style>${fonts}</style>`) : svg
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withFonts)}`
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = img.naturalWidth * scale
  canvas.height = img.naturalHeight * scale
  const ctx = canvas.getContext("2d")!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"))
}

/** Pele SVG markup with the theme in effect inlined, as the Export menu saves it. */
export function themedSvg(markup: string): string {
  const host = Object.assign(document.createElement("div"), { className: "pele-preview" })
  Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", visibility: "hidden" })
  host.innerHTML = markup
  document.body.append(host)
  try {
    const svg = host.querySelector("svg")
    if (!svg) throw new Error("Not an SVG")
    return standaloneSvg(svg)
  } finally {
    host.remove()
  }
}

/** Renders Pele SVG markup to a PNG in the current theme, for agents. */
export async function svgMarkupToPng(markup: string): Promise<{ dataUrl: string; blob: Blob }> {
  const blob = await svgToPng(themedSvg(markup))
  return { dataUrl: await blobToDataUrl(blob), blob }
}

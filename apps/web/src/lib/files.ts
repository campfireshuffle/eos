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
  clone.setAttribute("style", `${clone.getAttribute("style") ?? ""};${style};background:${getComputedStyle(document.body).backgroundColor}`)
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  return new XMLSerializer().serializeToString(clone)
}

let fontCss: Promise<string> | null = null

/**
 * The page's loaded web fonts as @font-face rules with the font files inlined.
 * An SVG drawn as an image can't fetch anything, so without this a PNG export
 * falls back from Inter to a system font.
 */
function embeddedFontCss(): Promise<string> {
  fontCss ??= (async () => {
    const plain = (v: string) => v.replace(/["'\s]/g, "").toUpperCase()
    const loaded = new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => plain(f.family) + plain(f.unicodeRange)))
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules].filter((r) => r instanceof CSSFontFaceRule).map((rule) => ({ rule, base: sheet.href ?? location.href }))
      } catch {
        return []
      }
    })
    const faces = await Promise.all(
      rules
        .filter(({ rule }) =>
          loaded.has(
            plain(rule.style.getPropertyValue("font-family")) + plain(rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF")
          )
        )
        .map(async ({ rule, base }) => {
          const src = rule.style.getPropertyValue("src").match(/url\(["']?([^"')]+)["']?\)/)?.[1]
          if (!src) return ""
          const data = await blobToDataUrl(await (await fetch(new URL(src, base))).blob())
          return rule.cssText.replace(/src:[^;]+;/, `src: url("${data}");`)
        })
    )
    return faces.join("\n")
  })().catch(() => "")
  return fontCss
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
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

/** Renders Pele SVG markup to a PNG in the current theme, for agents (the Export menu uses the live preview). */
export async function svgMarkupToPng(markup: string): Promise<{ dataUrl: string; blob: Blob }> {
  const host = Object.assign(document.createElement("div"), { className: "pele-preview" })
  Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", visibility: "hidden" })
  host.innerHTML = markup
  document.body.append(host)
  try {
    const svg = host.querySelector("svg")
    if (!svg) throw new Error("Not an SVG")
    const blob = await svgToPng(standaloneSvg(svg))
    return { dataUrl: await blobToDataUrl(blob), blob }
  } finally {
    host.remove()
  }
}

import { ChevronDown, Code, Copy, Download, FileCode, FileImage, Image, Link } from "lucide-react"

import { encodeShare, shareUrl } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { download, standaloneSvg, svgToPng } from "@/lib/files"
import { showAlert } from "@/lib/ui-state"

export function useExportActions(title: string, source: string, getSvg: () => SVGSVGElement | null) {
  const svg = () => {
    const el = getSvg()
    if (!el) throw new Error("Nothing to export yet.")
    return standaloneSvg(el)
  }
  // Say why when one fails (too big for a link, nothing rendered yet), rather than seeming to work.
  const guard = (run: () => unknown) => async () => {
    try {
      await run()
    } catch (e) {
      showAlert("Couldn’t export", e instanceof Error ? e.message : String(e))
    }
  }
  return {
    copyShareLink: guard(async () => {
      const url = shareUrl(location.origin, await encodeShare({ title, source }))
      await navigator.clipboard.writeText(url)
    }),
    copySvg: guard(() => navigator.clipboard.writeText(svg())),
    copyEmbed: guard(() =>
      navigator.clipboard.writeText(
        `<img alt="${title.replace(/"/g, "&quot;")}" src="data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg())))}">`
      )
    ),
    downloadSvg: guard(() => download(`${title}.svg`, svg(), "image/svg+xml")),
    downloadPng: guard(async () => download(`${title}.png`, await svgToPng(svg()))),
    downloadMmd: guard(() => download(`${title}.mmd`, source)),
  }
}

export function ExportMenu({ actions }: { actions: ReturnType<typeof useExportActions> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Download /> Export <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Share</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void actions.copyShareLink()}>
          <Link /> Copy share link <DropdownMenuShortcut>⌘⇧L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Download</DropdownMenuLabel>
        <DropdownMenuItem onSelect={actions.downloadSvg}>
          <FileImage /> SVG <DropdownMenuShortcut>.svg</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void actions.downloadPng()}>
          <Image /> PNG <DropdownMenuShortcut>2×</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.downloadMmd}>
          <FileCode /> Mermaid source <DropdownMenuShortcut>.mmd</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Clipboard</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void actions.copySvg()}>
          <Copy /> Copy SVG <DropdownMenuShortcut>⌘⇧C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void actions.copyEmbed()}>
          <Code /> Copy embed snippet
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

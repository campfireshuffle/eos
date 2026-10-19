import { useState, type ReactNode } from "react"

import { Input } from "@workspace/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

import { useEos } from "@/lib/eos"

const EMOJI: [string, string][] = [
  ["💼", "work briefcase"], ["⚙️", "gear settings backend"], ["💳", "card payments"], ["🐦", "bird"],
  ["📄", "doc page"], ["💡", "idea bulb"], ["🧪", "test lab"], ["🚀", "launch rocket"], ["🎯", "goal target"],
  ["📈", "chart growth"], ["🗂️", "folder files"], ["🧭", "compass"], ["🛠️", "tools"], ["🔒", "lock security"],
  ["🌱", "plant growth"], ["🎨", "art design"], ["🧩", "puzzle"], ["📦", "package box"], ["🔥", "fire hot"],
  ["⭐", "star"], ["🌙", "moon"], ["🪐", "planet"], ["🧠", "brain"], ["📚", "books learning"], ["🏠", "home personal"],
  ["✈️", "travel"], ["🎵", "music"], ["🐛", "bug"], ["☁️", "cloud"], ["🗄️", "database"],
]

export function TagEmojiPicker({ path, emoji, children }: { path: string; emoji: string | null; children: ReactNode }) {
  const eos = useEos()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const matches = EMOJI.filter(([e, words]) => !query || words.includes(query.toLowerCase()) || e === query)
  const choose = (value: string | null) => {
    void eos.setTagEmoji(path, value)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        // The trigger sits inside a nav link: stop the link from navigating, then toggle ourselves.
        // (Radix skips its own toggle when the event is default-prevented.)
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <span role="button" aria-label={`Change icon for ${path}`} className="flex size-4 items-center justify-center rounded hover:bg-accent">
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[272px] gap-2.5 p-3" onClick={(e) => e.stopPropagation()}>
        <Input autoFocus placeholder="Search emoji" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="grid grid-cols-8 gap-0.5">
          {matches.map(([e]) => (
            <button
              key={e}
              type="button"
              onClick={() => choose(e)}
              className="flex size-[30px] items-center justify-center rounded-md text-[17px] hover:bg-accent data-[on=true]:bg-accent"
              data-on={emoji === e}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="h-px bg-border" />
        <button type="button" onClick={() => choose(null)} className="flex items-center gap-2 px-1 text-left text-[13px] text-muted-foreground hover:text-foreground">
          <span className="font-mono text-sm">#</span> Use default icon
        </button>
      </PopoverContent>
    </Popover>
  )
}

import { useState } from "react"

import { Input } from "@workspace/ui/components/input"

const EMOJI: [string, string][] = [
  ["💼", "work briefcase"],
  ["⚙️", "gear settings backend"],
  ["💳", "card payments"],
  ["🐦", "bird"],
  ["📄", "doc page"],
  ["💡", "idea bulb"],
  ["🧪", "test lab"],
  ["🚀", "launch rocket"],
  ["🎯", "goal target"],
  ["📈", "chart growth"],
  ["🗂️", "folder files"],
  ["🧭", "compass"],
  ["🛠️", "tools"],
  ["🔒", "lock security"],
  ["🌱", "plant growth"],
  ["🎨", "art design"],
  ["🧩", "puzzle"],
  ["📦", "package box"],
  ["🔥", "fire hot"],
  ["⭐", "star"],
  ["🌙", "moon"],
  ["🪐", "planet"],
  ["🧠", "brain"],
  ["📚", "books learning"],
  ["🏠", "home personal"],
  ["✈️", "travel"],
  ["🎵", "music"],
  ["🐛", "bug"],
  ["☁️", "cloud"],
  ["🗄️", "database"],
]

/** Emoji choices for a tag's sidebar icon. */
export function EmojiGrid({ current, onChoose }: { current: string | null; onChoose: (emoji: string | null) => void }) {
  const [query, setQuery] = useState("")
  const matches = EMOJI.filter(([e, words]) => !query || words.includes(query.toLowerCase()) || e === query)
  return (
    <div className="flex flex-col gap-2.5">
      <Input autoFocus placeholder="Search emoji" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid grid-cols-8 gap-0.5">
        {matches.map(([e]) => (
          <button
            key={e}
            type="button"
            onClick={() => onChoose(e)}
            aria-pressed={current === e}
            className="flex size-[30px] items-center justify-center rounded-md text-title hover:bg-accent aria-pressed:bg-accent"
          >
            {e}
          </button>
        ))}
      </div>
      <div className="h-px bg-border" />
      <button
        type="button"
        onClick={() => onChoose(null)}
        className="flex items-center gap-2 px-1 text-left text-body text-muted-foreground hover:text-foreground"
      >
        <span className="font-mono text-body">#</span> Use default icon
      </button>
    </div>
  )
}

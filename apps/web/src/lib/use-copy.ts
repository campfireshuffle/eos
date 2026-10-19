import { useEffect, useRef, useState } from "react"

/** How long the "copied" check shows before the copy icon comes back. */
const SHOWN_MS = 1500

/** Copies text to the clipboard and reports `copied` briefly, for a check-mark confirmation. */
export function useCopy(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), SHOWN_MS)
    })
  }
  return [copied, copy]
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { dateBucket, relativeTime } from "./grouping"

/** A local time in October 2026. */
const oct = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

/** What a card says and the Date heading it sits under, for an edit at `edited` seen at `now`. */
function seen(edited: number, now: number) {
  vi.setSystemTime(now)
  return { card: relativeTime(edited), heading: dateBucket(edited)[1] }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("relativeTime agrees with the Date heading", () => {
  it("calls an edit made yesterday morning, seen late in the evening, Yesterday", () => {
    expect(seen(oct(14, 9), oct(15, 23))).toEqual({ card: "Yesterday", heading: "Yesterday" })
  })

  it("calls an edit made late two days ago, seen just after midnight, 2 days ago", () => {
    expect(seen(oct(13, 23), oct(15, 1))).toEqual({ card: "2 days ago", heading: "This week" })
  })

  it("counts an edit made earlier today in hours, however many", () => {
    expect(seen(oct(15, 0, 20), oct(15, 23, 55))).toEqual({ card: "23h ago", heading: "Today" })
  })
})

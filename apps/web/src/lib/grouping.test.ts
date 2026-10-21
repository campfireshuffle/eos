import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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

describe("relativeTime agrees with the Date heading across a daylight-saving change", () => {
  // Sets process.env.TZ, which Node applies to dates made from then on, and puts it back afterwards.
  beforeAll(() => {
    vi.stubEnv("TZ", "America/Los_Angeles")
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  /** A local time in Los Angeles, read once TZ is set. */
  const at = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month, day, hour, minute).getTime()

  it("runs in Los Angeles time", () => {
    expect(new Date(2026, 9, 1).getTimezoneOffset()).toBe(420)
  })

  it("calls an edit made late on the Saturday before clocks go forward, seen Monday, 2 days ago", () => {
    expect(seen(at(2, 7, 23, 30), at(2, 9, 10))).toEqual({ card: "2 days ago", heading: "This month" })
  })

  it("calls an edit made just after midnight on the day clocks go back, seen next morning, Yesterday", () => {
    expect(seen(at(10, 1, 0, 30), at(10, 2, 10))).toEqual({ card: "Yesterday", heading: "Yesterday" })
  })

  it("counts an edit made 24 hours earlier on the 25-hour day in hours, under Today", () => {
    expect(seen(at(10, 1, 0, 30), at(10, 1, 23, 50))).toEqual({ card: "24h ago", heading: "Today" })
  })
})

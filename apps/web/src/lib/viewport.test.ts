import { describe, expect, it } from "vitest"

import { clamp, fit, fitScale, holdCentre, panBy, zoomAt, type View } from "./viewport"

const pane = { w: 600, h: 400 }
/** Where the diagram point at (px, py) in the pane sits, in the diagram's own units. */
const pointAt = (v: View, px: number, py: number) => ({ x: (px - v.x) / v.k, y: (py - v.y) / v.k })

describe("fit", () => {
  it("shrinks a big diagram to the pane, less a margin, and centres it", () => {
    expect(fit(pane, { w: 1104, h: 100 })).toEqual({ k: 0.5, x: 24, y: 175 })
  })

  it("won't blow a small diagram up past 200%", () => {
    expect(fit(pane, { w: 50, h: 50 })).toEqual({ k: 2, x: 250, y: 150 })
  })

  it("honours a lower cap", () => {
    expect(fitScale(pane, { w: 50, h: 50 }, 1.25)).toBe(1.25)
    expect(fitScale(pane, { w: 1104, h: 100 }, 1.25)).toBe(0.5)
  })
})

describe("zoomAt", () => {
  it("keeps the diagram point under the pointer in place", () => {
    const v = { x: 37, y: -12, k: 1.1 }
    const before = pointAt(v, 300, 60)
    let z = v
    // Many small steps in and back out drift by nothing.
    for (let i = 0; i < 50; i++) z = zoomAt(z, z.k * 1.03, 300, 60)
    for (let i = 0; i < 50; i++) z = zoomAt(z, z.k / 1.03, 300, 60)
    expect(pointAt(z, 300, 60).x).toBeCloseTo(before.x, 9)
    expect(pointAt(z, 300, 60).y).toBeCloseTo(before.y, 9)
    expect(z.k).toBeCloseTo(1.1, 9)
  })

  it("stays between 10% and 800%", () => {
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 20, 0, 0).k).toBe(8)
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 0.01, 0, 0).k).toBe(0.1)
  })
})

describe("panBy", () => {
  it("moves the diagram without zooming", () => {
    expect(panBy({ x: 10, y: 20, k: 3 }, -5, 7)).toEqual({ x: 5, y: 27, k: 3 })
  })
})

describe("clamp", () => {
  const diagram = { w: 400, h: 300 }

  it("leaves a diagram that's in reach alone", () => {
    const v = { x: -100, y: 50, k: 2 }
    expect(clamp(v, pane, diagram)).toEqual(v)
  })

  it("keeps 40px of the diagram in the pane, however far it's panned", () => {
    expect(clamp({ x: -5000, y: 5000, k: 2 }, pane, diagram)).toEqual({ x: 40 - 800, y: 400 - 40, k: 2 })
    expect(clamp({ x: 5000, y: -5000, k: 2 }, pane, diagram)).toEqual({ x: 600 - 40, y: 40 - 600, k: 2 })
  })

  it("keeps all of a diagram smaller than that", () => {
    expect(clamp({ x: -50, y: 900, k: 1 }, pane, { w: 20, h: 10 })).toEqual({ x: 0, y: 390, k: 1 })
  })
})

describe("holding the centre", () => {
  it("keeps the point at the centre there as the pane resizes", () => {
    const v = { x: -120, y: 30, k: 1.5 }
    const to = { w: 900, h: 300 }
    const centre = pointAt(v, pane.w / 2, pane.h / 2)
    const held = pointAt(holdCentre(v, pane, to), to.w / 2, to.h / 2)
    expect(held.x).toBeCloseTo(centre.x, 9)
    expect(held.y).toBeCloseTo(centre.y, 9)
  })

  it("keeps it across a re-layout, which only changes the diagram's size", () => {
    const v = { x: -120, y: 30, k: 1.5 }
    expect(clamp(v, pane, { w: 900, h: 400 })).toEqual(v)
    expect(clamp(v, pane, { w: 600, h: 200 })).toEqual(v)
  })
})

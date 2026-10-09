/** Layout proof is independent of occlusion and Markdown readiness. A hit on any
 * panel child cannot prove that the approval controls still fit in the viewport. */
export interface ReviewRegion {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  isDestroyed: boolean
  getChildren?(): ReviewRegion[]
}

export interface ReviewLayout {
  width: number; height: number; fast: boolean
  panel?: ReviewRegion; heading?: ReviewRegion; rating?: ReviewRegion
  report?: ReviewRegion; footer?: ReviewRegion
}

export function reviewGeometry(input: ReviewLayout, footerContents = true): boolean {
  const { panel, heading, rating, report, footer } = input
  const fits = (region: ReviewRegion | undefined, parent: Pick<ReviewRegion, "x" | "y" | "width" | "height">): region is ReviewRegion =>
    !!region && !region.isDestroyed && region.visible
    && [region.x, region.y, region.width, region.height].every(Number.isFinite)
    && region.width > 0 && region.height > 0
    && region.x >= parent.x && region.y >= parent.y
    && region.x + region.width <= parent.x + parent.width
    && region.y + region.height <= parent.y + parent.height
  if (!fits(panel, { x: 0, y: 0, width: input.width, height: input.height })
    || !fits(heading, panel) || !fits(rating, panel)) return false
  if (input.fast) return true
  if (!fits(report, panel) || !fits(footer, panel)) return false
  if (!footerContents) return true
  // Footer buttons can wrap. Check their actual descendants rather than assuming
  // the container's minimum height guarantees accessible countdown/Cancel text.
  const childrenFit = (region: ReviewRegion): boolean => (region.getChildren?.() ?? [])
    .filter(child => child.visible && !child.isDestroyed)
    .every(child => fits(child, footer) && childrenFit(child))
  return childrenFit(footer)
}

/** A footer branch can be replaced synchronously before its next layout. Retain
 * only the painted proof for identical container geometry until the next frame;
 * otherwise zero-sized new children would cancel a valid Checking -> Allowing
 * transition. Viewport/container changes invalidate that proof immediately. */
export class ReviewGeometryProof {
  private painted?: { regions: (ReviewRegion | undefined)[]; bounds: number[] }
  visible(input: ReviewLayout, frame = false): boolean {
    const regions = [input.panel, input.heading, input.rating, ...(input.fast ? [] : [input.report, input.footer])]
    const bounds = [input.width, input.height, ...regions.flatMap(region => region
      ? [region.x, region.y, region.width, region.height] : [])]
    if (frame) this.painted = reviewGeometry(input) ? { regions, bounds } : undefined
    return reviewGeometry(input, false) && !!this.painted
      && regions.length === this.painted.regions.length && regions.every((region, i) => region === this.painted!.regions[i])
      && bounds.length === this.painted.bounds.length && bounds.every((value, i) => value === this.painted!.bounds[i])
  }
}

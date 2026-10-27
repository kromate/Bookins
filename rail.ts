// Time-rail layout helpers (pure). Bookings that overlap in time are placed side by side in columns instead of on top of
// each other, so parallel bookings (two team members, or back-to-back short appointments) all stay visible and clickable.

export interface RailSpan<T> { start: number; end: number; item: T }
export interface PlacedSpan<T> extends RailSpan<T> { column: number; columns: number }

/**
 * Greedy interval partitioning. Spans are grouped into clusters of transitively overlapping spans; each span takes the
 * first free column in its cluster, and every span in a cluster shares the cluster's column count.
 * `start` and `end` are minutes (or any comparable numbers); a span ending exactly when another starts does not overlap.
 */
export function placeSpans<T>(spans: RailSpan<T>[], minimumLength = 0): PlacedSpan<T>[] {
  const sorted = [...spans]
    .map((span) => ({ ...span, end: Math.max(span.end, span.start + minimumLength) }))
    .sort((left, right) => left.start - right.start || right.end - left.end)
  const placed: PlacedSpan<T>[] = []
  let cluster: PlacedSpan<T>[] = []
  let columnEnds: number[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY
  const closeCluster = () => {
    for (const span of cluster) span.columns = Math.max(1, columnEnds.length)
    placed.push(...cluster)
    cluster = []
    columnEnds = []
  }
  for (const span of sorted) {
    if (cluster.length && span.start >= clusterEnd) closeCluster()
    let column = columnEnds.findIndex((end) => end <= span.start)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(span.end)
    } else columnEnds[column] = span.end
    cluster.push({ ...span, column, columns: 1 })
    clusterEnd = cluster.length === 1 ? span.end : Math.max(clusterEnd, span.end)
  }
  if (cluster.length) closeCluster()
  return placed
}

/** How much text a booking drawn to scale can hold: under 45 minutes one line, under 75 minutes a short block. */
export type SpanSize = 'short' | 'medium' | 'long'
export const spanSize = (minutes: number): SpanSize => (minutes < 45 ? 'short' : minutes < 75 ? 'medium' : 'long')

/** Hour marks from `firstHour` to `lastHour` inclusive. */
export const hourMarks = (firstHour: number, lastHour: number) =>
  Array.from({ length: Math.max(1, lastHour - firstHour + 1) }, (_, index) => firstHour + index)

/** Minutes since local midnight from an "HH:MM" string; NaN when unreadable. */
export function minutesOf(clock: string) {
  const [hours = Number.NaN, minutes = Number.NaN] = String(clock).split(':').map(Number)
  return hours * 60 + minutes
}

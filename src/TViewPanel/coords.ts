/**
 * Inverse of the column layout built by buildTviewMsa: the alignment emits each
 * reference position's insertion columns followed by its reference column, so a
 * flat column -> reference position array recovers the mapping.
 */
export function buildColumnToRefPos({
  start,
  end,
  insertionWidths,
}: {
  start: number
  end: number
  insertionWidths: [number, number][]
}) {
  const widths = new Map(insertionWidths)
  const ret: number[] = []
  for (let pos = start; pos < end; pos++) {
    const width = widths.get(pos) ?? 0
    for (let i = 0; i < width; i++) {
      ret.push(pos)
    }
    ret.push(pos)
  }
  return ret
}

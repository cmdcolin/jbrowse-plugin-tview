import { BamFile } from '@gmod/bam'
import { describe, expect, it } from 'vitest'

import { buildTviewMsa } from '../src/LaunchTView/tview'
import { buildColumnToRefPos } from '../src/TViewPanel/coords'

// volvox-sorted-altname.bam names its only contig 'contigA' (the demo config
// maps it back to ctgA via refNameAliases)
const REF = 'contigA'
// 19 reads carry a 1bp insertion at this reference position while other reads
// span it without one, which is the case row alignment has to get right
const INS_POS = 15163
const START = 15100
const END = 15250

// @gmod/bam exposes plain properties; JBrowse's BamAdapter wraps them in a
// Feature with .get(), which is what buildTviewMsa consumes
async function fetchReads(refName: string, start: number, end: number) {
  const bam = new BamFile({
    bamPath: 'public/volvox-sorted-altname.bam',
    baiPath: 'public/volvox-sorted-altname.bam.bai',
  })
  await bam.getHeader()
  const records = await bam.getRecordsForRange(refName, start, end)
  return records
    .filter(r => !!r.seq)
    .map(r => ({ get: (key: string) => r[key as keyof typeof r] }))
}

function parseMsa(msa: string) {
  const lines = msa.trim().split('\n')
  return lines.reduce<{ name: string; seq: string }[]>(
    (acc, line, i) =>
      line.startsWith('>')
        ? [...acc, { name: line.slice(1), seq: lines[i + 1] ?? '' }]
        : acc,
    [],
  )
}

describe('buildTviewMsa on volvox-sorted-altname.bam', () => {
  it('lays real reads out with equal-length rows', async () => {
    const features = await fetchReads(REF, START, END)
    expect(features.length).toBeGreaterThan(0)

    const { msa, insertionWidths, region } = buildTviewMsa({
      features,
      refName: REF,
      start: START,
      end: END,
    })
    const rows = parseMsa(msa)
    expect(rows.length).toBe(features.length)

    // the whole point of tview: every row is the same width, so reference
    // columns line up regardless of what each read inserts
    expect(new Set(rows.map(r => r.seq.length)).size).toBe(1)

    // that width is the region width plus one column per inserted base
    const extra = insertionWidths.reduce((a, [, w]) => a + w, 0)
    expect(rows[0]!.seq.length).toBe(END - START + extra)

    // the column -> reference position map spans exactly those columns
    expect(buildColumnToRefPos({ ...region, insertionWidths }).length).toBe(
      rows[0]!.seq.length,
    )
  })

  it('gives the insertion its own column and pads reads lacking it', async () => {
    const features = await fetchReads(REF, START, END)
    const { msa, insertionWidths, region } = buildTviewMsa({
      features,
      refName: REF,
      start: START,
      end: END,
    })

    expect(insertionWidths).toContainEqual([INS_POS, 1])

    // locate the single insertion column belonging to INS_POS: it is the first
    // column mapping to INS_POS, since insertion columns precede the ref column
    const colToRefPos = buildColumnToRefPos({ ...region, insertionWidths })
    const insCol = colToRefPos.indexOf(INS_POS)
    expect(colToRefPos[insCol + 1]).toBe(INS_POS)

    const chars = parseMsa(msa).map(r => r.seq[insCol])
    // reads with the insertion contribute a base; reads that merely span the
    // position contribute '-'; reads not covering it contribute '.'
    expect(chars.filter(c => c !== undefined && /[ACGTN]/.test(c)).length).toBe(
      19,
    )
    expect(chars.some(c => c === '-')).toBe(true)
    expect(new Set(chars).size).toBeGreaterThan(1)
  })

  it('maps an insertion column back to its reference position', async () => {
    const features = await fetchReads(REF, START, END)
    const { insertionWidths, region } = buildTviewMsa({
      features,
      refName: REF,
      start: START,
      end: END,
    })
    const colToRefPos = buildColumnToRefPos({ ...region, insertionWidths })
    // an insertion column resolves to the reference position it sits before,
    // which is what drives the genome-view highlight
    expect(colToRefPos[colToRefPos.indexOf(INS_POS)]).toBe(INS_POS)
    expect(colToRefPos[0]).toBe(START)
    expect(colToRefPos.at(-1)).toBe(END - 1)
  })
})

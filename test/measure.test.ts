import { expect, test } from 'vitest'

import { referenceReader } from '../scripts/lib/measure.mjs'

const FASTA = new URL('fixtures/tiny.fa', import.meta.url).pathname

// tiny.fa is 500 random bases wrapped at 60, so a slice that spans two lines
// is the case a fasta reader gets wrong
test('reads reference bases out of an indexed fasta', async () => {
  const read = referenceReader({ fasta: FASTA })
  await expect(
    read({ chrom: 'chr1', refName: '1', start: 100, end: 140 }),
  ).resolves.toBe('CCAGAAAATAGCGACGGACCGCGGTGTTAAGTGTCGAGCT')
})

// the BAM's name for a sequence is what a fasta it was aligned to will carry,
// but a locus is ordinarily written in UCSC's, and either has to reach it
test('takes either name the locus carries', async () => {
  const read = referenceReader({ fasta: FASTA })
  const byChrom = await read({
    chrom: 'chr1',
    refName: '1',
    start: 0,
    end: 10,
  })
  await expect(
    read({ chrom: 'nope', refName: 'chr1', start: 0, end: 10 }),
  ).resolves.toBe(byChrom)
})

test('says which names it has when neither is in the index', async () => {
  const read = referenceReader({ fasta: FASTA })
  await expect(
    read({ chrom: 'chrZ', refName: 'Z', start: 0, end: 10 }),
  ).rejects.toThrow(/no sequence named Z or chrZ.*including chr1/)
})

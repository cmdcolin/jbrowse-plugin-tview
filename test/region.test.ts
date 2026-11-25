import { describe, expect, it } from 'vitest'

import { volvox } from './fakeSession'
import { checkRegion } from '../src/TViewPanel/init'

describe('checkRegion', () => {
  it('names the sequence the way the assembly does, not the alias', () => {
    expect(checkRegion(volvox, 'A:1..100')).toEqual({
      region: { assemblyName: 'volvox', refName: 'ctgA', start: 0, end: 100 },
    })
  })

  it('clamps a region that runs off the end of the contig', () => {
    expect(checkRegion(volvox, 'ctgB:6000..7000').region).toEqual({
      assemblyName: 'volvox',
      refName: 'ctgB',
      start: 5999,
      end: 6079,
    })
  })

  it('takes a bare refName as the whole contig', () => {
    expect(checkRegion(volvox, 'ctgB').region).toEqual({
      assemblyName: 'volvox',
      refName: 'ctgB',
      start: 0,
      end: 6079,
    })
  })

  it('rejects a region wider than MAX_BP, saying so', () => {
    expect(checkRegion(volvox, 'ctgA:1..30000')).toEqual({
      error: 'Region is 30,000bp, wider than the 20,000bp limit',
    })
  })

  it('holds a bare refName to the same limit', () => {
    expect(checkRegion(volvox, 'ctgA').error).toMatch(/50,001bp, wider/)
  })

  it('rejects a region entirely past the end of the contig', () => {
    expect(checkRegion(volvox, 'ctgB:7000..7100').error).toMatch(
      /lies outside ctgB, which is 6,079bp/,
    )
  })

  it('turns an unknown refName into an error instead of throwing', () => {
    expect(checkRegion(volvox, 'chr4:1..100').error).toMatch(
      /unknown reference sequence name/,
    )
  })

  it('turns a malformed locstring into an error instead of throwing', () => {
    expect(checkRegion(volvox, 'ctgA:one..two').error).toBeDefined()
    expect(checkRegion(volvox, '').error).toMatch(/no location string/)
  })
})

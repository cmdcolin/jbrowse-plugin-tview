import type { LocAssembly } from '../src/TViewPanel/init'

const aliases: Record<string, string> = {
  ctgA: 'ctgA',
  A: 'ctgA',
  contigA: 'ctgA',
  ctgB: 'ctgB',
}
const lengths: Record<string, number> = { ctgA: 50_001, ctgB: 6_079 }

export const volvox: LocAssembly & {
  initialized: boolean
  error: unknown
  getSeqAdapterRefName: (refName: string) => string
} = {
  name: 'volvox',
  initialized: true,
  error: undefined,
  isValidRefName: refName => refName in aliases,
  getCanonicalRefName2: refName => aliases[refName] ?? refName,
  getRegionForRefName: refName =>
    refName in lengths
      ? { refName, start: 0, end: lengths[refName]! }
      : undefined,
  getSeqAdapterRefName: refName => refName,
}

export function fakeSession(trackIds: string[]) {
  return {
    views: [],
    assemblies: [],
    assemblyManager: {
      get: (name: string) => (name === 'volvox' ? volvox : undefined),
    },
    getTrackById: (trackId: string) =>
      trackIds.includes(trackId)
        ? {
            trackId,
            type: 'AlignmentsTrack',
            name: `${trackId}.bam`,
            adapter: { type: 'BamAdapter' },
          }
        : undefined,
  }
}

import { getConf } from '@jbrowse/core/configuration'
import { assembleLocString, getSession } from '@jbrowse/core/util'
import { getRpcSessionId } from '@jbrowse/core/util/tracks'
import useSWR from 'swr'

import { planTviewMsa } from './tview'

import type { AbstractTrackModel, Feature } from '@jbrowse/core/util'

/** the RPC needs assemblyName to resolve refNameAliases for the file */
export interface FetchRegion {
  assemblyName: string
  refName: string
  start: number
  end: number
}

const staticSwrConfig = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
  shouldRetryOnError: false,
}

async function fetcher({
  model,
  region,
}: {
  model: AbstractTrackModel
  region: FetchRegion
}) {
  const { rpcManager } = getSession(model)
  const sessionId = getRpcSessionId(model)
  const feats = (await rpcManager.call(sessionId, 'CoreGetFeatures', {
    adapterConfig: getConf(model, 'adapter'),
    sessionId,
    regions: [region],
  })) as Feature[]
  const features = feats.filter(f => !!f.get('seq'))
  // only planned, not rendered: the dialog just reports on the alignment, and
  // the caller may well cancel or find it too large to be worth building
  return {
    plan: planTviewMsa({ features, ...region }),
    rowCount: features.length,
  }
}

export function useTviewMsa({
  model,
  region,
}: {
  model: AbstractTrackModel
  region?: FetchRegion
}) {
  const { data, error, isLoading } = useSWR(
    region ? [assembleLocString(region), model.id, 'tview'] : null,
    () => fetcher({ model, region: region! }),
    staticSwrConfig,
  )
  return { data, error, isLoading }
}

import { getConf } from '@jbrowse/core/configuration'
import { assembleLocString, getSession } from '@jbrowse/core/util'
import { getRpcSessionId } from '@jbrowse/core/util/tracks'
import useSWR from 'swr'

import { buildTviewMsa } from './tview'

import type { IRegion } from '../TViewPanel/model'
import type { AbstractTrackModel, Feature } from '@jbrowse/core/util'

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
  region: IRegion
}) {
  const { rpcManager } = getSession(model)
  const sessionId = getRpcSessionId(model)
  const feats = (await rpcManager.call(sessionId, 'CoreGetFeatures', {
    adapterConfig: getConf(model, 'adapter'),
    sessionId,
    regions: [region],
  })) as Feature[]
  const features = feats.filter(f => !!f.get('seq'))
  return {
    ...buildTviewMsa({ features, ...region }),
    rowCount: features.length,
  }
}

export function useTviewMsa({
  model,
  region,
}: {
  model: AbstractTrackModel
  region?: IRegion
}) {
  const { data, error, isLoading } = useSWR(
    region ? [assembleLocString(region), model.id, 'tview'] : null,
    () => fetcher({ model, region: region! }),
    staticSwrConfig,
  )
  return { data, error, isLoading }
}

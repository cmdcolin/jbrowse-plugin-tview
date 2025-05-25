import React from 'react'

import HighlightComponents from './HighlightComponents'

import type PluginManager from '@jbrowse/core/PluginManager'
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

// locals

export default function AddHighlightComponentsModelF(
  pluginManager: PluginManager,
) {
  pluginManager.addToExtensionPoint(
    'LinearGenomeView-TracksContainerComponent',
    // @ts-expect-error
    (
      rest: React.ReactNode[] = [],
      { model }: { model: LinearGenomeViewModel },
    ) => {
      return [
        ...rest,
        <HighlightComponents
          key="highlight_protein_viewer_msaview"
          model={model}
        />,
      ]
    },
  )
}

import React from 'react'

import { getSession } from '@jbrowse/core/util'

import HighlightComponents from './HighlightComponents'
import { isTView } from '../TViewPanel/model'

import type PluginManager from '@jbrowse/core/PluginManager'

export default function AddHighlightComponentsModelF(
  pluginManager: PluginManager,
) {
  pluginManager.contributeToExtensionPoint(
    'LinearGenomeView-TracksContainerComponent',
    ({ model }) =>
      getSession(model).views.some(
        v => isTView(v) && v.connectedViewId === model.id,
      ) ? (
        <HighlightComponents key="tview_highlights" model={model} />
      ) : undefined,
  )
}

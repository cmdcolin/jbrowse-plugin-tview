import { lazy } from 'react'

import ViewType from '@jbrowse/core/pluggableElementTypes/ViewType'

// locals
import stateModelFactory from './model'

import type PluginManager from '@jbrowse/core/PluginManager'

// lazies
const TViewPanel = lazy(() => import('./components/TViewPanel'))

export default function TViewF(pluginManager: PluginManager) {
  pluginManager.addViewType(() => {
    return new ViewType({
      name: 'TView',
      stateModel: stateModelFactory(),
      ReactComponent: TViewPanel,
    })
  })
}

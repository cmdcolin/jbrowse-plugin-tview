import { lazy } from 'react'
import PluginManager from '@jbrowse/core/PluginManager'
import ViewType from '@jbrowse/core/pluggableElementTypes/ViewType'

// locals
import stateModelFactory from './model'

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

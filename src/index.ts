import Plugin from '@jbrowse/core/Plugin'
import PluginManager from '@jbrowse/core/PluginManager'
// locals
import { version } from '../package.json'
import TViewF from './TViewPanel'
import LaunchTViewF from './LaunchTView'
import AddHighlightModelF from './AddHighlightModel'

export default class TViewPlugin extends Plugin {
  name = 'TViewPlugin'
  version = version

  install(pluginManager: PluginManager) {
    TViewF(pluginManager)
    LaunchTViewF(pluginManager)
    AddHighlightModelF(pluginManager)
  }

  configure(pluginManager: PluginManager) {}
}

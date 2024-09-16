import PluginManager from '@jbrowse/core/PluginManager'
import DisplayType from '@jbrowse/core/pluggableElementTypes/DisplayType'
import { PluggableElementType } from '@jbrowse/core/pluggableElementTypes'
import { IAnyModelType } from 'mobx-state-tree'
import { getSession, getContainingTrack } from '@jbrowse/core/util'

// icons
import AddIcon from '@mui/icons-material/Add'

// locals
import LaunchTViewDialog from './components/LaunchTViewDialog'
import { MenuItem } from '@jbrowse/core/ui'

function isDisplay(elt: { name: string }): elt is DisplayType {
  return elt.name === 'LinearPileupDisplay'
}

function extendStateModel(stateModel: IAnyModelType) {
  return stateModel.views((self: { trackMenuItems: () => MenuItem[] }) => {
    const superTrackMenuItems = self.trackMenuItems
    return {
      trackMenuItems() {
        const track = getContainingTrack(self)
        return [
          ...superTrackMenuItems(),
          {
            label: 'Launch tview for visible region',
            icon: AddIcon,
            onClick: () => {
              getSession(track).queueDialog(handleClose => [
                LaunchTViewDialog,
                {
                  model: track,
                  handleClose,
                },
              ])
            },
          },
        ]
      },
    }
  })
}

export default function LaunchTViewF(pluginManager: PluginManager) {
  pluginManager.addToExtensionPoint(
    'Core-extendPluggableElement',
    (elt: PluggableElementType) => {
      if (isDisplay(elt)) {
        elt.stateModel = extendStateModel(elt.stateModel)
      }
      return elt
    },
  )
}

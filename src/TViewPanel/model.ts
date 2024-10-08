import { Instance, cast, types } from 'mobx-state-tree'
import { autorun } from 'mobx'
import { MSAModelF } from 'react-msaview'
import { getSession } from '@jbrowse/core/util'
import { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'
import { BaseViewModel } from '@jbrowse/core/pluggableElementTypes'

// locals

type LGV = LinearGenomeViewModel

type MaybeLGV = LGV | undefined

export interface IRegion {
  refName: string
  start: number
  end: number
}

/**
 * #stateModel TViewPlugin
 * extends
 * - MSAModel from https://github.com/GMOD/react-msaview
 */
export default function stateModelFactory() {
  return types
    .compose(
      'TView',
      BaseViewModel,
      MSAModelF(),
      types.model({
        type: types.literal('TView'),
        /**
         * #property
         */
        connectedViewId: types.maybe(types.string),
        /**
         * #property
         */
        connectedFeature: types.frozen(),
        /**
         * #property
         */
        connectedHighlights: types.array(
          types.model({
            refName: types.string,
            start: types.number,
            end: types.number,
          }),
        ),

        /**
         * #property
         */
        zoomToBaseLevel: false,
      }),
    )
    .views(self => ({
      /**
       * #method
       */
      ungappedCoordMap(rowName: string, position: number) {
        const row = self.rows.find(f => f[0] === rowName)
        const seq = row?.[1]
        if (seq && position < seq.length) {
          let i = 0
          let j = 0
          for (; j < position; j++, i++) {
            while (seq[i] === '-') {
              i++
            }
          }
          return i
        }
        return undefined
      },
    }))

    .views(self => ({
      /**
       * #getter
       */
      get clickCol2() {
        return undefined
      },
    }))

    .views(self => ({
      /**
       * #getter
       */
      get connectedView() {
        const { views } = getSession(self)
        return views.find(f => f.id === self.connectedViewId) as MaybeLGV
      },
    }))
    .actions(self => ({
      /**
       * #action
       */
      setZoomToBaseLevel(arg: boolean) {
        self.zoomToBaseLevel = arg
      },
      /**
       * #action
       */
      setConnectedHighlights(r: IRegion[]) {
        self.connectedHighlights = cast(r)
      },
      /**
       * #action
       */
      addToConnectedHighlights(r: IRegion) {
        self.connectedHighlights.push(r)
      },
      /**
       * #action
       */
      clearConnectedHighlights() {
        self.connectedHighlights = cast([])
      },
    }))

    .views(self => ({
      /**
       * #method
       * overrides base
       */
      extraViewMenuItems() {
        return [
          {
            label: 'Zoom to base level on click?',
            checked: self.zoomToBaseLevel,
            type: 'checkbox',
            onClick: () => {
              self.setZoomToBaseLevel(!self.zoomToBaseLevel)
            },
          },
        ]
      },

      /**
       * #getter
       */
      get connectedView() {
        const { views } = getSession(self)
        return views.find(f => f.id === self.connectedViewId) as MaybeLGV
      },
    }))

    .actions(self => ({
      afterCreate() {
        //
        // // this adds highlights to the genome view when mouse-ing over the MSA
        // addDisposer(
        //   self,
        //   autorun(() => {
        //     const { mouseCol, mouseClickCol } = self
        //     const r1 =
        //       mouseCol === undefined
        //         ? undefined
        //         : msaCoordToGenomeCoord({ model: self, coord: mouseCol })
        //     const r2 =
        //       mouseClickCol === undefined
        //         ? undefined
        //         : msaCoordToGenomeCoord({ model: self, coord: mouseClickCol })
        //     self.setConnectedHighlights([r1, r2].filter(f => !!f))
        //   }),
        // )
        //
        // // nav to genome position after click
        // addDisposer(
        //   self,
        //   autorun(() => {
        //     const { connectedView, zoomToBaseLevel, mouseClickCol } = self
        //     const { assemblyManager } = getSession(self)
        //     const r2 =
        //       mouseClickCol === undefined
        //         ? undefined
        //         : msaCoordToGenomeCoord({ model: self, coord: mouseClickCol })
        //
        //     if (!r2 || !connectedView) {
        //       return
        //     }
        //
        //     if (zoomToBaseLevel) {
        //       connectedView.navTo(r2)
        //     } else {
        //       const r =
        //         assemblyManager
        //           .get(connectedView.assemblyNames[0]!)
        //           ?.getCanonicalRefName(r2.refName) ?? r2.refName
        //       connectedView.centerAt(r2.start, r)
        //     }
        //   }),
        // )
      },
    }))
}

export type JBrowsePluginTViewStateModel = ReturnType<typeof stateModelFactory>
export type JBrowsePluginTViewModel = Instance<JBrowsePluginTViewStateModel>

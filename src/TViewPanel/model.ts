import { BaseViewModel } from '@jbrowse/core/pluggableElementTypes'
import { getSession } from '@jbrowse/core/util'
import { types } from '@jbrowse/mobx-state-tree'
import { MSAModelF } from 'react-msaview'

import { buildColumnToRefPos } from './coords'

import type { Instance } from '@jbrowse/mobx-state-tree'
import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

// re-exported so the inferred (composed) state-model type can name mobx's
// IKeyValueMap when emitting declarations (avoids TS2883 portability error)
export type { IKeyValueMap } from 'mobx'

type MaybeLGV = LinearGenomeViewModel | undefined

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
         * LGV this pileup was launched from; drives highlights and click-to-nav
         */
        connectedViewId: types.maybe(types.string),
        /**
         * #property
         * reference region the alignment columns span
         */
        msaRegion: types.frozen<IRegion | undefined>(),
        /**
         * #property
         * [refPos, width] for every position where some read has an insertion
         */
        insertionWidths: types.frozen<[number, number][]>([]),
        /**
         * #property
         */
        zoomToBaseLevel: types.optional(types.boolean, false),
      }),
    )
    .views(self => ({
      /**
       * #getter
       */
      get columnToRefPos() {
        const { msaRegion, insertionWidths } = self
        return msaRegion
          ? buildColumnToRefPos({ ...msaRegion, insertionWidths })
          : undefined
      },
      /**
       * #getter
       */
      get connectedView() {
        const { views } = getSession(self)
        return views.find(f => f.id === self.connectedViewId) as MaybeLGV
      },
    }))
    .views(self => ({
      /**
       * #method
       */
      colToGenomeRegion(col: number): IRegion | undefined {
        const { columnToRefPos, msaRegion } = self
        const pos = columnToRefPos?.[col]
        return msaRegion && pos !== undefined
          ? { refName: msaRegion.refName, start: pos, end: pos + 1 }
          : undefined
      },
    }))
    .views(self => ({
      /**
       * #getter
       * regions the connected LGV highlights: the hovered column plus the
       * sticky clicked column
       */
      get connectedHighlights() {
        const { mouseCol, mouseClickCol } = self
        return [mouseCol, mouseClickCol]
          .filter((col): col is number => col !== undefined)
          .map(col => self.colToGenomeRegion(col))
          .filter((r): r is IRegion => r !== undefined)
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
      navToColumn(col: number) {
        const { connectedView, zoomToBaseLevel } = self
        const r = self.colToGenomeRegion(col)
        if (r && connectedView) {
          if (zoomToBaseLevel) {
            connectedView.navTo(r)
          } else {
            connectedView.centerAt(r.start, r.refName)
          }
        }
      },
    }))
    .actions(self => {
      const superSetMouseClickPos = self.setMouseClickPos.bind(self)
      return {
        /**
         * #action
         */
        setMouseClickPos(col?: number, row?: number) {
          superSetMouseClickPos(col, row)
          if (col !== undefined) {
            self.navToColumn(col)
          }
        },
      }
    })
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
    }))
}

export type JBrowsePluginTViewStateModel = ReturnType<typeof stateModelFactory>
export type JBrowsePluginTViewModel = Instance<JBrowsePluginTViewStateModel>

export function isTView(view: {
  type: string
}): view is JBrowsePluginTViewModel {
  return view.type === 'TView'
}

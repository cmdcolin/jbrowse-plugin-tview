import { BaseViewModel } from '@jbrowse/core/pluggableElementTypes'
import { getSession } from '@jbrowse/core/util'
import { addDisposer, isAlive, types } from '@jbrowse/mobx-state-tree'
import { autorun } from 'mobx'
import { MSAModelF } from 'react-msaview'

import { buildColumnToRefPos, renderedColToMsaCol } from './coords'
import { initRegion, initSources, missingTrackIds } from './init'
import { fetchTviewPlan } from '../LaunchTView/fetchTviewPlan'
import { MAX_CELLS } from '../LaunchTView/limits'

import type { TviewInit } from './init'
import type { FetchRegion, TviewSource } from '../LaunchTView/fetchTviewPlan'
import type { MenuItem } from '@jbrowse/core/ui'
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

export type { TviewInit } from './init'

/** the load the view last started, and the `init` it was started for */
export type LoadState = { key: string } & (
  | { status: 'loading' }
  | { status: 'loaded' }
  | { status: 'failed'; error: unknown }
)

/** what the panel shows in place of the alignment, or that it shows it */
export type TViewState =
  | { kind: 'alignment' }
  | { kind: 'loading'; message: string }
  | { kind: 'notice'; message: string }
  | { kind: 'error'; error: unknown; retry: boolean }

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
         * what the view is: a locus, an assembly and the alignment files to
         * read it from. Everything else here is derived from it — see
         * `./init.ts` for why this one is kept rather than cleared
         */
        init: types.frozen<TviewInit | undefined>(),
        /**
         * #property
         * reference region the alignment columns span, filled in by the load
         */
        msaRegion: types.frozen<IRegion | undefined>(),
        /**
         * #property
         * [refPos, width] for every position where some read has an insertion
         */
        insertionWidths: types.frozen<[number, number][]>([]),
        /**
         * #property
         * [start, end, columns] for every tandem array laid out per copy
         */
        arraySpans: types.frozen<[number, number, number][]>([]),
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
        const { msaRegion, insertionWidths, arraySpans } = self
        return msaRegion
          ? buildColumnToRefPos({ ...msaRegion, insertionWidths, arraySpans })
          : undefined
      },
      /**
       * #getter
       */
      get connectedView() {
        const { views } = getSession(self)
        return views.find(f => f.id === self.connectedViewId) as MaybeLGV
      },
      /**
       * #getter
       * the region `init.loc` names, once the assembly can parse it
       */
      get initRegion() {
        return self.init ? initRegion(getSession(self), self.init) : undefined
      },
      /**
       * #getter
       * the alignment files `init.tracks` names, once every one resolves. The
       * configs are read rather than the track models, so a tview outlives the
       * tracks it was launched from being closed.
       */
      get initSources() {
        return self.init ? initSources(getSession(self), self.init) : undefined
      },
      /**
       * #getter
       * what a load is keyed on: two inits that say the same thing are one
       */
      get initKey() {
        return self.init ? JSON.stringify(self.init) : undefined
      },
    }))
    .views(self => ({
      /**
       * #method
       */
      colToGenomeRegion(col: number): IRegion | undefined {
        const { columnToRefPos, msaRegion, blanks } = self
        const pos = columnToRefPos?.[renderedColToMsaCol(blanks, col)]
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
        const regions = [mouseCol, mouseClickCol]
          .filter((col): col is number => col !== undefined)
          .map(col => self.colToGenomeRegion(col))
          .filter((r): r is IRegion => r !== undefined)
        // an insertion column and its reference column resolve to the same
        // position, so deduping by column would still stack two identical bands
        return [
          ...new Map(regions.map(r => [`${r.refName}:${r.start}`, r])).values(),
        ]
      },
    }))
    .volatile(() => ({
      loadState: undefined as LoadState | undefined,
    }))
    .views(self => ({
      /**
       * #getter
       * the load state of the current `init`, not of one it replaced
       */
      get currentLoad() {
        const { loadState, initKey } = self
        return loadState?.key === initKey ? loadState : undefined
      },
    }))
    .views(self => ({
      /**
       * #getter
       * why `init` cannot be loaded yet, or undefined once it can
       */
      get initBlocker(): TViewState | undefined {
        const { init, initRegion } = self
        const session = getSession(self)
        const assembly = init
          ? session.assemblyManager.get(init.assembly)
          : undefined
        const missing = init ? missingTrackIds(session, init) : []
        return !init
          ? { kind: 'notice', message: 'This view names no region to load' }
          : assembly?.error
            ? { kind: 'error', error: assembly.error, retry: false }
            : !initRegion
              ? {
                  kind: 'loading',
                  message: `Waiting for assembly ${init.assembly}`,
                }
              : initRegion.error !== undefined
                ? { kind: 'error', error: initRegion.error, retry: false }
                : missing.length
                  ? {
                      kind: 'error',
                      error: `No track in this session has the id ${missing.join(', ')}`,
                      retry: false,
                    }
                  : undefined
      },
    }))
    .views(self => ({
      /**
       * #getter
       */
      get viewState(): TViewState {
        const { init, data, currentLoad, initBlocker } = self
        const loadState: TViewState =
          currentLoad?.status === 'failed'
            ? { kind: 'error', error: currentLoad.error, retry: true }
            : currentLoad?.status === 'loaded'
              ? data.msa
                ? { kind: 'alignment' }
                : {
                    kind: 'notice',
                    message: 'The region has no reference sequence or reads',
                  }
              : {
                  kind: 'loading',
                  message: 'Building alignment from track data',
                }
        return !init && data.msa
          ? { kind: 'alignment' }
          : (initBlocker ?? loadState)
      },
    }))
    .actions(self => ({
      /**
       * #action
       */
      setLoadState(arg?: LoadState) {
        self.loadState = arg
      },
      /**
       * #action
       */
      setInit(arg?: TviewInit) {
        self.init = arg
      },
      /**
       * #action
       * forget a failed load, so the view tries its `init` again
       */
      retryLoad() {
        self.loadState = undefined
      },
      /**
       * #action
       */
      setMsaData(result: {
        msa: string
        tree?: string
        insertionWidths: [number, number][]
        arraySpans: [number, number, number][]
        region: IRegion
      }) {
        self.msaRegion = result.region
        self.insertionWidths = result.insertionWidths
        self.arraySpans = result.arraySpans
        self.data.setMSA(result.msa)
        self.data.setTree(result.tree)
      },
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
      let controller: AbortController | undefined
      return {
        /**
         * #action
         * builds the alignment `init` describes, from whatever `init`
         * describes it over. The one way an alignment ever gets here. A result
         * for an `init` that is no longer current, or for a view that has been
         * closed, is dropped.
         */
        async load(key: string, region: FetchRegion, sources: TviewSource[]) {
          controller?.abort()
          const own = new AbortController()
          controller = own
          const current = () =>
            controller === own && isAlive(self) && self.initKey === key
          self.setLoadState({ key, status: 'loading' })
          try {
            const result = await fetchTviewPlan({
              session: getSession(self),
              sources,
              region,
              signal: own.signal,
            })
            if (current()) {
              if (result.tooLarge) {
                self.setLoadState({
                  key,
                  status: 'failed',
                  error: `The alignment is ${result.cellCount.toLocaleString('en-US')} cells, above the ${MAX_CELLS.toLocaleString('en-US')} limit`,
                })
              } else {
                self.setMsaData(result)
                self.setLoadState({ key, status: 'loaded' })
              }
            }
          } catch (error) {
            if (current()) {
              console.error(error)
              self.setLoadState({ key, status: 'failed', error })
            }
          }
        },
        beforeDestroy() {
          controller?.abort()
        },
      }
    })
    .actions(self => ({
      afterCreate() {
        self.setImportForm(false)
        const { initKey } = self
        if (initKey && self.data.msa) {
          self.setLoadState({ key: initKey, status: 'loaded' })
        }
        addDisposer(
          self,
          autorun(() => {
            const { initKey, initRegion, initSources, loadState } = self
            if (
              initKey &&
              loadState?.key !== initKey &&
              initRegion?.region &&
              initSources
            ) {
              void self.load(initKey, initRegion.region, initSources)
            }
          }),
        )
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
    .views(self => {
      // react-msaview's extraViewMenuItems() has no caller, in that package or
      // in JBrowse; the view hamburger renders menuItems(), so extend that
      const superMenuItems = self.menuItems.bind(self)
      return {
        /**
         * #method
         * overrides base
         */
        menuItems(): MenuItem[] {
          return [
            ...superMenuItems(),
            {
              label: 'Zoom to base level on click?',
              type: 'checkbox',
              checked: self.zoomToBaseLevel,
              onClick: () => {
                self.setZoomToBaseLevel(!self.zoomToBaseLevel)
              },
            },
          ]
        },
      }
    })
}

export type JBrowsePluginTViewStateModel = ReturnType<typeof stateModelFactory>
export type JBrowsePluginTViewModel = Instance<JBrowsePluginTViewStateModel>

export function isTView(view: {
  type: string
}): view is JBrowsePluginTViewModel {
  return view.type === 'TView'
}

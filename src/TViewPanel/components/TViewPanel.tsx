import React from 'react'
import { observer } from 'mobx-react'
import { MSAView } from 'react-msaview'

// locals
import { JBrowsePluginTViewModel } from '../model'

const TViewPanel = observer(function TViewPanel2({
  model,
}: {
  model: JBrowsePluginTViewModel
}) {
  return <MSAView model={model} />
})

export default TViewPanel

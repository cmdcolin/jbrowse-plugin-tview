import React, { useState } from 'react'
import { Dialog } from '@jbrowse/core/ui'
import { Button, DialogActions } from '@mui/material'
import { AbstractTrackModel, Feature } from '@jbrowse/core/util'

export default function LaunchTViewDialog({
  handleClose,
  feature,
  model,
}: {
  handleClose: () => void
  feature: Feature
  model: AbstractTrackModel
}) {
  const [value, setValue] = useState(0)

  return (
    <Dialog
      maxWidth="xl"
      title="Launch tview"
      onClose={() => {
        handleClose()
      }}
      open
    >
      <DialogActions>
        <Button variant="contained" color="primary" onClick={() => {}}>
          Submit
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => {
            handleClose()
          }}
        >
          cancel
        </Button>
      </DialogActions>
    </Dialog>
  )
}

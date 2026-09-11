import React from 'react'
import DPConfirmationOverlay from '../shared/ConfirmationOverlay'

export const withDPGuard =
  <P extends object>(Component: React.ComponentType<P>) =>
  (props: P) =>
    (
      <DPConfirmationOverlay>
        <Component {...props} />
      </DPConfirmationOverlay>
    )

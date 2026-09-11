import React, { useMemo, useState } from 'react'
import { Button } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import { PreIncubationContractModal } from '@/components/modals/Contracts/PreIncubationContract'
import { hasPreIncAgreementEvidence } from '@/services/movService'

type Props = { mov: any; compact?: boolean }

export const PreIncPoeButton: React.FC<Props> = ({ mov, compact = false }) => {
    const [open, setOpen] = useState(false)
    // hasPreIncAgreementEvidence also recognizes a signed agreement resolved
    // from the participant's/application's signedAgreements record (not just
    // a flag/resource stamped directly onto this MOV document), which is the
    // common case for ROM onboarding MOVs.
    const hasAgreement = useMemo(() => hasPreIncAgreementEvidence(mov), [mov])

    if (!hasAgreement) return null

    return <>
        <Button
            type={compact ? 'link' : 'default'}
            size="middle"
            shape='round'
            icon={<FileTextOutlined />}
            onClick={() => setOpen(true)}
        >
            Pre-Inc POE
        </Button>
        <PreIncubationContractModal
            open={open}
            participantId={String(mov?.participantId || mov?.beneficiaryId || mov?.smmeId || '')}
            applicationId={String(mov?.applicationId || '')}
            onClose={() => setOpen(false)}
            onSigned={async () => undefined}
            readOnly
            signedMeta={mov?.preIncubationAgreementMeta || mov?.preIncAgreementMeta}
            viewerRole="operations"
        />
    </>
}

export default PreIncPoeButton

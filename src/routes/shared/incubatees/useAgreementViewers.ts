import { useState } from 'react'
import { message } from 'antd'
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import { type MoaVars } from '@/components/modals/Contracts/moa.pages'
import { ComplianceDoc, MoaViewerState, SmeRow, canonicalComplianceId, toDateSafe } from './participantsData'

/**
 * State for the read-only viewers of generated agreements (pre-incubation contract,
 * gap analysis, MOA) and the opener used by the compliance list.
 */
export const useAgreementViewers = (selectedRow: SmeRow | null, selectedApplicationData: any, selectedParticipantData: any) => {
    const [preIncViewer, setPreIncViewer] = useState<{ meta?: any } | null>(null)
    const [gapViewerOpen, setGapViewerOpen] = useState(false)
    const [gapViewerId, setGapViewerId] = useState<string | null>(null)
    const [agreementViewerLoading, setAgreementViewerLoading] = useState(false)
    const [moaViewer, setMoaViewer] = useState<MoaViewerState | null>(null)

    const openGeneratedAgreement = async (record: ComplianceDoc) => {
        if (!selectedRow || selectedApplicationData?.manuallyCreated === true || !record.signed) return false

        const agreementId = canonicalComplianceId(`${record.id} ${record.title}`)
        if (!['pre-incubation-contract', 'moa', 'gap-analysis'].includes(agreementId)) return false

        if (agreementId === 'pre-incubation-contract') {
            setPreIncViewer({
                meta: selectedApplicationData?.signedAgreements?.['pre-incubation-contract'] || record.meta || record
            })
            return true
        }

        setAgreementViewerLoading(true)
        try {
            if (agreementId === 'gap-analysis') {
                const embedded = selectedApplicationData?.signedAgreements?.['gap-analysis'] || record.meta || {}
                const embeddedGapId = String(
                    embedded?.gapId || embedded?.gapAnalysisId || selectedApplicationData?.gapAnalysisId || ''
                ).trim()

                if (embeddedGapId) {
                    setGapViewerId(embeddedGapId)
                } else if (selectedRow.participantId) {
                    const gapSnap = await getDocs(query(
                        collection(db, 'gapAnalysis'),
                        where('participantId', '==', selectedRow.participantId)
                    ))
                    setGapViewerId(gapSnap.empty ? null : gapSnap.docs[0].id)
                } else {
                    setGapViewerId(null)
                }
                setGapViewerOpen(true)
                return true
            }

            const programId = String(selectedApplicationData?.programId || selectedRow.programId || '').trim()
            const programSnap = programId ? await getDoc(doc(db, 'programs', programId)) : null
            const program = programSnap?.exists() ? programSnap.data() as any : {}
            const start = toDateSafe(program?.startDate)
            const end = toDateSafe(program?.endDate)

            const vars: MoaVars = {
                beneficiaryName:
                    selectedApplicationData?.beneficiaryName ||
                    selectedApplicationData?.companyName ||
                    selectedRow.companyName ||
                    '________',
                registrationNumber:
                    selectedParticipantData?.registrationNumber ||
                    selectedApplicationData?.registrationNumber ||
                    selectedRow.registrationNumber ||
                    '________',
                participantName:
                    selectedParticipantData?.participantName ||
                    selectedParticipantData?.fullName ||
                    selectedApplicationData?.participantName ||
                    selectedApplicationData?.applicantName ||
                    selectedApplicationData?.contactPerson ||
                    '________',
                idNumber:
                    selectedParticipantData?.idNumber ||
                    selectedParticipantData?.nationalId ||
                    selectedApplicationData?.idNumber ||
                    '________',
                businessAddress:
                    selectedParticipantData?.businessAddress ||
                    selectedApplicationData?.businessAddress ||
                    selectedApplicationData?.registeredAddress ||
                    selectedRow.businessAddress ||
                    '________',
                contactNumber:
                    selectedParticipantData?.contactNumber ||
                    selectedParticipantData?.phone ||
                    selectedApplicationData?.contactNumber ||
                    selectedApplicationData?.phone ||
                    selectedRow.phone ||
                    '________',
                email:
                    selectedParticipantData?.email ||
                    selectedApplicationData?.email ||
                    selectedRow.email ||
                    '________',
                effectiveDate: start ? dayjs(start).format('DD MMMM YYYY') : '________',
                graduationDate: end ? dayjs(end).format('DD MMMM YYYY') : '________'
            }

            setMoaViewer({
                vars,
                meta: selectedApplicationData?.signedAgreements?.moa || record.meta || record
            })
            return true
        } catch (error) {
            console.error('Failed to open generated agreement.', error)
            message.error('The agreement viewer could not be opened.')
            return true
        } finally {
            setAgreementViewerLoading(false)
        }
    }

    const closeGapViewer = () => {
        setGapViewerOpen(false)
        setGapViewerId(null)
    }

    return {
        openGeneratedAgreement,
        agreementViewerLoading,
        preIncViewer,
        closePreIncViewer: () => setPreIncViewer(null),
        gapViewerOpen,
        gapViewerId,
        closeGapViewer,
        moaViewer,
        closeMoaViewer: () => setMoaViewer(null)
    }
}

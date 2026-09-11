import React, { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import dayjs from 'dayjs'
import { buildMovInterventionRows, buildMovInterventionLabel } from '@/docx/movBuilder'
import { getAgreementTemplate, type AgreementTemplate } from '@/services/complianceResolver'
import { resolveMovFacilitatorById } from '@/services/movService'

// ---------- helpers ----------

const normImg = (v: any): string => {
    if (!v) return ''
    const s = String(v).trim()
    return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:image/') ? s : ''
}

const resolveDate = (v: any): Date | null => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate()
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000)

    const raw = v instanceof Date ? v : new Date(v)
    return isNaN(raw.getTime()) ? null : raw
}

const fmtDate = (v: any): string => {
    const raw = resolveDate(v)
    return raw ? dayjs(raw).format('DD MMMM YYYY') : '—'
}

const isBlank = (v: any) => v === undefined || v === null || String(v).trim() === ''
const value = (v: any) => (isBlank(v) ? '—' : String(v))

// ---------- styles ----------

const BORDER = '1px solid #595959'

const TABLE: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: 10,
    tableLayout: 'fixed',
    fontSize: 12,
    lineHeight: 1.25,
    color: '#111'
}

const TD: React.CSSProperties = {
    border: BORDER,
    padding: '4px 7px',
    verticalAlign: 'top',
    wordBreak: 'break-word'
}

const TH: React.CSSProperties = {
    ...TD,
    fontWeight: 700,
    background: '#bfbfbf'
}

const ORANGE_TH: React.CSSProperties = {
    ...TH,
    background: '#f4b183'
}

const YELLOW_TH: React.CSSProperties = {
    ...TH,
    background: '#ffc000'
}

const GREEN_TH: React.CSSProperties = {
    ...TH,
    background: '#92d050'
}

const CENTER: React.CSSProperties = {
    textAlign: 'center',
    verticalAlign: 'middle'
}

const SIG_IMG: React.CSSProperties = {
    maxHeight: 42,
    maxWidth: 160,
    objectFit: 'contain',
    display: 'block'
}

const MOV_HIGHLIGHT_GREEN = '#9BCB9B'

const selectedCell = (on: boolean): React.CSSProperties => ({
    ...TD,
    ...CENTER,
    fontWeight: 700,
    background: on ? MOV_HIGHLIGHT_GREEN : '#fff',
    color: '#000'
})

const stageCell = (active: boolean): React.CSSProperties => ({
    ...TD,
    ...CENTER,
    fontWeight: 700,
    background: active ? MOV_HIGHLIGHT_GREEN : '#fff',
    color: '#000'
})

// ---------- types ----------

export type MovSigner = {
    label: string
    name?: string | null
    signatureUrl?: string | null
    digitalSignature?: string | null
    department?: string | null
    designation?: string | null
    date?: any
    pending?: boolean
    pendingMessage?: string
}

export type MovDocumentViewProps = {
    mov: any
    signers?: MovSigner[]
}

// ---------- compact sections ----------

const HeaderTable: React.FC<{
    mov: any
    template?: AgreementTemplate | null
    funderLogoUrl?: string | null
}> = ({ mov, template, funderLogoUrl }) => (
    <table style={TABLE}>
        <tbody>
            <tr>
                <td style={{ ...TD, width: '36%', height: 58, verticalAlign: 'middle' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <img src="/assets/images/lepharo.png" alt="Lepharo" style={{ height: 42, maxWidth: 160, objectFit: 'contain' }} />
                        <img
                            src={funderLogoUrl || '/assets/images/sibanye-stillwater.png'}
                            alt="Funder"
                            style={{ height: 56, maxWidth: 190, objectFit: 'contain' }}
                        />
                    </div>
                </td>
                <td style={{ ...TD, ...CENTER, width: '38%', fontWeight: 800, fontSize: 14 }}>
                    CONFIRMATION SHEET FOR RECEIVING<br />
                    BDS
                    (MOV)
                </td>
                <td style={{ ...TD, width: '26%', fontWeight: 700 }}>
                    Form No: {value(template?.formNo || mov?.formNo)}<br />
                    Revision No: {value(template?.revisionNo || mov?.revisionNo)}<br />
                    Effective date: {value(template?.effectiveDate || mov?.effectiveDate)}
                </td>
            </tr>
        </tbody>
    </table>
)

const OfficeClientTable: React.FC<{ mov: any }> = ({ mov }) => {
    const g = String(mov?.gapGroup || '').toUpperCase()

    return (
        <table style={TABLE}>
            <tbody>
                <tr>
                    <td style={{ ...ORANGE_TH, width: '21%' }}>OFFICE/AREA NAME</td>
                    <td style={{ ...TD, width: '29%' }}>{value(mov?.officeAreaName)}</td>
                    <td style={{ ...TH, width: '12%' }}>Start Date:</td>
                    <td style={{ ...TD, width: '14%' }}>{fmtDate(mov?.periodStart)}</td>
                    <td style={{ ...TH, width: '10%' }}>End Date</td>
                    <td style={{ ...TD, width: '14%' }}>
                        {fmtDate(mov?.smmeAcceptedAt || mov?.smmeSignedAt || mov?.periodEnd)}
                    </td>
                </tr>

                <tr>
                    <td style={TH}>NAME OF THE SMME:</td>
                    <td style={{ ...TD, fontWeight: 700 }} colSpan={3}>{value(mov?.smmeCompanyName)}</td>
                    <td style={TH}>SMME No</td>
                    <td style={TD}>{value(mov?.smmeNo)}</td>
                </tr>

                <tr>
                    <td style={TH}>SMME Sector:</td>
                    <td style={{ ...TD, fontWeight: 700 }}>{value(mov?.smmeSector)}</td>
                    <td style={TH}>Group stage:</td>
                    <td style={{ ...TD, padding: 0 }} colSpan={3}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                            <tbody>
                                <tr>
                                    <td style={stageCell(g === 'A')}>A</td>
                                    <td style={stageCell(g === 'B')}>B</td>
                                    <td style={stageCell(g === 'C')}>C</td>
                                </tr>
                            </tbody>
                        </table>
                    </td>
                </tr>

                <tr>
                    <td style={TH}>KPI serviced:</td>
                    <td style={TD} colSpan={5}>{buildMovInterventionLabel(mov)}</td>
                </tr>
            </tbody>
        </table>
    )
}

const MethodFrequencyTable: React.FC<{ mov: any }> = ({ mov }) => {
    const f = String(mov?.frequency || '').toLowerCase()

    return (
        <table style={TABLE}>
            <tbody>
                <tr>
                    <td style={{ ...TH, ...CENTER }} colSpan={9}>
                        Intervention method
                    </td>
                </tr>

                <tr>
                    <td style={{ ...TH, width: '16%' }}>In person</td>
                    <td style={selectedCell(!!mov?.methodInPerson)}>Yes</td>
                    <td style={selectedCell(!mov?.methodInPerson)}>No</td>

                    <td style={{ ...TH, width: '16%' }}>Online</td>
                    <td style={selectedCell(!!mov?.methodOnline)}>Yes</td>
                    <td style={selectedCell(!mov?.methodOnline)}>No</td>

                    <td style={{ ...TH, width: '16%' }}>Telephonic</td>
                    <td style={selectedCell(!!mov?.methodTelephonic)}>Yes</td>
                    <td style={selectedCell(!mov?.methodTelephonic)}>No</td>
                </tr>

                <tr>
                    <td style={TH}>Other (Specify)</td>
                    <td style={TD} colSpan={8}>
                        {value(mov?.methodOther)}
                    </td>
                </tr>

                <tr>
                    <td style={TH}>Frequency of intervention</td>

                    <td style={{ ...TH, ...CENTER }} colSpan={2}>
                        Once a month
                    </td>
                    <td style={selectedCell(f === 'monthly')}>
                        {f === 'monthly' ? 'X' : ''}
                    </td>

                    <td style={{ ...TH, ...CENTER }} colSpan={2}>
                        Every two weeks
                    </td>
                    <td style={selectedCell(f === 'biweekly')}>
                        {f === 'biweekly' ? 'X' : ''}
                    </td>

                    <td style={{ ...TH, ...CENTER }}>
                        Weekly
                    </td>
                    <td style={selectedCell(f === 'weekly')}>
                        {f === 'weekly' ? 'X' : ''}
                    </td>
                </tr>
            </tbody>
        </table>
    )
}

const InterventionsTable: React.FC<{ rows: any[]; mov?: any }> = ({ rows, mov }) => (
    <table style={TABLE}>
        <thead>
            <tr>
                <th style={{ ...YELLOW_TH, width: '4%', ...CENTER }}>No.</th>
                <th style={{ ...YELLOW_TH, width: '66%' }}>
                    TYPE OF INTERVENTION PROVIDED<br />
                    (give full details)
                </th>
                <th style={{ ...YELLOW_TH, width: '15%' }}>
                    INTERVENTION<br />
                    date:(dd/mm/yyyy)
                </th>
                <th style={{ ...YELLOW_TH, width: '15%' }}>Signature</th>
            </tr>
        </thead>
        <tbody>
            {rows.length ? rows.map((r, i) => (
                <tr key={i}>
                    <td style={{ ...TD, ...CENTER, fontWeight: 700 }}>{i + 1}.</td>
                    <td style={TD}>{value(r?.title)}</td>
                    <td style={TD}>{fmtDate(r?.date)}</td>
                    <td style={TD}>
                        <SmmeSignatureImage url={mov?.smmeSignatureUrl} />
                    </td>
                </tr>
            )) : (
                <tr>
                    <td style={{ ...TD, ...CENTER }} colSpan={4}>No intervention details recorded</td>
                </tr>
            )}
        </tbody>
    </table>
)

const SmmeSignatureImage: React.FC<{ url?: string | null }> = ({ url }) => {
    const [failed, setFailed] = useState(false)
    const safeUrl = normImg(url)

    useEffect(() => setFailed(false), [safeUrl])

    if (!safeUrl || failed) {
        return (
            <span style={{ color: '#cf1322', fontWeight: 700 }}>
                Signature not provided
            </span>
        )
    }

    return (
        <img
            src={safeUrl}
            alt="SMME Signature"
            onError={() => setFailed(true)}
            style={{ maxHeight: 48, maxWidth: 180, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4, padding: 2 }}
        />
    )
}

const SignatureBodyCell: React.FC<{ signer: MovSigner }> = ({ signer }) => {
    const url = normImg(signer.signatureUrl)

    if (url) {
        return <img src={url} alt={`${signer.label} signature`} style={SIG_IMG} />
    }

    if (signer.pending) {
        return <em style={{ color: '#888' }}>{signer.pendingMessage || 'Awaiting signature'}</em>
    }

    return <span>{signer.name ? 'Signature not provided' : '—'}</span>
}

const SignaturesTable: React.FC<{ signers: MovSigner[] }> = ({ signers }) => {
    const facilitator = signers[0]
    const client = signers[1]

    return (
        <table style={{ ...TABLE, marginLeft: '5%', width: '95%' }}>
            <tbody>
                <tr>
                    <td style={{ ...YELLOW_TH, width: '12%' }}>Facilitator name</td>
                    <td style={{ ...TD, width: '28%', fontWeight: 700 }}>{value(facilitator?.name)}</td>
                    <td style={{ ...YELLOW_TH, width: '10%' }}>Client name</td>
                    <td style={{ ...TD, width: '50%', fontWeight: 700 }}>{value(client?.name)}</td>
                </tr>
                <tr>
                    <td style={TH}>Signature</td>
                    <td style={TD}><SignatureBodyCell signer={facilitator} /></td>
                    <td style={TH}>Signature</td>
                    <td style={TD}><SignatureBodyCell signer={client} /></td>
                </tr>
                <tr>
                    <td style={TH}>Department</td>
                    <td style={TD}>{value(facilitator?.department)}</td>
                    <td style={TH}>Designation</td>
                    <td style={TD}>{value(client?.designation || 'Director')}</td>
                </tr>
                <tr>
                    <td style={TH}>Date</td>
                    <td style={TD}>{fmtDate(facilitator?.date)}</td>
                    <td style={TH}>Date</td>
                    <td style={TD}>
                        {client?.pending
                            ? <em style={{ color: '#888' }}>Not confirmed</em>
                            : fmtDate(client?.date)}
                    </td>
                </tr>
            </tbody>
        </table>
    )
}

const OfficeUseOnlyTable: React.FC<{ mov: any }> = ({ mov }) => (
    <table style={{ ...TABLE, marginLeft: '5%', width: '62%' }}>
        <tbody>
            <tr>
                <td style={GREEN_TH} colSpan={2}>Office use only</td>
            </tr>
            <tr>
                <td style={TH}>Department</td>
                <td style={TD}>{value(mov?.officeUseDepartment || 'Monitoring and evaluation')}</td>
            </tr>
            {(() => {
                const approval = Array.isArray(mov?.approvals) ? mov.approvals.find((a: any) => a.step === 'validation') : null
                const validatorName = mov?.monitoringName || approval?.name || mov?.monitoringValidatorName || mov?.validatorName || null
                const validatorSigUrl = mov?.monitoringSignatureUrl || mov?.monitoringSignature || mov?.monitoringSigUrl || approval?.signatureUrl || null
                const checkerName = mov?.finalCheckerName || validatorName
                const checkerSignature = mov?.finalCheckerSignature || validatorSigUrl
                const checkerDate = mov?.finalCheckerDate || mov?.officeUseDate || mov?.validatedAt || approval?.date

                return (
                    <>
                        <tr>
                            <td style={TH}>Final checkers name</td>
                            <td style={TD}>{value(checkerName)}</td>
                        </tr>
                        <tr>
                            <td style={TH}>Signature</td>
                            <td style={TD}>
                                {checkerSignature ? (
                                    <img
                                        src={checkerSignature}
                                        alt="Final checker signature"
                                        style={{ maxHeight: 48, maxWidth: 180, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4, padding: 2 }}
                                    />
                                ) : (
                                    <span>Signature not provided</span>
                                )}
                            </td>
                        </tr>
                        <tr>
                            <td style={TH}>Date</td>
                            <td style={TD}>{fmtDate(checkerDate)}</td>
                        </tr>
                    </>
                )
            })()}
        </tbody>
    </table>
)

// ---------- component ----------

export const MovDocumentView: React.FC<MovDocumentViewProps> = ({ mov, signers }) => {
    const { activeProgramId } = useActiveProgramId()
    const [funderLogoUrl, setFunderLogoUrl] = useState<string | null>(null)
    const [movTemplate, setMovTemplate] = useState<AgreementTemplate | null>(null)
    const [linkedAssignmentData, setLinkedAssignmentData] = useState<any | null>(null)
    const [linkedFacilitatorData, setLinkedFacilitatorData] = useState<any | null>(null)
    const [linkedParticipantData, setLinkedParticipantData] = useState<any | null>(null)
    const [linkedApplicationData, setLinkedApplicationData] = useState<any | null>(null)

    useEffect(() => {
        let mounted = true

        const assignedInterventionId = String(
            mov?.assignedInterventionId || ''
        ).trim()
        const movParticipantId = String(
            mov?.participantId || mov?.beneficiaryId || mov?.smmeId || ''
        ).trim()

        const run = async () => {
            try {
                let assignment: any | null = null

                if (assignedInterventionId) {
                    const assignmentSnap = await getDoc(
                        doc(db, 'assignedInterventions', assignedInterventionId)
                    )

                    if (assignmentSnap.exists()) {
                        assignment = {
                            id: assignmentSnap.id,
                            ...(assignmentSnap.data() as any)
                        }
                    }
                }

                const participantId = String(
                    assignment?.participantId ||
                    assignment?.beneficiaryId ||
                    movParticipantId ||
                    ''
                ).trim()

                const [participantSnap, applicationSnap, facilitatorProfile] = await Promise.all([
                    participantId
                        ? getDoc(doc(db, 'participants', participantId))
                        : Promise.resolve(null),
                    participantId
                        ? getDocs(
                            query(
                                collection(db, 'applications'),
                                where('participantId', '==', participantId),
                                limit(1)
                            )
                        )
                        : Promise.resolve(null),
                    assignment?.assigneeId
                        ? resolveMovFacilitatorById({
                            db,
                            facilitatorId: String(assignment.assigneeId),
                            email: assignment.assigneeEmail,
                            preferredRole: assignment.assigneeRole === 'operations' ? 'operations' : 'coordinator'
                        })
                        : Promise.resolve(null)
                ])

                if (!mounted) return

                setLinkedAssignmentData(assignment)
                setLinkedFacilitatorData(facilitatorProfile)
                setLinkedParticipantData(
                    participantSnap?.exists()
                        ? {
                            id: participantSnap.id,
                            ...(participantSnap.data() as any)
                        }
                        : null
                )
                setLinkedApplicationData(
                    applicationSnap && !applicationSnap.empty
                        ? {
                            id: applicationSnap.docs[0].id,
                            ...(applicationSnap.docs[0].data() as any)
                        }
                        : null
                )
            } catch (error) {
                console.warn('Could not hydrate linked MOV details', error)

                if (mounted) {
                    setLinkedAssignmentData(null)
                    setLinkedFacilitatorData(null)
                    setLinkedParticipantData(null)
                    setLinkedApplicationData(null)
                }
            }
        }

        run()

        return () => {
            mounted = false
        }
    }, [
        mov?.assignedInterventionId,
        mov?.participantId,
        mov?.beneficiaryId,
        mov?.smmeId
    ])

    const effectiveMov = {
        ...mov,
        ...(() => {
            const appointmentMethods = (Array.isArray(mov?.appointmentInterventions)
                ? mov.appointmentInterventions
                : [])
                .map((row: any) => String(row?.deliveryMethod || row?.method || '').toLowerCase())

            const hasStoredMethod = !!(
                mov?.methodInPerson ||
                mov?.methodOnline ||
                mov?.methodTelephonic ||
                mov?.methodOther
            )

            if (hasStoredMethod || !appointmentMethods.length) return {}

            const has = (needle: string) => appointmentMethods.some((method: string) => method.includes(needle))

            return {
                methodInPerson: has('in_person') || has('in-person') || has('in person'),
                methodOnline: has('online') || has('virtual'),
                methodTelephonic: has('telephon')
            }
        })(),
        smmeNo:
            linkedApplicationData?.smmeNo ||
            linkedApplicationData?.smmENo ||
            linkedApplicationData?.SMMENo ||
            mov?.smmeNo ||
            '',
        participantEmail:
            linkedParticipantData?.email ||
            linkedParticipantData?.participantEmail ||
            linkedParticipantData?.contactEmail ||
            linkedParticipantData?.contactInfo?.email ||
            mov?.participantEmail ||
            mov?.smmeEmail ||
            linkedAssignmentData?.participantEmail ||
            linkedAssignmentData?.beneficiaryEmail ||
            '',
        facilitatorId:
            linkedAssignmentData?.assigneeId ||
            mov?.facilitatorId ||
            '',
        facilitatorName:
            linkedAssignmentData?.assigneeName ||
            linkedFacilitatorData?.name ||
            mov?.facilitatorName ||
            '',
        facilitatorEmail:
            linkedFacilitatorData?.email ||
            linkedAssignmentData?.assigneeEmail ||
            mov?.facilitatorEmail ||
            '',
        facilitatorSignatureUrl: mov?.assignedInterventionId
            ? linkedFacilitatorData?.signatureUrl || ''
            : mov?.facilitatorSignatureUrl || '',
        facilitatorDigitalSignature: mov?.assignedInterventionId
            ? linkedFacilitatorData?.digitalSignature || ''
            : mov?.facilitatorDigitalSignature || '',
        // Appointment rows are resolved before this renderer is opened.
        // Do not query/rebuild them here, otherwise Coordinator and Approval
        // previews can render different session data for the same MOV.
        appointmentInterventions: Array.isArray(mov?.appointmentInterventions)
            ? mov.appointmentInterventions
            : [],
        facilitatorSignedAt:
            mov?.facilitatorSignedAt ||
            linkedAssignmentData?.assigneeCompletedAt ||
            linkedAssignmentData?.completedAt,
        smmeSignedAt:
            mov?.smmeSignedAt ||
            mov?.smmeAcceptedAt ||
            linkedAssignmentData?.participantConfirmedAt,
        smmeAcceptedAt:
            mov?.smmeAcceptedAt ||
            linkedAssignmentData?.participantConfirmedAt,
        periodEnd:
            mov?.smmeAcceptedAt ||
            mov?.smmeSignedAt ||
            linkedAssignmentData?.participantConfirmedAt ||
            mov?.periodEnd
    }

    const interventionRows = buildMovInterventionRows(effectiveMov)

    useEffect(() => {
        let mounted = true
        getAgreementTemplate('mov')
            .then(template => {
                if (mounted) setMovTemplate(template)
            })
            .catch(error => {
                console.error('Failed to load MOV agreement metadata', error)
                if (mounted) setMovTemplate(null)
            })
        return () => {
            mounted = false
        }
    }, [])

    useEffect(() => {
        let mounted = true

        const run = async () => {
            if (!activeProgramId) {
                if (mounted) setFunderLogoUrl(null)
                return
            }

            try {
                const ref = doc(db, 'programs', String(activeProgramId))
                const snap = await getDoc(ref)
                if (!mounted) return
                if (!snap.exists()) {
                    setFunderLogoUrl(null)
                    return
                }
                const data = snap.data() as any
                const candidate =
                    (typeof data.funderLogoUrl === 'string' && data.funderLogoUrl) ||
                    (data.funder && typeof data.funder.logoUrl === 'string' && data.funder.logoUrl) ||
                    (typeof data.logoUrl === 'string' && data.logoUrl) ||
                    (typeof data.funderLogo === 'string' && data.funderLogo) ||
                    null

                setFunderLogoUrl(candidate)
            } catch (e) {
                console.error('Failed to load program funder logo', e)
                if (mounted) setFunderLogoUrl(null)
            }
        }

        run()
        return () => {
            mounted = false
        }
    }, [activeProgramId])

    const smmeConfirmed =
        effectiveMov?.smmeAccepted === true ||
        ['confirmed', 'accepted', 'complete', 'completed'].includes(
            String(effectiveMov?.participantCompletionStatus || linkedAssignmentData?.participantCompletionStatus || '').toLowerCase()
        ) ||
        Boolean(
            effectiveMov?.smmeAcceptedAt ||
            effectiveMov?.smmeSignedAt ||
            linkedAssignmentData?.participantConfirmedAt
        )

    const resolvedSigners: MovSigner[] = signers ?? [
        {
            label: 'Facilitator',
            name: effectiveMov?.facilitatorName,
            signatureUrl: effectiveMov?.facilitatorSignatureUrl,
            department: effectiveMov?.departmentName,
            date:
                effectiveMov?.facilitatorSignedAt ||
                effectiveMov?.assigneeCompletedAt ||
                effectiveMov?.completedAt ||
                effectiveMov?.interventionDate
        },
        {
            label: 'Client',
            name: effectiveMov?.smmeCompanyName,
            signatureUrl: smmeConfirmed ? effectiveMov?.smmeSignatureUrl : null,
            designation: effectiveMov?.smmeRepresentativeDesignation || 'Director',
            date: smmeConfirmed
                ? effectiveMov?.smmeSignedAt || effectiveMov?.smmeAcceptedAt
                : null,
            pending: !smmeConfirmed,
            pendingMessage: 'Not provided — awaiting SME confirmation'
        }
    ]

    return (
        <div style={{ width: '100%', overflowX: 'auto' }}>
            <div style={{ minWidth: 980, background: '#fff', padding: 8 }}>
                <HeaderTable mov={effectiveMov} template={movTemplate} funderLogoUrl={funderLogoUrl} />
                <OfficeClientTable mov={effectiveMov} />
                <MethodFrequencyTable mov={effectiveMov} />
                <InterventionsTable rows={interventionRows} mov={effectiveMov} />

                <div style={{ marginLeft: '5%', marginBottom: 0, fontWeight: 800, fontSize: 12, color: '#c00000' }}>
                    ** ONE CONFIRMATION SHEET PER CLIENT
                </div>

                <SignaturesTable signers={resolvedSigners} />
                <OfficeUseOnlyTable mov={effectiveMov} />

                <div style={{ marginLeft: '5%', fontSize: 11, fontWeight: 700 }}>
                    SMME number example :SPR2009/233707/08GA (regional office prefix, then at the end we capture group stages) GA = Group A, when they graduate we just change the A to B.
                </div>
            </div>
        </div>
    )
}

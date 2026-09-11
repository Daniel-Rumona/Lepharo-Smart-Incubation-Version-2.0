// src/components/modals/Contracts/PreIncubationContract.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Typography, message, Space, Button, Alert, Modal } from 'antd'
import {
  collection,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
  doc,
  getDoc,
  arrayUnion,
  setDoc,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import dayjs, { Dayjs } from 'dayjs'
import { db } from '@/firebase'
import { ScrollableContractModal } from './ScrollableContractModal'
import { generateAndUploadContractPDF } from '@/utils/generateContractPdf'
import {
  DownloadOutlined,
  FilePdfOutlined,
  EditOutlined
} from '@ant-design/icons'

import {
  Document as DDocument,
  Header,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table as DTable,
  TableRow as DRow,
  TableCell as DCell,
  WidthType,
  AlignmentType,
  ImageRun,
  BorderStyle,
  TableLayoutType,
  VerticalAlign
} from 'docx'
import { saveAs } from 'file-saver'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { requestOpenAccountSettings } from '@/lib/accountSettings'

const { Paragraph: AParagraph, Text } = Typography

type ViewerRole = 'incubatee' | 'operations'

type Props = {
  open: boolean
  participantId: string
  applicationId?: string
  onClose: () => void
  onSigned: (meta: {
    acceptedAt: string
    version: number
    textHash: string
    userSignatureURL?: string
    participantSignatureURL?: string
    romSignatureURL?: string
    romName?: string
    romPosition?: string
    signedFileURL?: string
  }) => void
  pdfUrl?: string
  readOnly?: boolean
  signedMeta?: any
  viewerRole?: ViewerRole
}

const fmt = (d?: Date | Dayjs | null) =>
  d ? dayjs(d).format('DD MMMM YYYY') : ''
const asDayjs = (value: any): Dayjs | null => {
  if (!value) return null
  const raw = value?.toDate?.() ?? (value?.seconds ? new Date(value.seconds * 1000) : value)
  const parsed = dayjs(raw)
  return parsed.isValid() ? parsed : null
}
const signedDatePart = (value: any, part: 'DD' | 'MMMM' | 'YYYY') =>
  asDayjs(value)?.format(part) || (part === 'YYYY' ? '________' : '____')
const safe = (v: any, fallback = '________________') =>
  v === null || v === undefined || String(v).trim() === ''
    ? fallback
    : String(v)

// Static for letterheads
const HEADER_IMAGE = '/assets/images/lepharo.png'

/* =========================================
   Component
   ========================================= */
export function PreIncubationContractModal ({
  open,
  participantId,
  applicationId,
  onClose,
  onSigned,
  pdfUrl,
  readOnly,
  signedMeta,
  viewerRole = 'incubatee'
}: Props) {
  const [signing, setSigning] = useState(false)
  const [signingError, setSigningError] = useState('')
  const { user: identityUser } = useFullIdentity()

  // Active signer (current user)
  const [userSignatureURL, setUserSignatureURL] = useState<string>()

  // Existing saved signatures & ROM meta
  const [existingParticipantSig, setExistingParticipantSig] = useState<string>()
  const [existingRomSig, setExistingRomSig] = useState<string>()
  const [existingRomName, setExistingRomName] = useState<string>()
  const [existingRomPosition, setExistingRomPosition] = useState<string>()
  const [existingPdfUrl, setExistingPdfUrl] = useState<string | undefined>()
  const [existingParticipantSignedAt, setExistingParticipantSignedAt] =
    useState<any>()
  const [existingRomSignedAt, setExistingRomSignedAt] = useState<any>()
  const [previewSignatureURL, setPreviewSignatureURL] = useState<string>()
  const [previewSignedAt, setPreviewSignedAt] = useState<string>()

  // ROM user profile (for filling name/position automatically)
  const [romProfileName, setRomProfileName] = useState<string>()
  const [romProfilePosition, setRomProfilePosition] = useState<string>()

  // Whether the signer's profile has been read yet. Without this the
  // "no signature on file" notice would flash on every open, before the
  // lookup that resolves the signature has come back.
  const [profileChecked, setProfileChecked] = useState(false)

  // Data to render
  const [application, setApplication] = useState<any>()
  const [participant, setParticipant] = useState<any>()
  const [program, setProgram] = useState<any>()

  useEffect(() => {
    if (!open) return
    setSigningError('')
    setProfileChecked(false)
    ;(async () => {
      try {
        // 1) current user & signature
        const currentUser = getAuth().currentUser
        if (currentUser) {
          try {
            const directUserSnapshot = await getDoc(doc(db, 'users', currentUser.uid))
            const emailSnapshot = !directUserSnapshot.exists() && currentUser.email
              ? await getDocs(query(collection(db, 'users'), where('email', '==', currentUser.email), limit(1)))
              : null
            const u = directUserSnapshot.exists()
              ? directUserSnapshot.data() as any
              : emailSnapshot && !emailSnapshot.empty
                ? emailSnapshot.docs[0].data() as any
                : null
            if (u) {
            if (u?.signatureURL) setUserSignatureURL(String(u.signatureURL))
            const name =
              u?.displayName ||
              u?.name ||
              (u?.firstName && u?.lastName
                ? `${u.firstName} ${u.lastName}`
                : undefined) ||
              currentUser.displayName ||
              currentUser.email?.split('@')[0]
            setRomProfileName(name)
            const position =
              u?.position ||
              u?.title ||
              u?.roleTitle ||
              u?.jobTitle ||
              'Operations'
            setRomProfilePosition(position)
            }
          } catch (profileError) {
            console.warn('Could not load the signer profile; using the active identity instead.', profileError)
          }
        }
        setProfileChecked(true)

        // 2) application
        let appDoc: any | undefined
        const direct = await getDoc(doc(db, 'applications', applicationId || participantId))
        if (direct.exists()) {
          appDoc = { id: direct.id, ...direct.data() }
        } else {
          const appQ = await getDocs(
            query(
              collection(db, 'applications'),
              where('participantId', '==', participantId),
              limit(1)
            )
          )
          if (!appQ.empty)
            appDoc = { id: appQ.docs[0].id, ...appQ.docs[0].data() }
        }
        if (!appDoc) {
          message.error('Application record not found.')
          return
        }
        setApplication(appDoc)

        // 3) existing agreement meta
        const embedded =
          appDoc?.signedAgreements?.['pre-incubation-contract'] || {}
        const saved = { ...embedded }
        const suppliedMeta = signedMeta?.meta && typeof signedMeta.meta === 'object'
          ? signedMeta.meta
          : signedMeta
        Object.entries(suppliedMeta || {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            saved[key] = value
          }
        })
        const romSig = saved.romSignatureURL || saved.romSignatureUrl
        const explicitParticipantSig =
          saved.participantSignatureURL ||
          saved.participantSignatureUrl ||
          saved.smmeSignatureURL ||
          saved.smmeSignatureUrl
        const genericSignature =
          saved.userSignatureURL ||
          saved.userSignatureUrl ||
          saved.signatureURL ||
          saved.signatureUrl ||
          saved.signer?.signatureURL ||
          saved.signer?.signatureUrl
        const signaturesMatch = (left: any, right: any) =>
          Boolean(left && right && String(left).trim() === String(right).trim())
        let participantSig =
          explicitParticipantSig ||
          (signaturesMatch(genericSignature, romSig) ? undefined : genericSignature)
        // Markers that name the participant specifically.
        const participantMarkers = Boolean(
          participantSig ||
          saved.participantSigned === true ||
          saved.smmeSigned === true ||
          saved.participantSignedAt ||
          saved.incubateeSignedAt
        )
        // Markers that name the ROM specifically.
        const romMarkers = Boolean(
          romSig ||
          saved.romSigned === true ||
          saved.romSignedAt ||
          saved.romName ||
          saved.romSignedBy
        )
        // `acceptedAt` / `signedAt` / `signed` are stamped by whoever signed, so
        // they only imply the participant when nothing points at the ROM as the
        // author instead. Staff counter-signing (routes/shared/compliance)
        // creates the agreement with ROM fields only; reading these generic
        // fields as participant evidence there would mark the SME as signed and
        // hide their own Sign button.
        const genericMarkers = Boolean(
          saved.signed === true ||
          saved.acceptedAt ||
          saved.signedAt
        )
        const participantWasSigned =
          participantMarkers || (genericMarkers && !romMarkers)
        const participantSignedAt =
          saved.participantSignedAt ||
          saved.incubateeSignedAt ||
          saved.participantAcceptedAt ||
          (participantWasSigned ? saved.acceptedAt || saved.signedAt : undefined)
        const romSignedAt =
          saved.romSignedAt ||
          saved.operationsSignedAt ||
          saved.romAcceptedAt ||
          (romSig ? saved.acceptedAt || saved.signedAt : undefined)

        setExistingRomSig(romSig ? String(romSig) : undefined)
        const savedRomName =
          saved.romName || saved.romSignerName || saved.romSignedBy
        const savedRomPosition =
          saved.romPosition || saved.romSignerPosition || saved.romTitle
        setExistingRomName(
          savedRomName ? String(savedRomName) : undefined
        )
        setExistingRomPosition(
          savedRomPosition ? String(savedRomPosition) : undefined
        )
        setExistingPdfUrl(
          saved.signedFileURL ? String(saved.signedFileURL) : undefined
        )
        setExistingParticipantSignedAt(participantSignedAt)
        setExistingRomSignedAt(romSignedAt)

        // 4) participant + program
        const pid = appDoc?.participantId || participantId
        let participantDoc: any = null
        if (pid) {
          const pSnap = await getDoc(doc(db, 'participants', pid))
          if (pSnap.exists()) {
            participantDoc = { id: pSnap.id, ...pSnap.data() }
            setParticipant(participantDoc)
          }
        }

        // Older signed agreements often stored the signature only on the SME
        // profile. Use it only when the agreement itself contains signing evidence.
        if (!participantSig && participantWasSigned) {
          participantSig =
            participantDoc?.signatureURL ||
            participantDoc?.signatureUrl ||
            appDoc?.participantSignatureURL ||
            appDoc?.participantSignatureUrl ||
            appDoc?.smmeSignatureURL ||
            appDoc?.smmeSignatureUrl

          const participantEmail = String(
            participantDoc?.email || appDoc?.email || appDoc?.companyEmail || ''
          ).trim()
          if (!participantSig && participantEmail) {
            const userSnap = await getDocs(query(
              collection(db, 'users'),
              where('email', '==', participantEmail),
              limit(1)
            ))
            if (!userSnap.empty) {
              const participantUser = userSnap.docs[0].data() as any
              participantSig = participantUser?.signatureURL || participantUser?.signatureUrl
            }
          }
        }
        if (signaturesMatch(participantSig, romSig) && !explicitParticipantSig) {
          participantSig = undefined
        }
        setExistingParticipantSig(participantSig ? String(participantSig) : undefined)
        if (appDoc?.programId) {
          const progSnap = await getDoc(doc(db, 'programs', appDoc.programId))
          if (progSnap.exists())
            setProgram({ id: progSnap.id, ...progSnap.data() })
        }
      } catch (e) {
        console.warn('Contract hydrate failed:', e)
        message.error('The Pre-Incubation agreement could not be loaded. Please close it and try again.')
      }
    })()
  }, [open, participantId, applicationId, signedMeta])

  // Dynamic fields
  const companyName =
    application?.beneficiaryName || participant?.beneficiaryName
  const registrationNumber =
    application?.registrationNumber || participant?.registrationNumber
  const companyEmail =
    application?.companyEmail || application?.email || participant?.email
  const companyPhone =
    application?.companyPhone || participant?.phone || application?.phone
  const companyAddress =
    participant?.businessAddress ||
    application?.companyAddress ||
    participant?.address ||
    application?.address
  const directorName =
    participant?.participantName ||
    application?.directorName ||
    participant?.directorName ||
    application?.contactPerson ||
    participant?.contactPerson
  const directorId =
    participant?.idNumber ||
    application?.directorIdNumber ||
    participant?.directorIdNumber

  const start = application?.preIncubationStartDate
    ? dayjs(
        application.preIncubationStartDate.seconds
          ? application.preIncubationStartDate.toDate?.()
          : application.preIncubationStartDate
      )
    : dayjs()
  const end = application?.preIncubationEndDate
    ? dayjs(
        application.preIncubationEndDate.seconds
          ? application.preIncubationEndDate.toDate?.()
          : application.preIncubationEndDate
      )
    : start.add(12, 'week')

  const signPlace: string =
    program?.assignedBranch?.name ||
    program?.branchName ||
    application?.branchName ||
    'RUSTENBURG'

  // Effective date in header is dynamic (today)
  const effectiveDateStr = dayjs().format('DD MMMM YYYY')

  // Persisted signatures are shown by default. After an explicit Sign click,
  // optimistically reveal the current user's profile signature in its slot.
  const incubateeSignatureImg =
    existingParticipantSig ||
    (viewerRole === 'incubatee' ? previewSignatureURL : undefined)
  const romSignatureImg =
    existingRomSig ||
    (viewerRole === 'operations' ? previewSignatureURL : undefined)
  const romNameToRender = existingRomName || ''
  const romPositionToRender = existingRomPosition || 'Operations'

  const incubateeHasSigned = Boolean(existingParticipantSig)
  const romHasSigned = Boolean(existingRomSig)
  const viewerNeedsToSign =
    (viewerRole === 'incubatee' && !incubateeHasSigned) ||
    (viewerRole === 'operations' && !romHasSigned)
  const viewerHasSigned =
    (viewerRole === 'incubatee' && incubateeHasSigned) ||
    (viewerRole === 'operations' && romHasSigned)

  const computedReadOnly = Boolean(readOnly || viewerHasSigned)
  const effectiveUserSignatureURL =
    userSignatureURL ||
    identityUser?.signatureURL ||
    identityUser?.signatureUrl

  // Only once the profile lookup has settled, and only for someone who is
  // actually being asked to sign.
  const needsSignatureOnFile =
    profileChecked &&
    !computedReadOnly &&
    viewerNeedsToSign &&
    !effectiveUserSignatureURL

  /* ---------- HTML (unchanged wording & layout for modal/PDF) ---------- */
  const renderedHtml = useMemo(
    () =>
      buildPreIncubationAgreementHTML({
        headerImage: HEADER_IMAGE,
        effectiveDate: effectiveDateStr,
        registrationNumber,
        companyName,
        directorName,
        directorId,
        start,
        end,
        products: participant?.natureOfBusiness
          ? String(participant.natureOfBusiness)
          : '________________',
        signPlace,
        companyAddress,
        companyEmail,
        companyPhone,
        directorPosition: application?.directorPosition || 'MANAGING DIRECTOR',
        incubateeSignatureImg,
        romSignatureImg,
        romNameToRender,
        romPositionToRender,
        incubateeSignedAt:
          existingParticipantSignedAt ||
          (viewerRole === 'incubatee' ? previewSignedAt : undefined),
        romSignedAt:
          existingRomSignedAt ||
          (viewerRole === 'operations' ? previewSignedAt : undefined)
      }),
    [
      effectiveDateStr,
      registrationNumber,
      companyName,
      directorName,
      directorId,
      start,
      end,
      participant?.natureOfBusiness,
      signPlace,
      companyAddress,
      companyEmail,
      companyPhone,
      application?.directorPosition,
      incubateeSignatureImg,
      romSignatureImg,
      romNameToRender,
      romPositionToRender,
      existingParticipantSignedAt,
      existingRomSignedAt,
      previewSignatureURL,
      previewSignedAt,
      viewerRole
    ]
  )

  /* ---------- Sign: persist meta and upload PDF ---------- */
  const handleSign = async () => {
    if (signing) return
    if (!application?.id) return message.error('Application record not found.')
    if (!effectiveUserSignatureURL) {
      const detail = 'No signature is available on your profile. Add one in Account Settings, then try again.'
      setSigningError(detail)
      Modal.confirm({
        title: 'Add your signature to continue',
        content: detail,
        okText: 'Open Account Settings',
        cancelText: 'Not now',
        onOk: () => requestOpenAccountSettings()
      })
      return
    }

    const signedAt = new Date().toISOString()
    setSigningError('')
    setPreviewSignatureURL(effectiveUserSignatureURL || undefined)
    setPreviewSignedAt(signedAt)
    setSigning(true)
    try {
      const appRef = doc(db, 'applications', application.id)
      const meta: any = {
        acceptedAt: signedAt,
        version: 1,
        textHash: 'preincubation_2025_01'
      }
      if (viewerRole === 'incubatee') {
        meta.participantSigned = true
        if (effectiveUserSignatureURL) {
          meta.participantSignatureURL = effectiveUserSignatureURL
          // Role-agnostic alias kept for older readers, which look here first.
          // Only ever the participant's signature: utils/agreementStatus reads
          // it as theirs, so a ROM signature must not be written to it.
          meta.userSignatureURL = effectiveUserSignatureURL
        }
        meta.participantSignedAt = signedAt
      } else {
        meta.romSigned = true
        if (effectiveUserSignatureURL) {
          meta.romSignatureURL = effectiveUserSignatureURL
        }
        meta.romSignedAt = signedAt
        meta.romName = romProfileName || existingRomName || ''
        meta.romPosition =
          romProfilePosition || existingRomPosition || 'Operations'
      }

      const existing =
        application?.signedAgreements?.['pre-incubation-contract'] || {}
      const merged = { ...existing, ...meta }

      // The signature is the primary action. Save it before generating the PDF
      // so a slow renderer or Storage upload cannot leave the button hanging.
      const signingBatch = writeBatch(db)
      signingBatch.update(appRef, {
        ['signedAgreements.pre-incubation-contract']: merged,
        ['complianceSummary.completed']: arrayUnion('pre-incubation-contract')
      })

      signingBatch.set(doc(appRef, 'agreements', 'pre-incubation-contract'), {
        agreementId: 'pre-incubation-contract',
        title: 'Pre-Incubation Contract',
        ...merged,
        signed: Boolean(
          merged.participantSigned || merged.participantSignatureURL
        ),
        updatedAt: serverTimestamp()
      }, { merge: true })
      await signingBatch.commit()

      if (viewerRole === 'incubatee') {
        setExistingParticipantSig(effectiveUserSignatureURL || undefined)
        setExistingParticipantSignedAt(signedAt)
      } else {
        setExistingRomSig(effectiveUserSignatureURL)
        setExistingRomSignedAt(signedAt)
      }

      message.success(
        viewerRole === 'incubatee'
          ? 'Incubatee signature captured.'
          : 'ROM/Centre signature captured.'
      )
      onSigned(merged)
      onClose()

      // Generate and attach the signed PDF after the signature is safely stored.
      // This is deliberately non-blocking: the agreement remains signed even if
      // document rendering or Storage is temporarily unavailable.
      void (async () => {
        try {
          const signingHtml = buildPreIncubationAgreementHTML({
            headerImage: HEADER_IMAGE,
            effectiveDate: effectiveDateStr,
            registrationNumber,
            companyName,
            directorName,
            directorId,
            start,
            end,
            products: participant?.natureOfBusiness
              ? String(participant.natureOfBusiness)
              : '________________',
            signPlace,
            companyAddress,
            companyEmail,
            companyPhone,
            directorPosition:
              application?.directorPosition || 'MANAGING DIRECTOR',
            incubateeSignatureImg:
              viewerRole === 'incubatee'
                ? effectiveUserSignatureURL
                : incubateeSignatureImg,
            romSignatureImg:
              viewerRole === 'operations' ? effectiveUserSignatureURL : romSignatureImg,
            romNameToRender:
              viewerRole === 'operations'
                ? romProfileName || romNameToRender
                : romNameToRender,
            romPositionToRender:
              viewerRole === 'operations'
                ? romProfilePosition || romPositionToRender
                : romPositionToRender,
            incubateeSignedAt:
              viewerRole === 'incubatee'
                ? signedAt
                : existingParticipantSignedAt,
            romSignedAt:
              viewerRole === 'operations' ? signedAt : existingRomSignedAt
          })
          const pdfContainer = document.createElement('div')
          pdfContainer.style.position = 'fixed'
          pdfContainer.style.left = '-100000px'
          pdfContainer.style.top = '0'
          pdfContainer.style.width = '900px'
          pdfContainer.style.background = '#fff'
          pdfContainer.innerHTML = signingHtml
          document.body.appendChild(pdfContainer)

          let pdf: { url: string; path: string }
          try {
            pdf = await generateAndUploadContractPDF({
              title:
                'Pre-Incubation, Confidentiality & Non-Circumvention Agreement',
              slug: 'pre-incubation-contract',
              participantId,
              contentEl: pdfContainer,
              signerName:
                identityUser?.name || identityUser?.email || directorName || 'Incubatee',
              signatureUrl: effectiveUserSignatureURL,
              digitalSignature: undefined
            })
          } finally {
            pdfContainer.remove()
          }
          if (pdf?.url) {
            await updateDoc(appRef, {
              ['signedAgreements.pre-incubation-contract.signedFileURL']: pdf.url,
              signedFiles: arrayUnion({
                agreementId: 'pre-incubation-contract',
                title:
                  'Pre-Incubation, Confidentiality & Non-Circumvention Agreement',
                url: pdf.url,
                createdAt: new Date()
              })
            })
            await setDoc(doc(appRef, 'agreements', 'pre-incubation-contract'), {
              signedFileURL: pdf.url,
              updatedAt: serverTimestamp()
            }, { merge: true })
          }
        } catch (pdfError) {
          console.warn('Signed PDF generation failed; the signature was saved.', pdfError)
        }
      })()
    } catch (e: any) {
      console.error('Pre-Incubation signing failed:', e)
      setPreviewSignatureURL(undefined)
      setPreviewSignedAt(undefined)
      const detail = String(e?.code || '').includes('permission-denied')
        ? 'You do not have permission to update this agreement. Please contact support.'
        : e?.message || 'Please try again.'
      setSigningError(`Could not complete signing. ${detail}`)
      message.error(`Could not complete signing. ${detail}`)
      Modal.error({
        title: 'Signing failed',
        content: `Could not complete signing. ${detail}`
      })
    } finally {
      setSigning(false)
    }
  }

  /* ---------- Download Word using docx (no html-docx-js) ---------- */
  const handleDownloadDocx = useCallback(async () => {
    try {
      const blob = await buildPreIncubationDocx({
        headerImage: HEADER_IMAGE,
        effectiveDate: effectiveDateStr,
        registrationNumber,
        companyName,
        directorName,
        directorId,
        start,
        end,
        products: participant?.natureOfBusiness
          ? String(participant.natureOfBusiness)
          : '________________',
        signPlace,
        companyAddress,
        companyEmail,
        companyPhone,
        directorPosition: application?.directorPosition || 'MANAGING DIRECTOR',
        incubateeSignatureImg, // will embed image if URL is reachable
        romSignatureImg,
        romNameToRender,
        romPositionToRender,
        incubateeSignedAt: existingParticipantSignedAt,
        romSignedAt: existingRomSignedAt
      })
      saveAs(blob, `Pre-Incubation_Agreement_${companyName || 'SMME'}.docx`)
    } catch (e) {
      console.error(e)
      message.error('Could not generate Word document.')
    }
  }, [
    effectiveDateStr,
    registrationNumber,
    companyName,
    directorName,
    directorId,
    start,
    end,
    participant?.natureOfBusiness,
    signPlace,
    companyAddress,
    companyEmail,
    companyPhone,
    application?.directorPosition,
    incubateeSignatureImg,
    romSignatureImg,
    romNameToRender,
    romPositionToRender,
    existingParticipantSignedAt,
    existingRomSignedAt
  ])

  return (
    <ScrollableContractModal
      open={open}
      title='Pre-Incubation, Confidentiality, Non-Disclosure & Non-Circumvention Agreement'
      loading={signing}
      onCancel={onClose}
      onConfirm={undefined}
      readOnly={computedReadOnly}
      requireScroll={false}
      signedMeta={signedMeta}
      showSignatureSummary={false}
      footerActions={
        <>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadDocx}>
            Download
          </Button>
          {!computedReadOnly && viewerNeedsToSign && (
            <Button
              type='primary'
              icon={<EditOutlined />}
              loading={signing}
              onClick={handleSign}
            >
              Confirm &amp; Sign
            </Button>
          )}
        </>
      }
    >
      {signingError && (
        <Alert
          type='error'
          showIcon
          message='Signing was not completed'
          description={signingError}
          style={{ margin: 16 }}
        />
      )}

      {/* Said up front rather than only after a failed Sign click: without a
          signature on file there is nothing to place on the agreement, and the
          dead end is otherwise only discovered by pressing the button. */}
      {needsSignatureOnFile && (
        <Alert
          type='warning'
          showIcon
          message='Add your signature before signing'
          description='Your profile has no saved signature yet, so it cannot be placed on this agreement. Add one in Account Settings and it will be applied here.'
          action={
            <Button size='small' onClick={() => requestOpenAccountSettings()}>
              Open Account Settings
            </Button>
          }
          style={{ margin: 16 }}
        />
      )}
      {pdfUrl ? (
        <div style={{ height: 560 }}>
          <iframe
            src={pdfUrl}
            title='Pre-Incubation Agreement'
            style={{
              width: '100%',
              height: '100%',
              border: 0,
              borderRadius: 6
            }}
          />
        </div>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      )}

      {!readOnly && viewerNeedsToSign === false && (
        <AParagraph style={{ marginTop: 12 }}>
          <Text strong>Note:</Text> This agreement has already been signed by
          the current role. You can still download the latest copy from the footer.
        </AParagraph>
      )}
    </ScrollableContractModal>
  )
}

/* =========================================
   Reusable helpers (exported)
   ========================================= */

/** Build the on-screen/PDF HTML (keeps your exact wording and header table). */
export function buildPreIncubationAgreementHTML (args: {
  headerImage?: string
  effectiveDate?: string
  registrationNumber?: string
  companyName?: string
  directorName?: string
  directorId?: string
  start?: Date | Dayjs
  end?: Date | Dayjs
  products?: string
  signPlace?: string
  companyAddress?: string
  companyEmail?: string
  companyPhone?: string
  directorPosition?: string
  incubateeSignatureImg?: string | undefined
  romSignatureImg?: string | undefined
  romNameToRender?: string | undefined
  romPositionToRender?: string | undefined
  incubateeSignedAt?: any
  romSignedAt?: any
}) {
  const {
    headerImage = HEADER_IMAGE,
    effectiveDate = dayjs().format('DD MMMM YYYY'),
    registrationNumber,
    companyName,
    directorName,
    directorId,
    start,
    end,
    products = '________________',
    signPlace,
    companyAddress,
    companyEmail,
    companyPhone,
    directorPosition = 'MANAGING DIRECTOR',
    incubateeSignatureImg,
    romSignatureImg,
    romNameToRender,
    romPositionToRender,
    incubateeSignedAt,
    romSignedAt
  } = args

  const regLine = registrationNumber ? `Reg number: ${registrationNumber}` : ''
  const SME = safe(companyName)

  const css = `
    <style>
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; }
      .page { page-break-after: always; padding: 28px 36px; }
      .nobreak { page-break-inside: avoid; }
      .header-table { width: 100%; border-collapse: collapse; }
      .header-table td { vertical-align: middle; }
      .logo { height: 42px; }
      .title-cell { font-weight: 700; font-size: 16px; padding-left: 12px; }
      .meta-box { border: 1px solid #000; font-size: 12px; padding: 6px 10px; width: 260px; }
      .center { text-align: center; }
      .justify { text-align: justify; }
      .h1 { font-weight: 700; text-align: center; margin: 24px 0 12px; }
      .bold { font-weight: 700; }
      .underline { text-decoration: underline; }
      ol { margin: 0; padding-left: 18px; }
      .sig-line { display: inline-block; min-width: 220px; border-bottom: 1px solid #000; height: 18px; }
      .row { display: flex; gap: 24px; }
      .col { flex: 1; }
      .small { font-size: 12px; }
      .sig-img { max-height: 72px; width: auto; display: block; object-fit: contain; }
    </style>
  `

  const header = `
  <table class="header-table nobreak"
    style="width:100%; border-collapse: collapse; border:1px solid #000;">
    <tr>
      <!-- Logo Column -->
      <td style="width:180px; border:1px solid #000; padding:4px;">
        <img src="${headerImage}" alt="Lepharo" class="logo" />
      </td>

      <!-- Title Column -->
      <td style="
          text-align:center;
          font-weight:bold;
          border:1px solid #000;
          padding:4px;
        ">
        PRE-INCUBATION AGREEMENT
      </td>

      <!-- Meta Column (No inner border box!) -->
      <td style="
          text-align:right;
          border:1px solid #000;
          padding:4px;
        ">
        <div class="meta-box" style="text-align:left; border:none; padding:0;">
          <div><span class="bold">Form No:</span> LEP QMS 074 F</div>
          <div><span class="bold">Revision No:</span> 0</div>
          <div><span class="bold">Effective date:</span> ${effectiveDate}</div>
        </div>
      </td>
    </tr>
  </table>
`

  let body = `
    <div class="center" style="margin-top:18px">
      <div class="bold">PRE-INCUBATION, CONFIDENTIALITY NON-DISCLOSURE, AND NON-CIRCUMVENTION</div>
      <div class="bold">AGREEMENT</div>
    </div>

    <p class="center" style="margin-top:18px">Entered into by and between</p>

    <p class="center">
      <span class="bold">LEPHARO INCUBATION PROGRAMME NPC</span><br/>
      (REG. NO: 2006/028126/08)<br/>
      (“The Disclosing Party”)
    </p>

    <p class="center">And</p>

    <p class="center">
      <span class="bold">${SME}</span>${regLine ? `<br/>${regLine}` : ''}<br/>
      (“The Receiving Party”)
    </p>

    <p class="center">
      Represented by the following Director<br/>
      <span class="bold">${safe(directorName)}</span><br/>
      Identity No: ${safe(directorId)}
    </p>

    <div class="h1">THE AGREEMENT</div>

    <ol>
      <li class="justify" style="margin-bottom:8px">
        WHEREAS INCUBATOR and INCUBATEE (the “Parties”) have expressed a mutual desire to enter into a business relationship and further hereby accept to take part in the incubation program as a prospect incubatee, being an observer and voluntarily participate without fail in the required meetings and engagement platforms. The period for this Pre Incubation period is Three Months (03). However, Lepharo shall reserve all its sole discretionary powers as deems fit and proper to terminate or extend the Pre Incubation Agreement.
      </li>
      <li class="justify" style="margin-bottom:8px">
        Save the provisions above in paragraph 1, the Pre-Incubation shall commence on the <span class="bold">${fmt(
          start as any
        )}</span> and terminates on the <span class="bold">${fmt(
    end as any
  )}</span> understand that this period will be anything from 4 (four) weeks to 12 (twelve) weeks; starting from <span class="bold">${fmt(
    start as any
  )}</span>.
      </li>
      <li class="justify" style="margin-bottom:8px">
        During this period <span class="bold">${SME}</span> and its Directors and/or Members will be assessed for potential to become members in PROGRAMME and allow Directors and/or Members to make an informed decision before signing on as members. <span class="bold">${SME}</span>: Products &amp; Services: ${products}
      </li>
      <li class="justify" style="margin-bottom:8px">
        AND WHEREAS pursuant to the intention and the Purpose alone and for no other reason or purpose, the parties may have exchanged and may further exchange confidential information and wish to protect their proprietary and commercial interests in respect of the Confidential Information;
      </li>
    </ol>

    <p class="justify" style="margin-top:8px"><span class="bold">NOW THEREFORE IT IS AGREED AS FOLLOWS:</span></p>

    <p class="bold" style="margin:12px 0 4px">1  INTERPRETATION</p>
    <p class="justify small">In this Agreement the following expressions bear the meanings assigned to them below and cognate expressions bear corresponding meanings:-</p>
    <p class="justify small">
      1.1 “Confidential Information” means information or data, whether disclosed orally or in writing and which, upon disclosure, is identified as confidential, including, without limitation, any information relating to a Party:<br/>
      1.1.1 business, business policies, business plans, pricing models and other business, financial and commercial information;<br/>
      1.1.2 know-how, trade secrets, specifications, drawings, sketches, models, samples, data, diagrams, and flow charts;<br/>
      1.1.3 business relationships, products, services, suppliers, customers and clients (both existing and potential) sales and sales figures;<br/>
      1.1.4 technical information, including use of technology, systems, hardware, software (and the incidence of any faults therein), architectural information, demonstrations, processes and machinery, and related material and documentation;<br/>
      1.1.5 past, present, and future research and development;<br/>
      1.1.6 strategic objectives and planning;<br/>
      1.1.7 claims and litigation (actual or potential);<br/>
      1.1.8 plans, designs, drawings, functional and technical requirements, and specifications;<br/><br/>
      But excluding information or data which –<br/>
      1.1.9  is at the time of disclosure to the Receiving Party or thereafter comes without breach of any confidentiality obligations by the Receiving Party, within the public domain;<br/>
      1.1.10 is, at the time of such disclosure, already within the possession of the Receiving Party free from any obligation of confidence, or it has been or is subsequently independently developed by the Receiving Party without reference to the Disclosing Party’s Confidential Information; or<br/>
      1.1.11 after such disclosure to the Receiving Party is lawfully received by the Receiving Party from a third party free from any obligation of confidence to the Disclosing Party in respect of that information,<br/><br/>
      provided that the onus shall at all times rest on the Receiving Party to establish that such information falls within the exceptions contained in clauses 1.1.9 to 1.1.11 (inclusive) and provided further that information disclosed in terms of this Agreement will not be deemed to be within the foregoing exceptions merely because such information is embraced by more general information in a Party's possession;
    </p>

    <p class="justify small">1.2 "Disclosing Purpose" means the purpose or reason for which the Parties have entered or will enter into discussions resulting in the disclosure of Confidential Information to each other, as specified on the cover page of this Agreement;</p>
    <p class="justify small">1.3 "Parties" means the Parties to this Agreement, and "Party" means either one of the Parties (as the context may require); and</p>
    <p class="justify small">1.4 "Permitted Recipients" means employees, Directors, and/or Members, officers, professional advisers, agents, financiers, and consultants of the Receiving Party.</p>

    <p class="bold" style="margin:12px 0 4px">2  RECITALS</p>
    <p class="justify small">2.1 With reference to the provisions in Clause 1 of the Pre Incubation part of this document above, the Parties wish to hold discussions for the Disclosing Purpose, during which certain confidential and proprietary information will be disclosed by the Disclosing Party to the Receiving Party.</p>
    <p class="justify small">2.2 The Parties wish to record the basis on which the Receiving Party will honor and protect the confidentiality of the Disclosing Party's Confidential Information.</p>

    <p class="bold" style="margin:12px 0 4px">3  RESTRICTIONS ON DISCLOSURE AND USE</p>
    <p class="justify small">
      The Receiving Party hereby agrees, insofar as it may be the Receiving Party:-<br/><br/>
      3.1 That it shall only be entitled to use the Confidential Information of the Disclosing Party for the specific purposes set out in the Disclosing Purpose, and it shall not utilize, employ, exploit or in any other manner use the Confidential Information of the Disclosing Party for any purpose other than the Disclosing Purpose;<br/>
      3.2 Subject to clause 3.3 and 6.2, not to disclose the Confidential Information of the Disclosing Party to any third party or publish such information in any manner, for any purpose or purpose whatsoever without the prior written consent of the Disclosing Party, which consent may be reasonably withheld by the Disclosing Party;<br/>
      3.3 It will restrict the dissemination of the Confidential Information of the Disclosing Party to only those of its personnel and professional advisers of good repute, who are under a duty as employees or under a professional duty of confidence as advisers as regards information parted to them and who are actively involved in the Disclosing Purpose, then only on a "need to know" basis, and will take all practical steps to impress upon those personnel and advisers who need to be given access to Confidential Information the terms of this Agreement and the secret and confidential nature of the Confidential Information and secure their agreement to treat such information as confidential consistently with the terms of this Agreement;<br/>
      3.4 It shall not be a breach of this Agreement if the Receiving Party is required by any applicable law or the rules of any applicable stock or securities exchange or other applicable regulatory organization to disclose Confidential Information of the Disclosing Party or if such Confidential Information is or becomes generally available to the public other than by the gross negligence or willful default of the Receiving Party.
    </p>

    <p class="bold" style="margin:12px 0 4px">4  NON-CIRCUMVENTION & DISCLOSURE</p>
    <p class="justify small">
      4.1 Subject to clause 4.2.2, the Receiving Party acknowledges that in relation to any potential investment, joint venture, and/or business opportunity, of any nature whatsoever, which it first becomes aware of directly through a specific disclosure made by the Disclosing Party to the Receiving Party during the duration of this Agreement, it will not either directly or indirectly whether alone or with others, negotiate or participate in any transaction or series of transactions or related transaction of any nature which circumvents the Disclosing Party.<br/>
      4.2 Notwithstanding any of the other provisions hereof, the Receiving Party shall not be entitled, either directly or indirectly, whether alone or with others, to negotiate, pursue and/or participate in any transaction or series of transactions or related transactions relating to or in connection with or arising from this discussions and/or introduction to a potential client or business opportunity, of any nature whatsoever, which: -<br/>
      4.2.1 The Receiving Party was not aware of before the specific disclosure thereof by the Disclosing Party, it is agreed that the Receiving Party shall bear the onus of proving any allegation that such business opportunity was not first disclosed by it to the Disclosing Party; or<br/>
      4.2.2 The Receiving Party becomes aware of, in the ordinary conduct of its business, through its interactions with other parties.<br/>
      4.2.3 The Receiving Party shall at all times engage the Disclosing Party in persuasion and/or delivery of the opportunity in question.<br/>
      4.2.4 The opportunity and/ or the business in question shall at all times remain the business of the Disclosing Party.<br/>
      4.2.5 In case of circumvention, the parties agree and guarantee that they will pay a legal monetary penalty that is equal to the revenue, commission, equity, fee future loss the circumvented party should have realized in such transactions, by the person(s) engaged on the circumvention for each occurrence. if either party commences legal proceedings to interpret or enforce the terms of this agreement, the aggrieved party will be entitled to recover inter alia court costs and reasonable attorney fees, and any losses.
    </p>

    <p class="bold" style="margin:12px 0 4px">5  TITLE</p>
    <p class="justify small">The Receiving Party shall acquire no right, title, or interest in any information disclosed to it by the Disclosing Party pursuant to this Agreement and it shall not remove any proprietary legends from materials containing the Confidential Information. In addition, the Receiving Party shall further, upon written request from the Disclosing Party, add any propriety legend to such materials.</p>

    <p class="bold" style="margin:12px 0 4px">6  STANDARD OF CARE</p>
    <p class="justify small">
      6.1 Standard of Care. The Receiving Party shall protect the Confidential Information of the Disclosing Party with not less than the same endeavour which a reasonable man would use to protect his Confidential Information. Should the Receiving Party become aware of any unauthorised copying, disclosure, or use of Disclosing Party's Confidential Information, it shall immediately notify the Disclosing Party thereof in writing and, without in any way detracting from the Disclosing Party's rights and remedies in terms of this Agreement, take such steps as may be necessary to prevent a recurrence thereof.<br/><br/>
      6.2 Forced Disclosure. To the extent that the Receiving Party is ordered to disclose any of the Disclosing Party's Confidential Information pursuant to a judicial or governmental request, requirement or order or the rules of any applicable stock or securities exchange or other applicable regulatory organization (hereafter called the "Forced Disclosure"), the Receiving Party shall promptly notify the Disclosing Party thereof and take any reasonable steps to assist the Disclosing Party in contesting such a request, requirement or order, at the cost of the Disclosing Party, or otherwise take all reasonable steps to protect the Disclosing Party's rights prior to Forced Disclosure, at the cost of the Disclosing Party, and if such disclosure must be made then to take all such steps as may be reasonable, practicable and legally permitted in the circumstances to agree to the timing and contents of such announcement or disclosure with the Disclosing Party before making the same.
    </p>

    <p class="bold" style="margin:12px 0 4px">7  RETURN OF INFORMATION</p>
    <p class="justify small">
      7.1 Return on Request. The Disclosing Party may at any time request the Receiving Party to return any material containing, pertaining to, or relating to the Confidential Information of the Disclosing Party and may, in addition, request the Receiving Party to furnish a written statement signed by a Director to the effect that, as far as such Director is aware, upon such return, the Receiving Party has not retained in its possession, or under its control, either directly or indirectly, any such material.<br/>
      7.2 Destruction. Alternatively to clause 7.1, the Receiving Party shall, at the instance of the Disclosing Party, destroy such material and furnish the Disclosing Party with a written statement signed by a Director to the effect that such material has been destroyed, provided that for purposes of this clause 7, the obligation to destroy such material shall not include an obligation on the Disclosing Party to destroy or procure the destruction of any Confidential Information that has been electronically archived or backed-up on any electronic device wherever situated or located.<br/>
      7.3 Compliance with a request. The Receiving Party shall comply with a request in terms of this clause 7 within 3 (three) days of receipt of such request, or such shorter period as the Disclosing Party may demand, so long as this allows the Receiving Party adequate time to comply.<br/>
      7.4 Exclusion. The Receiving Party shall not be required to return, destroy or delete Confidential Information to the extent that it is required to retain such Confidential Information by law or to satisfy the rules and regulations of a regulatory body to which the Receiving Party is subject. For the avoidance of doubt, the obligations of confidentiality contained in this Agreement will continue to apply to such retained Confidential Information.
    </p>

    <p class="bold" style="margin:12px 0 4px">8  DURATION</p>
    <p class="justify small">The obligations imposed by this Agreement shall expire 1 (one) year from the date of signature of this Agreement by the Party signing last.</p>

    <p class="bold" style="margin:12px 0 4px">9  BREACH</p>
    <p class="justify small">
      9.1 This Agreement may not be canceled for breach.<br/>
      9.2 An aggrieved Party’s sole remedies for breach are:<br/>
      9.2.1 to seek interdictory relief; and/or<br/>
      9.2.2 To claim specific performance and/or damages.<br/>
      9.3 The aggrieved party is not required to give notice to the defaulting party prior to the institution of interdict proceedings or action
    </p>

    <p class="bold" style="margin:12px 0 4px">10 DOMICILIA AND NOTICES</p>
    <p class="justify small">
      10.1 Addresses. The Parties hereby choose domicilium citandi et executandi ("domicilium") for all purposes under this Agreement the physical addresses set below:<br/><br/>
      <span class="bold">INCUBATOR: LEPHARO INCUBATION PROGRAMME NPC</span><br/>
      NO: 1PLOVER STREET, STRUISBULT, 1560.<br/>
      CONTACT NO: +27 11 363 3920 / +27 81 454 9490.<br/><br/>
      <span class="bold">INCUBATEE: ${SME}</span><br/>
      ADDRESS: ${safe(companyAddress)}<br/>
      EMAIL: ${safe(companyEmail)}<br/>
      CONTACT NO: ${safe(companyPhone)}.
    </p>
    <p class="justify small">10.2 Change of Address. Either Party may give written notice to the other, change its domicilium to any other address or number in the Republic of South Africa, provided that such change shall take effect fourteen 14 (fourteen) days after delivery of such written notice.</p>
    <p class="justify small">10.3 Deemed Receipt. Any notice to be given by either Party to the other shall be deemed to have been duly received by the other Party -<br/>10.3.1 if delivered to the addressee’s domicilium by hand during business hours on a business day, on the date of delivery thereof, or<br/>10.3.2 If sent by fax to the addressee on the first business day following the date of sending thereof.</p>
    <p class="justify small">10.4 Use of email. The parties record that whilst they may correspond via email during the currency of this Agreement for operational reasons, no formal notice required in terms of this Agreement, nor any amendment or variation to this Agreement may be given or concluded via email.</p>

    <p class="bold" style="margin:12px 0 4px">11 GENERAL</p>
    <p class="justify small">
      11.1 Entire agreement. This Agreement, together with the Schedules hereto and the documents, records, or attachments referred to herein or therein, constitute the entire agreement between the Parties in respect of the subject matter hereof.<br/>
      11.2 Variation. No amendment or modification to this Agreement shall be effective unless in writing and signed by authorized signatories of the Parties.<br/>
      11.3 Waiver. No granting of time or forbearance shall be or be deemed to be a waiver of any term or condition of this Agreement and no waiver of any breach shall operate a waiver of any continuing or subsequent breach.<br/>
      11.4 Applicable Law. This Agreement shall be governed and construed according to the laws of the Republic of South Africa but other references herein to "applicable law" shall, for the avoidance of doubt, mean laws (or regulations) applying to a Party in any jurisdiction to which it is subject.<br/>
      11.5 Costs. Each Party shall be responsible for its own legal and other costs relating to the negotiation of this Agreement.
    </p>

    <div class="page"></div>

    <p class="bold" style="margin-top:0">12 SIGNATURES</p>

    <p class="small">The Incubatee or SMME</p>
    <p class="small">
      SIGNED AT <span class="underline">${safe(
        signPlace
      )}</span> on this <span class="underline">${signedDatePart(
    incubateeSignedAt,
    'DD'
  )}</span> day of <span class="underline">${signedDatePart(
    incubateeSignedAt,
    'MMMM'
  )}</span> <span class="underline">${signedDatePart(
    incubateeSignedAt,
    'YYYY'
  )}</span>.
    </p>

    <p class="small">
      Name &amp; surname: <span class="underline">${safe(
        directorName
      )}</span> &nbsp;&nbsp;&nbsp;
      Position in the company: <span class="underline">${safe(
        directorPosition
      )}</span>
    </p>

    <p class="small">
      ${
        incubateeSignatureImg
          ? `<img src="${incubateeSignatureImg}" alt="Signature" class="sig-img" />`
          : '<span class="sig-line"></span>'
      }<br/>
      <span class="small">[For and on behalf of the INCUBATEE, duly authorized]</span>
    </p>

    <div class="row small" style="margin:8px 0 18px">
      <div class="col">Witness:<br/><span class="sig-line"></span><br/>Full Name &amp; Surname</div>
      <div class="col"><span class="sig-line"></span><br/>Signature</div>
    </div>

    <p class="small">The Incubator</p>
    <p class="small">
      SIGNED AT <span class="underline">${safe(
        signPlace || '__________'
      )}</span> on this <span class="underline">${signedDatePart(
    romSignedAt,
    'DD'
  )}</span> day of <span class="underline">${signedDatePart(
    romSignedAt,
    'MMMM'
  )}</span> <span class="underline">${signedDatePart(
    romSignedAt,
    'YYYY'
  )}</span>.
    </p>
    <p class="small">
      Name &amp; surname: <span class="underline">${safe(
        romNameToRender
      )}</span> &nbsp;&nbsp;&nbsp;
      Position in the company: <span class="underline">${safe(
        romPositionToRender || 'Operations'
      )}</span>
    </p>
    <p class="small">
      ${
        romSignatureImg
          ? `<img src="${romSignatureImg}" alt="ROM Signature" class="sig-img" />`
          : '<span class="sig-line"></span>'
      }<br/>
      <span class="small">[For and on behalf of the INCUBATOR, duly authorized]</span>
    </p>
  `

  body = body
    .replaceAll('DITSOGO GROUP (PTY)LTD', SME)
    .replaceAll('DITSOGO GROUP (Pty)Ltd', SME)
    .replaceAll('TEBOGO ANNA MOSITA', directorName || '__________')
    .replaceAll('TEBOGO MOSITO', directorName || '__________')

  return `${css}<div class="page">${header}${body}</div>`
}

/** Fetch an image URL into a Uint8Array for docx ImageRun */
async function fetchImageBytes (url?: string): Promise<Uint8Array | undefined> {
  if (!url) return undefined
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

/** Build a Word (.docx) blob using the docx library that mirrors the header table + signature blocks. */
function buildHeaderTable ({
  logoBytes,
  effectiveDate
}: {
  logoBytes?: Uint8Array
  effectiveDate: string
}) {
  // Define a black border for all lines
  const border = {
    style: BorderStyle.SINGLE,
    size: 8, // thickness
    color: '000000'
  }

  return new DTable({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,

    // ✅ Make the entire table have borders
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideH: border,
      insideV: border
    },

    rows: [
      new DRow({
        children: [
          // --- Column 1: Lepharo Logo ---
          new DCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            borders: border,
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: logoBytes
                  ? [
                      new ImageRun({
                        data: logoBytes,
                        transformation: { width: 160, height: 48 }
                      })
                    ]
                  : [new TextRun('LEPHARO LOGO')]
              })
            ]
          }),

          // --- Column 2: Title ---
          new DCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            borders: border,
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'PRE-INCUBATION AGREEMENT',
                    bold: true,
                    size: 28
                  })
                ]
              })
            ]
          }),

          // --- Column 3: Form details (bordered box) ---
          new DCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            borders: border,
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: 'Form No: LEP QMS 074 F',
                    bold: true,
                    size: 20
                  })
                ],
                spacing: { after: 80 }
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({ text: 'Revision No: 0', bold: true, size: 20 })
                ],
                spacing: { after: 80 }
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: `Effective date: ${effectiveDate}`,
                    bold: true,
                    size: 20
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  })
}

export async function buildPreIncubationDocx (args: {
  headerImage?: string
  effectiveDate?: string
  registrationNumber?: string
  companyName?: string
  directorName?: string
  directorId?: string
  start?: Date | Dayjs
  end?: Date | Dayjs
  products?: string
  signPlace?: string
  companyAddress?: string
  companyEmail?: string
  companyPhone?: string
  directorPosition?: string
  incubateeSignatureImg?: string | undefined
  romSignatureImg?: string | undefined
  romNameToRender?: string | undefined
  romPositionToRender?: string | undefined
  incubateeSignedAt?: any
  romSignedAt?: any
}): Promise<Blob> {
  const {
    headerImage = HEADER_IMAGE,
    effectiveDate = dayjs().format('DD MMMM YYYY'),
    registrationNumber,
    companyName,
    directorName,
    directorId,
    start,
    end,
    products = '________________',
    signPlace,
    companyAddress,
    companyEmail,
    companyPhone,
    directorPosition = 'MANAGING DIRECTOR',
    incubateeSignatureImg,
    romSignatureImg,
    romNameToRender,
    romPositionToRender,
    incubateeSignedAt,
    romSignedAt
  } = args

  const SME = safe(companyName)
  const regLine = registrationNumber ? `Reg. No: ${registrationNumber}` : ''

  // fetch images
  const smmeSigBytes = await fetchImageBytes(incubateeSignatureImg)
  const romSigBytes = await fetchImageBytes(romSignatureImg)

  // reusable helpers
  const p = (text: string, opts: Partial<Paragraph> = {}) =>
    new Paragraph({
      children: [new TextRun({ text })],
      spacing: { after: 120 },
      ...opts
    })

  const pSmall = (text: string) =>
    new Paragraph({
      children: [new TextRun({ text, size: 20 })],
      spacing: { after: 100 }
    })

  const pBold = (text: string) =>
    new Paragraph({
      children: [new TextRun({ text, bold: true })],
      spacing: { after: 100 }
    })

  const pCenter = (text: string, bold = false) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold })],
      spacing: { after: 120 }
    })

  const underlineVal = (text: string) => new TextRun({ text, underline: {} })

  // Header table with nested “meta” table (borders)
  const metaTable = new DTable({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new DRow({
        children: [
          new DCell({
            children: [pSmall('Form No: LEP QMS 074 F')],
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              left: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              right: { style: BorderStyle.SINGLE, size: 8, color: '000000' }
            }
          })
        ]
      }),
      new DRow({
        children: [
          new DCell({
            children: [pSmall('Revision No: 0')],
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              left: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              right: { style: BorderStyle.SINGLE, size: 8, color: '000000' }
            }
          })
        ]
      }),
      new DRow({
        children: [
          new DCell({
            children: [pSmall(`Effective date: ${effectiveDate}`)],
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              left: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              right: { style: BorderStyle.SINGLE, size: 8, color: '000000' }
            }
          })
        ]
      })
    ]
  })

  // ——— Title Block
  const titleBlock: Paragraph[] = [
    new Paragraph({ text: '', spacing: { after: 200 } }),
    pCenter(
      'PRE-INCUBATION, CONFIDENTIALITY NON-DISCLOSURE, AND NON-CIRCUMVENTION',
      true
    ),
    pCenter('AGREEMENT', true),
    new Paragraph({ text: '', spacing: { after: 200 } }),
    pCenter('Entered into by and between'),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'LEPHARO INCUBATION PROGRAMME NPC', bold: true }),
        new TextRun('\n(REG. NO: 2006/028126/08)'),
        new TextRun('\n(“The Disclosing Party”)')
      ],
      spacing: { after: 200 }
    }),
    pCenter('And'),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: SME, bold: true }),
        new TextRun(regLine ? `\n${regLine}` : ''),
        new TextRun('\n(“The Receiving Party”)')
      ],
      spacing: { after: 200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun('Represented by the following Director'),
        new TextRun({ text: `\n${safe(directorName)}`, bold: true }),
        new TextRun({ text: `\nIdentity No: ${safe(directorId)}` })
      ],
      spacing: { after: 200 }
    }),
    new Paragraph({
      text: 'THE AGREEMENT',
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 }
    })
  ]

  // ——— Full clauses
  const fullClauses: Paragraph[] = [
    pSmall(
      'WHEREAS INCUBATOR and INCUBATEE (the “Parties”) have expressed a mutual desire to enter into a business relationship and further hereby accept to take part in the incubation program as a prospect incubatee, being an observer and voluntarily participate without fail in the required meetings and engagement platforms. The period for this Pre Incubation period is Three Months (03). However, Lepharo shall reserve all its sole discretionary powers as deems fit and proper to terminate or extend the Pre Incubation Agreement.'
    ),
    pSmall(
      `Save the provisions above in paragraph 1, the Pre-Incubation shall commence on the ${fmt(
        start as any
      )} and terminates on the ${fmt(
        end as any
      )} understand that this period will be anything from 4 (four) weeks to 12 (twelve) weeks; starting from ${fmt(
        start as any
      )}.`
    ),
    pSmall(
      `During this period ${SME} and its Directors and/or Members will be assessed for potential to become members in PROGRAMME and allow Directors and/or Members to make an informed decision before signing on as members. ${SME}: Products & Services: ${products}`
    ),
    pSmall(
      'AND WHEREAS pursuant to the intention and the Purpose alone and for no other reason or purpose, the parties may have exchanged and may further exchange confidential information and wish to protect their proprietary and commercial interests in respect of the Confidential Information;'
    ),

    pBold('NOW THEREFORE IT IS AGREED AS FOLLOWS:'),
    pBold('1  INTERPRETATION'),
    pSmall(
      'In this Agreement the following expressions bear the meanings assigned to them below and cognate expressions bear corresponding meanings:-'
    ),
    pSmall(
      '1.1 “Confidential Information” means information or data, whether disclosed orally or in writing and which, upon disclosure, is identified as confidential, including, without limitation, any information relating to a Party:\n' +
        '1.1.1 business, business policies, business plans, pricing models and other business, financial and commercial information;\n' +
        '1.1.2 know-how, trade secrets, specifications, drawings, sketches, models, samples, data, diagrams, and flow charts;\n' +
        '1.1.3 business relationships, products, services, suppliers, customers and clients (both existing and potential) sales and sales figures;\n' +
        '1.1.4 technical information, including use of technology, systems, hardware, software (and the incidence of any faults therein), architectural information, demonstrations, processes and machinery, and related material and documentation;\n' +
        '1.1.5 past, present, and future research and development;\n' +
        '1.1.6 strategic objectives and planning;\n' +
        '1.1.7 claims and litigation (actual or potential);\n' +
        '1.1.8 plans, designs, drawings, functional and technical requirements, and specifications;\n\n' +
        'But excluding information or data which –\n' +
        '1.1.9 is at the time of disclosure to the Receiving Party or thereafter comes without breach of any confidentiality obligations by the Receiving Party, within the public domain;\n' +
        '1.1.10 is, at the time of such disclosure, already within the possession of the Receiving Party free from any obligation of confidence, or it has been or is subsequently independently developed by the Receiving Party without reference to the Disclosing Party’s Confidential Information; or\n' +
        '1.1.11 after such disclosure to the Receiving Party is lawfully received by the Receiving Party from a third party free from any obligation of confidence to the Disclosing Party in respect of that information,\n\n' +
        "provided that the onus shall at all times rest on the Receiving Party to establish that such information falls within the exceptions contained in clauses 1.1.9 to 1.1.11 (inclusive) and provided further that information disclosed in terms of this Agreement will not be deemed to be within the foregoing exceptions merely because such information is embraced by more general information in a Party's possession;"
    ),
    pSmall(
      '1.2 "Disclosing Purpose" means the purpose or reason for which the Parties have entered or will enter into discussions resulting in the disclosure of Confidential Information to each other, as specified on the cover page of this Agreement;'
    ),
    pSmall(
      '1.3 "Parties" means the Parties to this Agreement, and "Party" means either one of the Parties (as the context may require); and'
    ),
    pSmall(
      '1.4 "Permitted Recipients" means employees, Directors, and/or Members, officers, professional advisers, agents, financiers, and consultants of the Receiving Party.'
    ),

    pBold('2  RECITALS'),
    pSmall(
      '2.1 With reference to the provisions in Clause 1 of the Pre Incubation part of this document above, the Parties wish to hold discussions for the Disclosing Purpose, during which certain confidential and proprietary information will be disclosed by the Disclosing Party to the Receiving Party.'
    ),
    pSmall(
      "2.2 The Parties wish to record the basis on which the Receiving Party will honor and protect the confidentiality of the Disclosing Party's Confidential Information."
    ),

    pBold('3  RESTRICTIONS ON DISCLOSURE AND USE'),
    pSmall(
      'The Receiving Party hereby agrees, insofar as it may be the Receiving Party:-\n\n' +
        '3.1 That it shall only be entitled to use the Confidential Information of the Disclosing Party for the specific purposes set out in the Disclosing Purpose, and it shall not utilize, employ, exploit or in any other manner use the Confidential Information of the Disclosing Party for any purpose other than the Disclosing Purpose;\n' +
        '3.2 Subject to clause 3.3 and 6.2, not to disclose the Confidential Information of the Disclosing Party to any third party or publish such information in any manner, for any purpose or purpose whatsoever without the prior written consent of the Disclosing Party, which consent may be reasonably withheld by the Disclosing Party;\n' +
        '3.3 It will restrict the dissemination of the Confidential Information of the Disclosing Party to only those of its personnel and professional advisers of good repute, who are under a duty as employees or under a professional duty of confidence as advisers as regards information parted to them and who are actively involved in the Disclosing Purpose, then only on a "need to know" basis, and will take all practical steps to impress upon those personnel and advisers who need to be given access to Confidential Information the terms of this Agreement and the secret and confidential nature of the Confidential Information and secure their agreement to treat such information as confidential consistently with the terms of this Agreement;\n' +
        '3.4 It shall not be a breach of this Agreement if the Receiving Party is required by any applicable law or the rules of any applicable stock or securities exchange or other applicable regulatory organization to disclose Confidential Information of the Disclosing Party or if such Confidential Information is or becomes generally available to the public other than by the gross negligence or willful default of the Receiving Party.'
    ),

    pBold('4  NON-CIRCUMVENTION & DISCLOSURE'),
    pSmall(
      '4.1 Subject to clause 4.2.2, the Receiving Party acknowledges that in relation to any potential investment, joint venture, and/or business opportunity, of any nature whatsoever, which it first becomes aware of directly through a specific disclosure made by the Disclosing Party to the Receiving Party during the duration of this Agreement, it will not either directly or indirectly whether alone or with others, negotiate or participate in any transaction or series of transactions or related transaction of any nature which circumvents the Disclosing Party.\n' +
        '4.2 Notwithstanding any of the other provisions hereof, the Receiving Party shall not be entitled, either directly or indirectly, whether alone or with others, to negotiate, pursue and/or participate in any transaction or series of transactions or related transactions relating to or in connection with or arising from this discussions and/or introduction to a potential client or business opportunity, of any nature whatsoever, which: -\n' +
        '4.2.1 The Receiving Party was not aware of before the specific disclosure thereof by the Disclosing Party, it is agreed that the Receiving Party shall bear the onus of proving any allegation that such business opportunity was not first disclosed by it to the Disclosing Party; or\n' +
        '4.2.2 The Receiving Party becomes aware of, in the ordinary conduct of its business, through its interactions with other parties.\n' +
        '4.2.3 The Receiving Party shall at all times engage the Disclosing Party in persuasion and/or delivery of the opportunity in question.\n' +
        '4.2.4 The opportunity and/ or the business in question shall at all times remain the business of the Disclosing Party.\n' +
        '4.2.5 In case of circumvention, the parties agree and guarantee that they will pay a legal monetary penalty that is equal to the revenue, commission, equity, fee future loss the circumvented party should have realized in such transactions, by the person(s) engaged on the circumvention for each occurrence. if either party commences legal proceedings to interpret or enforce the terms of this agreement, the aggrieved party will be entitled to recover inter alia court costs and reasonable attorney fees, and any losses.'
    ),

    pBold('5  TITLE'),
    pSmall(
      'The Receiving Party shall acquire no right, title, or interest in any information disclosed to it by the Disclosing Party pursuant to this Agreement and it shall not remove any proprietary legends from materials containing the Confidential Information. In addition, the Receiving Party shall further, upon written request from the Disclosing Party, add any propriety legend to such materials.'
    ),

    pBold('6  STANDARD OF CARE'),
    pSmall(
      "6.1 Standard of Care. The Receiving Party shall protect the Confidential Information of the Disclosing Party with not less than the same endeavour which a reasonable man would use to protect his Confidential Information. Should the Receiving Party become aware of any unauthorised copying, disclosure, or use of Disclosing Party's Confidential Information, it shall immediately notify the Disclosing Party thereof in writing and, without in any way detracting from the Disclosing Party's rights and remedies in terms of this Agreement, take such steps as may be necessary to prevent a recurrence thereof.\n\n" +
        '6.2 Forced Disclosure. To the extent that the Receiving Party is ordered to disclose any of the Disclosing Party\'s Confidential Information pursuant to a judicial or governmental request, requirement or order or the rules of any applicable stock or securities exchange or other applicable regulatory organization (hereafter called the "Forced Disclosure"), the Receiving Party shall promptly notify the Disclosing Party thereof and take any reasonable steps to assist the Disclosing Party in contesting such a request, requirement or order, at the cost of the Disclosing Party, or otherwise take all reasonable steps to protect the Disclosing Party\'s rights prior to Forced Disclosure, at the cost of the Disclosing Party, and if such disclosure must be made then to take all such steps as may be reasonable, practicable and legally permitted in the circumstances to agree to the timing and contents of such announcement or disclosure with the Disclosing Party before making the same.'
    ),

    pBold('7  RETURN OF INFORMATION'),
    pSmall(
      '7.1 Return on Request. The Disclosing Party may at any time request the Receiving Party to return any material containing, pertaining to, or relating to the Confidential Information of the Disclosing Party and may, in addition, request the Receiving Party to furnish a written statement signed by a Director to the effect that, as far as such Director is aware, upon such return, the Receiving Party has not retained in its possession, or under its control, either directly or indirectly, any such material.\n' +
        '7.2 Destruction. Alternatively to clause 7.1, the Receiving Party shall, at the instance of the Disclosing Party, destroy such material and furnish the Disclosing Party with a written statement signed by a Director to the effect that such material has been destroyed, provided that for purposes of this clause 7, the obligation to destroy such material shall not include an obligation on the Disclosing Party to destroy or procure the destruction of any Confidential Information that has been electronically archived or backed-up on any electronic device wherever situated or located.\n' +
        '7.3 Compliance with a request. The Receiving Party shall comply with a request in terms of this clause 7 within 3 (three) days of receipt of such request, or such shorter period as the Disclosing Party may demand, so long as this allows the Receiving Party adequate time to comply.\n' +
        '7.4 Exclusion. The Receiving Party shall not be required to return, destroy or delete Confidential Information to the extent that it is required to retain such Confidential Information by law or to satisfy the rules and regulations of a regulatory body to which the Receiving Party is subject. For the avoidance of doubt, the obligations of confidentiality contained in this Agreement will continue to apply to such retained Confidential Information.'
    ),

    pBold('8  DURATION'),
    pSmall(
      'The obligations imposed by this Agreement shall expire 1 (one) year from the date of signature of this Agreement by the Party signing last.'
    ),

    pBold('9  BREACH'),
    pSmall('9.1 This Agreement may not be canceled for breach.'),
    pSmall('9.2 An aggrieved Party’s sole remedies for breach are:'),
    pSmall('9.2.1 to seek interdictory relief; and/or'),
    pSmall('9.2.2 To claim specific performance and/or damages.'),
    pSmall(
      '9.3 The aggrieved party is not required to give notice to the defaulting party prior to the institution of interdict proceedings or action'
    ),

    pBold('10 DOMICILIA AND NOTICES'),
    pSmall(
      '10.1 Addresses. The Parties hereby choose domicilium citandi et executandi ("domicilium") for all purposes under this Agreement the physical addresses set below:\n\n' +
        'INCUBATOR: LEPHARO INCUBATION PROGRAMME NPC\n' +
        'NO: 1 PLOVER STREET, STRUISBULT, 1560.\n' +
        'CONTACT NO: +27 11 363 3920 / +27 81 454 9490.\n\n' +
        `INCUBATEE: ${SME}\n` +
        `ADDRESS: ${safe(companyAddress)}\n` +
        `EMAIL: ${safe(companyEmail)}\n` +
        `CONTACT NO: ${safe(companyPhone)}.`
    ),
    pSmall(
      '10.2 Change of Address. Either Party may give written notice to the other, change its domicilium to any other address or number in the Republic of South Africa, provided that such change shall take effect fourteen 14 (fourteen) days after delivery of such written notice.'
    ),
    pSmall(
      '10.3 Deemed Receipt. Any notice to be given by either Party to the other shall be deemed to have been duly received by the other Party - 10.3.1 if delivered to the addressee’s domicilium by hand during business hours on a business day, on the date of delivery thereof, or 10.3.2 If sent by fax to the addressee on the first business day following the date of sending thereof.'
    ),
    pSmall(
      '10.4 Use of email. The parties record that whilst they may correspond via email during the currency of this Agreement for operational reasons, no formal notice required in terms of this Agreement, nor any amendment or variation to this Agreement may be given or concluded via email.'
    ),

    pBold('11 GENERAL'),
    pSmall(
      '11.1 Entire agreement. This Agreement, together with the Schedules hereto and the documents, records, or attachments referred to herein or therein, constitute the entire agreement between the Parties in respect of the subject matter hereof.\n' +
        '11.2 Variation. No amendment or modification to this Agreement shall be effective unless in writing and signed by authorized signatories of the Parties.\n' +
        '11.3 Waiver. No granting of time or forbearance shall be or be deemed to be a waiver of any term or condition of this Agreement and no waiver of any breach shall operate a waiver of any continuing or subsequent breach.\n' +
        '11.4 Applicable Law. This Agreement shall be governed and construed according to the laws of the Republic of South Africa but other references herein to "applicable law" shall, for the avoidance of doubt, mean laws (or regulations) applying to a Party in any jurisdiction to which it is subject.\n' +
        '11.5 Costs. Each Party shall be responsible for its own legal and other costs relating to the negotiation of this Agreement.'
    ),

    new Paragraph({ text: '', spacing: { before: 200, after: 200 } }),
    pBold('12 SIGNATURES'),

    pSmall('The Incubatee or SMME'),
    new Paragraph({
      children: [
        new TextRun('SIGNED AT '),
        underlineVal(safe(signPlace)),
        new TextRun(' on this '),
        underlineVal(signedDatePart(incubateeSignedAt, 'DD')),
        new TextRun(' day of '),
        underlineVal(signedDatePart(incubateeSignedAt, 'MMMM')),
        new TextRun(' '),
        underlineVal(signedDatePart(incubateeSignedAt, 'YYYY')),
        new TextRun('.')
      ],
      spacing: { after: 100 }
    }),
    pSmall(
      `Name & surname: ${safe(directorName)}    Position in the company: ${safe(
        directorPosition
      )}`
    ),
    ...(smmeSigBytes
      ? [
          new Paragraph({
            children: [
              new ImageRun({
                data: smmeSigBytes,
                transformation: { width: 220, height: 72 }
              })
            ],
            spacing: { after: 160 }
          })
        ]
      : [pSmall('________________ (signature)')]),

    pSmall(
      'Witness: ____________________________    Full Name & Surname ____________________________'
    ),
    pSmall('Signature: ____________________________'),

    new Paragraph({ text: '', spacing: { before: 200, after: 200 } }),
    pSmall('The Incubator'),
    new Paragraph({
      children: [
        new TextRun('SIGNED AT '),
        underlineVal(safe(signPlace || '__________')),
        new TextRun(' on this '),
        underlineVal(signedDatePart(romSignedAt, 'DD')),
        new TextRun(' day of '),
        underlineVal(signedDatePart(romSignedAt, 'MMMM')),
        new TextRun(' '),
        underlineVal(signedDatePart(romSignedAt, 'YYYY')),
        new TextRun('.')
      ],
      spacing: { after: 100 }
    }),
    pSmall(
      `Name & surname: ${safe(
        romNameToRender || ''
      )}    Position in the company: ${safe(
        romPositionToRender || 'Operations'
      )}`
    ),
    ...(romSigBytes
      ? [
          new Paragraph({
            children: [
              new ImageRun({
                data: romSigBytes,
                transformation: { width: 220, height: 72 }
              })
            ],
            spacing: { after: 160 }
          })
        ]
      : [pSmall('________________ (signature)')])
  ]

  const logoBytes = await fetchImageBytes(headerImage)
  const headerTable = buildHeaderTable({ logoBytes, effectiveDate })
  const defaultHeader = new Header({ children: [headerTable] })

  const doc = new DDocument({
    sections: [
      {
        headers: {
          default: defaultHeader,
          first: defaultHeader,
          even: defaultHeader
        },
        properties: {
          page: {
            margin: {
              top: 1200, // adds space after header
              right: 720,
              bottom: 720,
              left: 720,
              header: 360,
              footer: 360
            }
          }
        },
        children: [...titleBlock, ...fullClauses]
      }
    ]
  })

  const blob = await Packer.toBlob(doc)
  return blob
}

export async function downloadPreIncubationDocxFromArgs (
  args: Parameters<typeof buildPreIncubationDocx>[0],
  fileName = `Pre-Incubation_Agreement.docx`
) {
  const blob = await buildPreIncubationDocx(args)
  saveAs(blob, fileName)
}

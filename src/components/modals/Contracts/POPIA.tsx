import React, { useEffect, useRef, useState } from 'react'
import { DownloadOutlined } from '@ant-design/icons'
import { Button, message } from 'antd'
import {
  collection,
  getDocs,
  limit,
  query,
  updateDoc,
  where
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/firebase'
import { ScrollableContractModal } from './ScrollableContractModal'
import {
  downloadContractPDF,
  generateAndUploadContractPDF
} from '@/utils/generateContractPdf'

const POPIA_VERSION = 2
const POPIA_TEXT_HASH = 'popia_2026_08'
const POPIA_EFFECTIVE_DATE = '14 August 2026'

type PopiaContractModalProps = {
  open: boolean
  participantId: string
  onClose: () => void
  onSigned: (meta: {
    acceptedAt: string
    version: number
    textHash: string
    pdfUrl?: string
  }) => void
  readOnly?: boolean
  signedMeta?: any
}

async function fetchUserSignatureUrl(uid: string, email?: string | null) {
  let sigUrl = ''
  const byUid = await getDocs(
    query(collection(db, 'users'), where('uid', '==', uid), limit(1))
  )
  if (!byUid.empty) {
    sigUrl = (byUid.docs[0].data() as any)?.signatureURL || ''
  } else if (email) {
    const byEmail = await getDocs(
      query(collection(db, 'users'), where('email', '==', email), limit(1))
    )
    if (!byEmail.empty) {
      sigUrl = (byEmail.docs[0].data() as any)?.signatureURL || ''
    }
  }
  return sigUrl
}

async function fetchParticipantDigitalSignature(participantId: string) {
  const snapshot = await getDocs(
    query(
      collection(db, 'applications'),
      where('participantId', '==', participantId),
      limit(1)
    )
  )
  if (!snapshot.empty) return (snapshot.docs[0].data() as any)?.digitalSignature || ''
  return ''
}

const PopiaDocumentHeader = () => (
  <>
    <header className='popia-document-header'>
      <div className='popia-document-header__logo popia-document-header__logo--lepharo'>
        <img src='/assets/images/lepharo.png' alt='Lepharo Incubation Programme' />
      </div>
      <div className='popia-document-header__title'>
        <strong>PROTECTION OF PERSONAL INFORMATION ACT</strong>
        <span>Privacy Notice &amp; Data Processing Consent</span>
      </div>
      <div className='popia-document-header__logo popia-document-header__logo--quantilytix'>
        <img src='/assets/images/QuantilytixO.png' alt='Quantilytix' />
      </div>
    </header>
    <div className='popia-document-meta'>
      <span><strong>Document:</strong> POPIA Notice &amp; Consent</span>
      <span><strong>Version:</strong> {POPIA_VERSION}.0</span>
      <span><strong>Effective date:</strong> {POPIA_EFFECTIVE_DATE}</span>
    </div>
  </>
)

const PopiaDocumentFooter = ({ page }: { page: number }) => (
  <footer className='popia-document-footer'>
    <span>Lepharo Incubation Programme NPC | Confidential</span>
    <span>Page {page} of 2</span>
  </footer>
)

const formatSignedDate = (value: any) => {
  if (!value) return 'Pending signature'
  const date = value?.seconds ? new Date(value.seconds * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date not recorded'
  return date.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export const PopiaContractModal: React.FC<PopiaContractModalProps> = ({
  open,
  participantId,
  onClose,
  onSigned,
  readOnly,
  signedMeta
}) => {
  const [signing, setSigning] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [profileSignatureURL, setProfileSignatureURL] = useState('')
  const [previewSigned, setPreviewSigned] = useState(false)
  const [participantDetails, setParticipantDetails] = useState({
    name: '',
    email: '',
    businessName: ''
  })
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setPreviewSigned(false)
    const currentUser = getAuth().currentUser
    if (!readOnly && currentUser) {
      void fetchUserSignatureUrl(currentUser.uid, currentUser.email).then(setProfileSignatureURL)
    } else {
      setProfileSignatureURL('')
    }

    void getDocs(
      query(
        collection(db, 'applications'),
        where('participantId', '==', participantId),
        limit(1)
      )
    ).then(snapshot => {
      if (snapshot.empty) return
      const application = snapshot.docs[0].data() as any
      setParticipantDetails({
        name:
          application.participantName || application.applicantName ||
          application.contactPerson || application.fullName || '',
        email: application.email || application.contactEmail || '',
        businessName:
          application.beneficiaryName || application.companyName ||
          application.businessName || ''
      })
    }).catch(error => console.error('Could not load POPIA participant details.', error))
  }, [open, participantId, readOnly])

  const effectiveSignedMeta = signedMeta?.meta || signedMeta || {}
  const signedMetaSigner = effectiveSignedMeta?.signer || {}
  const displayedSignatureURL = readOnly
    ? signedMetaSigner.signatureURL || effectiveSignedMeta?.signatureURL || ''
    : previewSigned
      ? profileSignatureURL
      : ''
  const displayedSignerName =
    signedMetaSigner.name || effectiveSignedMeta?.signerName ||
    participantDetails.name || 'Participant'
  const displayedSignerEmail =
    signedMetaSigner.email || effectiveSignedMeta?.signerEmail || participantDetails.email || ''
  const displayedSignedAt =
    effectiveSignedMeta?.acceptedAt || (previewSigned ? new Date().toISOString() : '')

  const handleDownload = async () => {
    if (!contentRef.current) return
    setDownloading(true)
    try {
      const subject = participantDetails.businessName || displayedSignerName || 'Participant'
      await downloadContractPDF(
        contentRef.current,
        `POPIA_${subject.replace(/[^a-z0-9]+/gi, '_')}.pdf`
      )
      message.success('POPIA document downloaded successfully.')
    } catch (error) {
      console.error('Could not download POPIA document.', error)
      message.error('The POPIA document could not be downloaded.')
    } finally {
      setDownloading(false)
    }
  }

  const handleSign = async () => {
    try {
      setPreviewSigned(true)
      setSigning(true)

      const appSnapshot = await getDocs(
        query(
          collection(db, 'applications'),
          where('participantId', '==', participantId),
          limit(1)
        )
      )
      if (appSnapshot.empty) {
        setPreviewSigned(false)
        message.error('Application record not found.')
        return
      }
      const appRef = appSnapshot.docs[0].ref
      const application = appSnapshot.docs[0].data() as any

      const currentUser = getAuth().currentUser
      const uid = currentUser?.uid || ''
      const email = currentUser?.email || ''
      const signerName =
        (currentUser as any)?.displayName || (currentUser as any)?.name || email || 'User'

      setParticipantDetails({
        name:
          application.participantName || application.applicantName ||
          application.contactPerson || signerName,
        email: application.email || application.contactEmail || email,
        businessName:
          application.beneficiaryName || application.companyName ||
          application.businessName || ''
      })

      const [signatureURL, digitalSignature] = await Promise.all([
        profileSignatureURL || fetchUserSignatureUrl(uid, email),
        fetchParticipantDigitalSignature(participantId)
      ])
      if (!signatureURL) throw new Error('No profile signature is available.')
      setProfileSignatureURL(signatureURL)

      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

      let pdfUrl = ''
      let pdfPath = ''
      if (contentRef.current) {
        const output = await generateAndUploadContractPDF({
          participantId,
          slug: 'popia-act',
          title: 'POPIA Notice & Data Processing Consent',
          contentEl: contentRef.current,
          signerName,
          signatureUrl: signatureURL,
          digitalSignature
        })
        pdfUrl = output.url
        pdfPath = output.path
      }

      const meta = {
        acceptedAt: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        version: POPIA_VERSION,
        textHash: POPIA_TEXT_HASH,
        signer: {
          uid,
          email,
          name: signerName,
          signatureURL
        },
        participantDigitalSignature: digitalSignature || '',
        pdfUrl,
        pdfPath
      }

      await updateDoc(appRef, {
        ['signedAgreements.popia-act']: meta
      })

      message.success('POPIA notice signed.')
      onSigned({
        acceptedAt: meta.acceptedAt,
        version: meta.version,
        textHash: meta.textHash,
        pdfUrl
      })
      onClose()
    } catch (error) {
      console.error(error)
      setPreviewSigned(false)
      message.error('Could not complete signing. Please try again.')
    } finally {
      setSigning(false)
    }
  }

  return (
    <ScrollableContractModal
      open={open}
      title='POPIA Notice & Data Processing Consent'
      loading={signing}
      onCancel={onClose}
      onConfirm={handleSign}
      readOnly={readOnly}
      requireScroll={!readOnly}
      signedMeta={effectiveSignedMeta}
      showSignatureSummary={false}
      rawDocument
      footerActions={(
        <Button icon={<DownloadOutlined />} loading={downloading} onClick={handleDownload}>
          Download PDF
        </Button>
      )}
    >
      <div ref={contentRef} className='popia-document-pages'>
        <article className='contract-paper contract-paper--page popia-paper' data-contract-page='1'>
          <PopiaDocumentHeader />

          <section className='popia-document-intro'>
            <span className='popia-document-intro__eyebrow'>Privacy notice</span>
            <h1>How your personal information is collected, used and protected</h1>
            <p>
              This notice explains the processing of personal information during participation
              in Lepharo programmes and use of the Quantilytix-powered information system.
            </p>
          </section>

          <div className='popia-subject-card'>
            <div><span>Participant</span><strong>{displayedSignerName}</strong></div>
            <div><span>Business</span><strong>{participantDetails.businessName || 'Not recorded'}</strong></div>
            <div><span>Email</span><strong>{displayedSignerEmail || 'Not recorded'}</strong></div>
          </div>

          <section className='popia-section'>
            <h2><span>1</span> Responsible Party and Operator</h2>
            <p>
              <strong>Lepharo Incubation Programme NPC</strong> is the Responsible Party for
              personal information collected and processed while administering its programmes.
              <strong> Quantilytix</strong> acts as an Operator that supplies and operates the
              platform used to capture, store, analyse and report programme information on
              Lepharo's documented instructions.
            </p>
          </section>

          <section className='popia-section'>
            <h2><span>2</span> Personal Information We Process</h2>
            <ul>
              <li>Identity, contact and authorised representative details.</li>
              <li>Company registration, ownership, operational and financial information.</li>
              <li>Programme participation, interventions, assessments and supporting uploads.</li>
              <li>Platform metadata such as timestamps, device information and usage records.</li>
            </ul>
          </section>

          <section className='popia-section'>
            <h2><span>3</span> Purpose of Processing</h2>
            <p>Your information may be processed to:</p>
            <ul>
              <li>register, verify and onboard you into an incubation programme;</li>
              <li>plan, deliver and record incubation support and interventions;</li>
              <li>monitor outcomes, compliance, programme performance and funder reporting;</li>
              <li>communicate with you and respond to programme or support requests; and</li>
              <li>maintain and improve the quality, security and reliability of the platform.</li>
            </ul>
          </section>

          <section className='popia-section'>
            <h2><span>4</span> Lawful Grounds</h2>
            <p>
              Processing is carried out on one or more lawful grounds recognised by POPIA,
              including consent, performance of an agreement, compliance with legal obligations
              and legitimate interests connected with programme administration and improvement.
            </p>
          </section>

          <section className='popia-section'>
            <h2><span>5</span> Providing Your Information</h2>
            <p>
              Information identified as required is necessary to administer your participation.
              If essential information is not provided, Lepharo may be unable to complete
              onboarding, deliver particular services or meet monitoring and reporting duties.
            </p>
          </section>

          <PopiaDocumentFooter page={1} />
        </article>

        <article className='contract-paper contract-paper--page popia-paper' data-contract-page='2'>
          <PopiaDocumentHeader />

          <section className='popia-section'>
            <h2><span>6</span> Sharing and Cross-Border Processing</h2>
            <p>
              Information may be shared with authorised service providers, programme partners,
              funders, auditors or regulators where required for the purposes in this notice.
              Recipients must be subject to appropriate confidentiality and information-security
              safeguards. Appropriate protections will be applied where processing occurs outside
              South Africa.
            </p>
          </section>

          <section className='popia-section'>
            <h2><span>7</span> Security and Retention</h2>
            <p>
              Lepharo and Quantilytix apply reasonable technical and organisational safeguards
              designed to protect information against loss, unauthorised access, interference,
              alteration or disclosure. Information is retained only for as long as necessary for
              the stated purposes, contractual requirements and applicable legal obligations.
            </p>
          </section>

          <section className='popia-section'>
            <h2><span>8</span> Your Rights</h2>
            <p>
              Subject to applicable law, you may request access to or correction of your personal
              information, request deletion where lawful, object to certain processing, or withdraw
              consent where consent is the lawful ground. Withdrawal does not affect processing
              completed before withdrawal. You may also lodge a complaint with the Information
              Regulator of South Africa.
            </p>
          </section>

          <section className='popia-section'>
            <h2><span>9</span> Analytics and Model Improvement</h2>
            <p>
              Anonymised or aggregated information may be used by Quantilytix for analytics and
              model improvement to enhance system accuracy and features. Personal information will
              not be used for this purpose unless permitted by this notice and applicable law.
            </p>
          </section>

          <section className='popia-section'>
            <h2><span>10</span> Questions and Complaints</h2>
            <p>
              Privacy questions, access or correction requests, objections and complaints may be
              submitted to Lepharo through the programme administration contact channels or the
              support channels available in the platform.
            </p>
          </section>

          <section className='popia-consent-box'>
            <h2>Acknowledgement and Consent</h2>
            <p>
              By clicking <strong>Confirm &amp; Sign</strong>, I confirm that I have read and
              understood this notice. I consent to processing where consent is the applicable
              lawful ground and acknowledge that other processing may be required by agreement or law.
            </p>
          </section>

          <section className='popia-signature-block'>
            <div className='popia-signature-block__details'>
              <span>Signed by</span>
              <strong>{displayedSignerName}</strong>
              <small>{displayedSignerEmail || 'Participant email not recorded'}</small>
              <small>{formatSignedDate(displayedSignedAt)}</small>
            </div>
            <div className='popia-signature-block__mark'>
              {displayedSignatureURL ? (
                <img src={displayedSignatureURL} alt='Participant signature' />
              ) : (
                <div className='popia-signature-block__pending'>Signature appears here after signing</div>
              )}
              <span>Electronic signature</span>
            </div>
          </section>

          <div className='popia-document-record'>
            <span><strong>Consent version:</strong> {effectiveSignedMeta?.version || POPIA_VERSION}.0</span>
            <span><strong>Record ID:</strong> {participantId || 'Not recorded'}</span>
          </div>

          <PopiaDocumentFooter page={2} />
        </article>
      </div>
    </ScrollableContractModal>
  )
}

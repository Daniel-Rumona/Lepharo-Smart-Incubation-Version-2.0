// src/components/gap/GapExportForm.tsx
import React, { useEffect, useState } from 'react'
import { Modal, Row, Col, Input, DatePicker, Button, Alert, message } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '@/firebase'
import { exportGapDocx } from '@/utils/gapDocx'

interface GapExportFormProps {
  open: boolean
  onClose: () => void
  isROM: boolean
  romName: string
  romEmail: string
  selectedGap: any | null
  smmeSignatureUrl: string
}

const GapExportForm: React.FC<GapExportFormProps> = ({
  open,
  onClose,
  isROM,
  romName,
  romEmail,
  selectedGap,
  smmeSignatureUrl
}) => {
  const [formNo, setFormNo] = useState('')
  const [revisionNo, setRevisionNo] = useState('')
  const [effectiveDate, setEffectiveDate] = useState<Dayjs | null>(null)
  const [onboardingComments, setOnboardingComments] = useState('')
  const [loadingHeader, setLoadingHeader] = useState(false)
  const [savingHeader, setSavingHeader] = useState(false)
  const [exporting, setExporting] = useState(false)

  const loadStandardHeader = async () => {
    setLoadingHeader(true)
    try {
      const ref = doc(db, 'qmsStandards', 'gap-analysis')
      const snap = await getDoc(ref)
      if (snap.exists()) {
        const data = snap.data() as any
        setFormNo(data.formNo || '')
        setRevisionNo(data.revisionNo || '')
        setEffectiveDate(
          data.effectiveDate ? dayjs(data.effectiveDate) : null
        )
        setOnboardingComments(data.onboardingComments || '')
      } else {
        setFormNo('')
        setRevisionNo('')
        setEffectiveDate(null)
        setOnboardingComments('')
      }
    } finally {
      setLoadingHeader(false)
    }
  }

  const saveStandardHeader = async () => {
    if (!isROM) return
    if (!formNo || !revisionNo || !effectiveDate) {
      message.warning(
        'Form No, Revision No and Effective date are required before saving.'
      )
      return
    }

    setSavingHeader(true)
    try {
      const ref = doc(db, 'qmsStandards', 'gap-analysis')
      await setDoc(
        ref,
        {
          formNo,
          revisionNo,
          effectiveDate: dayjs(effectiveDate).format('YYYY-MM-DD'),
          centerTitle: 'SMME GAP ANALYSIS - RUSTERNBERG',
          onboardingComments: onboardingComments || '',
          lastUpdatedAt: Timestamp.now(),
          lastUpdatedBy: { name: romName || '', email: romEmail || '' }
        },
        { merge: true }
      )
      message.success('Standard header saved.')
    } catch (e) {
      console.error(e)
      message.error('Failed to save standard header.')
    } finally {
      setSavingHeader(false)
    }
  }

  const handleExport = async () => {
    if (!selectedGap) {
      message.error('No GAP record selected.')
      return
    }
    if (!selectedGap?.romReview?.confirmedAt) {
      message.warning('GAP must be confirmed by ROM before export.')
      return
    }
    if (!formNo || !revisionNo || !effectiveDate) {
      message.warning(
        'Form No, Revision No and Effective date are required before export.'
      )
      return
    }

    try {
      setExporting(true)

      await exportGapDocx(selectedGap, {
        overrides: {
          smmeSigUrl: smmeSignatureUrl,
          romSigUrl: selectedGap?.romReview?.romSignatureUrl || ''
        },
        headerMeta: {
          formNo,
          revisionNo,
          effectiveDate: dayjs(effectiveDate).format('D MMMM YYYY'),
          centerTitle: 'SMME GAP ANALYSIS - RUSTERNBERG',
          onboardingComments
        }
      })

      message.success('GAP document exported.')
      onClose()
    } catch (e) {
      console.error(e)
      message.error('Failed to export GAP document.')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (open) {
      void loadStandardHeader()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Modal
      title={isROM ? 'Standardize & Export GAP Document' : 'Export GAP Document'}
      open={open}
      onCancel={onClose}
      footer={
        isROM
          ? [
              <Button key='cancel' onClick={onClose}>
                Close
              </Button>,
              <Button
                key='save'
                loading={savingHeader}
                onClick={saveStandardHeader}
              >
                Save Standard Header
              </Button>,
              <Button
                key='export'
                type='primary'
                loading={exporting}
                onClick={handleExport}
              >
                Export Document
              </Button>
            ]
          : [
              <Button key='cancel' onClick={onClose}>
                Close
              </Button>,
              <Button
                key='export'
                type='primary'
                loading={exporting}
                onClick={handleExport}
              >
                Export Document
              </Button>
            ]
      }
      width={800}
    >
      {loadingHeader ? (
        <Alert type='info' showIcon message='Loading header details…' />
      ) : (
        <>
          <Row gutter={12}>
            <Col span={12}>
              <Input
                placeholder='Form No (e.g., LEP-MOG QMS 087 F)'
                value={formNo}
                onChange={e => setFormNo(e.target.value)}
                disabled={!isROM}
              />
            </Col>
            <Col span={12}>
              <Input
                placeholder='Revision No (e.g., 01)'
                value={revisionNo}
                onChange={e => setRevisionNo(e.target.value)}
                disabled={!isROM}
              />
            </Col>
          </Row>
          <Row gutter={12} style={{ marginTop: 12 }}>
            <Col span={12}>
              <DatePicker
                style={{ width: '100%' }}
                placeholder='Effective date'
                value={effectiveDate}
                onChange={v => setEffectiveDate(v)}
                format='D MMMM YYYY'
                disabled={!isROM}
              />
            </Col>
            <Col span={12}>
              <Input
                value='SMME GAP ANALYSIS - RUSTERNBERG'
                addonBefore='Center Title'
                disabled
              />
            </Col>
          </Row>
          <Row gutter={12} style={{ marginTop: 12 }}>
            <Col span={24}>
              <Input.TextArea
                rows={3}
                placeholder='Comments by the onboarding'
                value={onboardingComments}
                onChange={e => setOnboardingComments(e.target.value)}
                disabled={!isROM}
              />
            </Col>
          </Row>

          {!isROM && (
            <Alert
              type='info'
              showIcon
              style={{ marginTop: 12 }}
              message='Header is standardized by ROM.'
              description='If details are incorrect or missing, ask ROM to update and republish the header.'
            />
          )}
        </>
      )}
    </Modal>
  )
}

export default GapExportForm

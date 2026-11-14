import React, { useEffect, useState } from 'react'
import {
    Alert,
    App,
    Button,
    Divider,
    Input,
    Modal,
    Select,
    Space,
    Spin,
    Switch,
    Typography,
    Upload
} from 'antd'
import {
    DeleteOutlined,
    EyeOutlined,
    FilePdfOutlined,
    InboxOutlined,
    PictureOutlined,
    PlusOutlined
} from '@ant-design/icons'
import {
    emptyExportDesign,
    hasExportDesign,
    normalizeExportDesign,
    type DesignPair,
    type SurveyExportDesign
} from '@/lib/surveyExportDesign'
import {
    DEFAULT_LOGO_PATH,
    imageToLogoDataUrl,
    readExportDesign
} from '@/services/surveyTemplateImport'
import { previewSurveyPdf, type ExportField } from '@/services/surveyTemplatePdf'

const { Text } = Typography

type Props = {
    open: boolean
    onClose: () => void
    value?: SurveyExportDesign
    surveyTitle: string
    surveyDescription?: string
    fields: ExportField[]
    /** undefined removes the design. */
    onSave: (design: SurveyExportDesign | undefined) => void
}

const PairsEditor: React.FC<{
    value: DesignPair[]
    onChange: (pairs: DesignPair[]) => void
    labelPlaceholder: string
    valuePlaceholder: string
    addLabel: string
}> = ({ value, onChange, labelPlaceholder, valuePlaceholder, addLabel }) => {
    const patch = (index: number, update: Partial<DesignPair>) =>
        onChange(value.map((pair, i) => (i === index ? { ...pair, ...update } : pair)))
    return (
        <Space direction='vertical' size={8} style={{ width: '100%' }}>
            {value.map((pair, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <Input
                        style={{ flex: '0 0 34%' }}
                        value={pair.label}
                        placeholder={labelPlaceholder}
                        onChange={e => patch(index, { label: e.target.value })}
                    />
                    <Input.TextArea
                        style={{ flex: 1 }}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        value={pair.value}
                        placeholder={valuePlaceholder}
                        onChange={e => patch(index, { value: e.target.value })}
                    />
                    <Button
                        type='text'
                        icon={<DeleteOutlined />}
                        aria-label='Remove row'
                        onClick={() => onChange(value.filter((_, i) => i !== index))}
                    />
                </div>
            ))}
            <Button
                size='small'
                type='dashed'
                icon={<PlusOutlined />}
                onClick={() => onChange([...value, { label: '', value: '' }])}
            >
                {addLabel}
            </Button>
        </Space>
    )
}

const SectionTitle: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
    <Divider orientation='left' orientationMargin={0} style={{ margin: '18px 0 10px' }}>
        <span style={{ fontSize: 14 }}>{children}</span>
        {hint ? (
            <Text type='secondary' style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
                {hint}
            </Text>
        ) : null}
    </Divider>
)

/**
 * How the survey looks when a response is printed: letterhead, logo, rating
 * legend and sign-off lines. Upload the paper form to fill it in one go.
 */
const ExportDesignModal: React.FC<Props> = ({
    open,
    onClose,
    value,
    surveyTitle,
    surveyDescription,
    fields,
    onSave
}) => {
    const { message } = App.useApp()
    const [draft, setDraft] = useState<SurveyExportDesign>(value || emptyExportDesign())
    const [reading, setReading] = useState(false)
    const [readError, setReadError] = useState<string | null>(null)

    useEffect(() => {
        if (open) {
            setDraft(value ? { ...value } : emptyExportDesign())
            setReadError(null)
        }
    }, [open, value])

    const set = (update: Partial<SurveyExportDesign>) => setDraft(prev => ({ ...prev, ...update }))

    const readTemplate = async (file: File) => {
        setReading(true)
        setReadError(null)
        try {
            const design = await readExportDesign(file)
            setDraft(prev => ({
                ...design,
                // Keep a logo already chosen when the document has none.
                logoDataUrl: design.logoDataUrl || prev.logoDataUrl
            }))
            message.success('Design read from the document. Check it below, then save.')
        } catch (error: any) {
            setReadError(error?.message || 'This document could not be read.')
        } finally {
            setReading(false)
        }
    }

    const setLogo = async (source: Blob | string) => {
        try {
            set({ logoDataUrl: await imageToLogoDataUrl(source) })
        } catch (error: any) {
            message.error(error?.message || 'That image could not be used.')
        }
    }

    const cleaned = () => normalizeExportDesign(draft)

    const save = () => {
        const design = cleaned()
        onSave(design && hasExportDesign(design) ? design : undefined)
        onClose()
    }

    const preview = () =>
        previewSurveyPdf({
            title: surveyTitle,
            description: surveyDescription,
            fields,
            design: cleaned()
        })

    return (
        <Modal
            centered
            open={open}
            onCancel={reading ? undefined : onClose}
            maskClosable={!reading}
            title='Print design'
            width={760}
            footer={
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {value ? (
                        <Button
                            danger
                            onClick={() => {
                                onSave(undefined)
                                onClose()
                            }}
                        >
                            Remove design
                        </Button>
                    ) : null}
                    <Button icon={<EyeOutlined />} onClick={preview} disabled={reading}>
                        Preview blank form
                    </Button>
                    <span style={{ flex: 1 }} />
                    <Button onClick={onClose} disabled={reading}>
                        Cancel
                    </Button>
                    <Button type='primary' onClick={save} disabled={reading}>
                        Use this design
                    </Button>
                </div>
            }
        >
            <Text type='secondary'>
                Completed responses are printed on this design. Upload the paper version of the
                form to copy its letterhead, rating legend and sign-off lines.
            </Text>

            <Upload.Dragger
                accept='.pdf,.docx'
                multiple={false}
                maxCount={1}
                showUploadList={false}
                disabled={reading}
                style={{ marginTop: 12 }}
                beforeUpload={file => {
                    readTemplate(file)
                    return false
                }}
            >
                <p className='ant-upload-drag-icon'>
                    {reading ? <Spin /> : <InboxOutlined />}
                </p>
                <p className='ant-upload-text'>
                    {reading
                        ? 'Reading the design…'
                        : draft.sourceFileName
                            ? `From ${draft.sourceFileName} · drop another to replace`
                            : 'Click or drag the form template here'}
                </p>
                <p className='ant-upload-hint'>PDF or Word (.docx)</p>
            </Upload.Dragger>

            {readError ? (
                <Alert style={{ marginTop: 12 }} type='error' showIcon message={readError} />
            ) : null}

            <SectionTitle>Letterhead</SectionTitle>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div
                    style={{
                        width: 140,
                        height: 72,
                        border: '1px dashed rgba(127,127,127,0.4)',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#fff',
                        overflow: 'hidden'
                    }}
                >
                    {draft.logoDataUrl ? (
                        <img
                            src={draft.logoDataUrl}
                            alt='Logo'
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        />
                    ) : (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            No logo
                        </Text>
                    )}
                </div>
                <Space wrap>
                    <Upload
                        accept='image/png,image/jpeg,image/webp'
                        showUploadList={false}
                        beforeUpload={file => {
                            setLogo(file)
                            return false
                        }}
                    >
                        <Button icon={<PictureOutlined />}>Upload logo</Button>
                    </Upload>
                    <Button onClick={() => setLogo(DEFAULT_LOGO_PATH)}>Use Lepharo logo</Button>
                    {draft.logoDataUrl ? (
                        <Button type='text' danger onClick={() => set({ logoDataUrl: undefined })}>
                            Remove
                        </Button>
                    ) : null}
                </Space>
            </div>
            <div style={{ marginTop: 12 }}>
                <Text type='secondary' style={{ fontSize: 12 }}>
                    Title in the letterhead
                </Text>
                <Input
                    value={draft.headerTitle}
                    placeholder={surveyTitle || 'The survey title'}
                    onChange={e => set({ headerTitle: e.target.value })}
                />
            </div>

            <SectionTitle hint='Beside the title'>Document control</SectionTitle>
            <PairsEditor
                value={draft.docControl}
                onChange={docControl => set({ docControl })}
                labelPlaceholder='Doc Ref. No.'
                valuePlaceholder='QMS'
                addLabel='Add row'
            />

            <SectionTitle hint='Under the title'>Approvals</SectionTitle>
            <PairsEditor
                value={draft.approvals}
                onChange={approvals => set({ approvals })}
                labelPlaceholder='Approved By'
                valuePlaceholder={'Name\nDesignation'}
                addLabel='Add signatory'
            />

            <SectionTitle hint='Printed above the first rating question'>Rating scale</SectionTitle>
            <Space direction='vertical' size={8} style={{ width: '100%' }}>
                <Input
                    value={draft.ratingIntro}
                    placeholder='Please rate the following on a scale of 1 to 5, where:'
                    onChange={e => set({ ratingIntro: e.target.value })}
                />
                <Input.TextArea
                    autoSize={{ minRows: 3, maxRows: 7 }}
                    value={draft.ratingLegend.join('\n')}
                    placeholder={'1 = Strongly Disagree / Poor\n2 = Disagree / Fair\n…'}
                    onChange={e => set({ ratingLegend: e.target.value.split('\n') })}
                />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Input
                        style={{ flex: '1 1 220px' }}
                        value={draft.ratingColumnTitle}
                        placeholder='Evaluation Criterion'
                        addonBefore='Column title'
                        onChange={e => set({ ratingColumnTitle: e.target.value })}
                    />
                    <Space>
                        <Switch checked={draft.includeNA} onChange={includeNA => set({ includeNA })} />
                        <Text>N/A column</Text>
                    </Space>
                </div>
            </Space>

            <SectionTitle hint='Lines at the end of the form'>Sign-off</SectionTitle>
            <Select
                mode='tags'
                style={{ width: '100%' }}
                value={draft.signOff}
                placeholder='Evaluation conducted by, Designation, Signature, Date'
                tokenSeparators={[',']}
                open={false}
                suffixIcon={<FilePdfOutlined />}
                onChange={signOff => set({ signOff })}
            />
        </Modal>
    )
}

export default ExportDesignModal

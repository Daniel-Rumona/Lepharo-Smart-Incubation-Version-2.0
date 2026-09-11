import React, { useMemo, useState } from 'react'
import {
    Alert,
    App,
    Button,
    Checkbox,
    List,
    Modal,
    Radio,
    Space,
    Spin,
    Tag,
    Typography,
    Upload
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import {
    extractSurveyQuestions,
    MAX_SURVEY_DOCUMENT_BYTES,
    SURVEY_DOCUMENT_ACCEPT,
    type ExtractedSurveyField,
    type SurveyExtractionResult
} from '@/services/surveyQuestionExtractionService'

const { Text } = Typography

// Display labels only. The builder owns the canonical FIELD_TYPES list; this
// map just makes the review list readable, and falls back to the raw type.
const TYPE_LABELS: Record<string, string> = {
    text: 'Text Field',
    textarea: 'Text Area',
    number: 'Number',
    email: 'Email',
    select: 'Dropdown',
    checkbox: 'Checkbox Group',
    radio: 'Radio Group',
    date: 'Date Picker',
    file: 'File Upload',
    rating: 'Rating (Stars)',
    heading: 'Section Heading'
}

export type ImportQuestionsMeta = {
    title: string
    description: string
    category: string
}

export type ImportQuestionsOptions = {
    replace: boolean
    applyMeta: boolean
}

type ImportQuestionsModalProps = {
    open: boolean
    onClose: () => void
    /** Current survey category, sent as a hint to the extractor. */
    category: string
    hasExistingFields: boolean
    /** Receives only the questions the user kept ticked. */
    onImport: (
        fields: ExtractedSurveyField[],
        meta: ImportQuestionsMeta,
        options: ImportQuestionsOptions
    ) => void
}

const ImportQuestionsModal: React.FC<ImportQuestionsModalProps> = ({
    open,
    onClose,
    category,
    hasExistingFields,
    onImport
}) => {
    const { message } = App.useApp()
    const [file, setFile] = useState<File | null>(null)
    const [analysing, setAnalysing] = useState(false)
    const [result, setResult] = useState<SurveyExtractionResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [skipped, setSkipped] = useState<Set<number>>(new Set())
    const [applyMeta, setApplyMeta] = useState(true)
    const [replace, setReplace] = useState(false)

    const reset = () => {
        setFile(null)
        setAnalysing(false)
        setResult(null)
        setError(null)
        setSkipped(new Set())
        setApplyMeta(true)
        setReplace(false)
    }

    const handleClose = () => {
        if (analysing) return
        reset()
        onClose()
    }

    const analyse = async (target: File) => {
        setAnalysing(true)
        setError(null)
        setResult(null)
        setSkipped(new Set())
        try {
            const extracted = await extractSurveyQuestions(target, { category })
            setResult(extracted)
        } catch (e: any) {
            setError(e?.message || 'Could not read questions from this document.')
        } finally {
            setAnalysing(false)
        }
    }

    const toggle = (index: number) => {
        setSkipped(prev => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    const selected = useMemo(
        () => (result?.fields || []).filter((_, i) => !skipped.has(i)),
        [result, skipped]
    )

    const apply = () => {
        if (!result || selected.length === 0) return
        onImport(
            selected,
            {
                title: result.title,
                description: result.description,
                category: result.category
            },
            { replace, applyMeta }
        )
        message.success(
            `${selected.length} question${selected.length === 1 ? '' : 's'} imported.`
        )
        reset()
        onClose()
    }

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            title='Import questions from a document'
            width={720}
            maskClosable={!analysing}
            destroyOnClose
            footer={[
                <Button key='cancel' onClick={handleClose} disabled={analysing}>
                    Cancel
                </Button>,
                <Button
                    key='apply'
                    type='primary'
                    disabled={!result || selected.length === 0}
                    onClick={apply}
                >
                    {selected.length > 0
                        ? `Add ${selected.length} question${selected.length === 1 ? '' : 's'}`
                        : 'Add questions'}
                </Button>
            ]}
        >
            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                <Upload.Dragger
                    accept={SURVEY_DOCUMENT_ACCEPT}
                    multiple={false}
                    maxCount={1}
                    disabled={analysing}
                    showUploadList={false}
                    // The AI backend does the upload, so never let antd post it.
                    beforeUpload={selectedFile => {
                        if (selectedFile.size > MAX_SURVEY_DOCUMENT_BYTES) {
                            message.error(
                                `Please choose a file under ${MAX_SURVEY_DOCUMENT_BYTES / (1024 * 1024)}MB.`
                            )
                            return Upload.LIST_IGNORE
                        }
                        setFile(selectedFile)
                        analyse(selectedFile)
                        return false
                    }}
                >
                    <p className='ant-upload-drag-icon'>
                        <InboxOutlined />
                    </p>
                    <p className='ant-upload-text'>
                        {file ? file.name : 'Click or drag a questionnaire here'}
                    </p>
                    <p className='ant-upload-hint'>
                        PDF, Word (.docx), image or text file, up to{' '}
                        {MAX_SURVEY_DOCUMENT_BYTES / (1024 * 1024)}MB.
                    </p>
                </Upload.Dragger>

                {analysing ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                        <Spin />
                        <div style={{ marginTop: 12 }}>
                            <Text type='secondary'>Reading the document…</Text>
                        </div>
                    </div>
                ) : null}

                {error ? (
                    <Alert
                        type='error'
                        showIcon
                        message='Import failed'
                        description={error}
                        action={
                            file ? (
                                <Button size='small' onClick={() => analyse(file)}>
                                    Retry
                                </Button>
                            ) : null
                        }
                    />
                ) : null}

                {result ? (
                    <>
                        {result.warnings.map(warning => (
                            <Alert key={warning} type='warning' showIcon message={warning} />
                        ))}

                        <Alert
                            type='info'
                            showIcon
                            message={`Found ${result.fields.length} question${result.fields.length === 1 ? '' : 's'}. Untick anything you don't want.`}
                        />

                        {result.title || result.description ? (
                            <Checkbox
                                checked={applyMeta}
                                onChange={e => setApplyMeta(e.target.checked)}
                            >
                                Also use the document's title
                                {result.description ? ' and description' : ''}
                                {result.title ? ` (“${result.title}”)` : ''}
                            </Checkbox>
                        ) : null}

                        {hasExistingFields ? (
                            <Radio.Group
                                value={replace ? 'replace' : 'append'}
                                onChange={e => setReplace(e.target.value === 'replace')}
                            >
                                <Radio value='append'>Add to existing questions</Radio>
                                <Radio value='replace'>Replace all existing questions</Radio>
                            </Radio.Group>
                        ) : null}

                        <List
                            size='small'
                            bordered
                            style={{ maxHeight: '40vh', overflow: 'auto' }}
                            dataSource={result.fields}
                            renderItem={(field, index) => (
                                <List.Item>
                                    <Space align='start' style={{ width: '100%' }}>
                                        <Checkbox
                                            checked={!skipped.has(index)}
                                            onChange={() => toggle(index)}
                                        />
                                        <div style={{ minWidth: 0 }}>
                                            <Text
                                                strong={field.type === 'heading'}
                                                delete={skipped.has(index)}
                                            >
                                                {field.label}
                                            </Text>
                                            <div>
                                                <Space size={6} wrap>
                                                    <Tag>
                                                        {TYPE_LABELS[field.type] || field.type}
                                                    </Tag>
                                                    {field.required ? (
                                                        <Tag color='red'>Required</Tag>
                                                    ) : null}
                                                    {field.options?.length ? (
                                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                                            {field.options.join(' · ')}
                                                        </Text>
                                                    ) : null}
                                                </Space>
                                            </div>
                                        </div>
                                    </Space>
                                </List.Item>
                            )}
                        />
                    </>
                ) : null}
            </Space>
        </Modal>
    )
}

export default ImportQuestionsModal

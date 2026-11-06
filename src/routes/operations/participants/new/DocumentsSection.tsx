import React from 'react'
import { Button, DatePicker, Upload, message } from 'antd'
import { CheckCircleFilled, CloseOutlined, FileTextOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'

export type DocRow = {
    key: string
    title: string
    requiresExpiry: boolean
    expiryMonths: number | null
    group: 'application' | 'gap' | 'preinc'
    /** Counts towards the compliance score (everything but the MOA). */
    required: boolean
    file: File | null
    issueDate: Dayjs | null
    expiryDate: Dayjs | null
}

const MAX_MB = 10
const ACCEPT = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']

/** What's still needed for an attached document, or null when it's complete. */
export const docProblem = (d: DocRow): string | null => {
    if (!d.file) return null
    if (!d.issueDate) return 'Add the issue date'
    if (d.requiresExpiry && !d.expiryDate) return 'Add the expiry date'
    if (d.expiryDate && d.expiryDate.isBefore(dayjs().startOf('day'))) return 'This document has expired'
    return null
}

type Props = {
    docs: DocRow[]
    onChange: (key: string, patch: Partial<DocRow>) => void
    showProblems: boolean
}

/**
 * The programme's required documents, one compact row each: attach a file,
 * then its issue (and, where needed, expiry) date. Nothing here is required
 * to save the SME; missing documents count against its compliance score.
 */
export const DocumentsSection: React.FC<Props> = ({ docs, onChange, showProblems }) => {
    if (!docs.length) return <p className='sf-muted'>This programme has no required documents.</p>

    return (
        <ul className='sf-docs'>
            {docs.map(d => {
                const problem = showProblems ? docProblem(d) : null
                return (
                    <li key={d.key} className={`sf-doc${d.file ? ' has-file' : ''}${problem ? ' has-problem' : ''}`}>
                        <span className='sf-doc-icon' aria-hidden='true'>{d.file ? <CheckCircleFilled /> : <FileTextOutlined />}</span>
                        <div className='sf-doc-main'>
                            <div className='sf-doc-title'>
                                {d.title}
                                {!d.required && <span className='sf-doc-optional'>Optional</span>}
                            </div>
                            {d.file ? (
                                <div className='sf-doc-file'>
                                    <span className='sf-doc-name' title={d.file.name}>{d.file.name}</span>
                                    <Button size='small' type='text' icon={<CloseOutlined />} aria-label={`Remove ${d.title} file`} onClick={() => onChange(d.key, { file: null, issueDate: null, expiryDate: null })} />
                                </div>
                            ) : (
                                <div className='sf-doc-hint'>PDF, PNG or JPG · up to {MAX_MB} MB</div>
                            )}
                            {problem && <div className='sf-doc-problem' role='alert'>{problem}</div>}
                        </div>
                        {d.file ? (
                            <div className='sf-doc-dates'>
                                <DatePicker
                                    placeholder='Issue date'
                                    value={d.issueDate}
                                    format='D MMM YYYY'
                                    disabledDate={c => c.isAfter(dayjs().endOf('day'))}
                                    onChange={v => onChange(d.key, { issueDate: v })}
                                    aria-label={`${d.title} issue date`}
                                />
                                {d.requiresExpiry && (
                                    <DatePicker
                                        placeholder='Expiry date'
                                        value={d.expiryDate}
                                        format='D MMM YYYY'
                                        disabledDate={c => c.isBefore(dayjs().startOf('day')) || (!!d.expiryMonths && c.isAfter(dayjs().add(d.expiryMonths, 'month').endOf('day')))}
                                        onChange={v => onChange(d.key, { expiryDate: v })}
                                        aria-label={`${d.title} expiry date`}
                                    />
                                )}
                            </div>
                        ) : (
                            <Upload
                                accept={ACCEPT.join(',')}
                                showUploadList={false}
                                beforeUpload={file => {
                                    if (!ACCEPT.includes(file.type)) {
                                        message.error('Upload a PDF, PNG or JPG.')
                                    } else if (file.size > MAX_MB * 1024 * 1024) {
                                        message.error(`“${file.name}” is over ${MAX_MB} MB.`)
                                    } else {
                                        onChange(d.key, { file })
                                    }
                                    return Upload.LIST_IGNORE
                                }}
                            >
                                <Button icon={<UploadOutlined />}>Attach</Button>
                            </Upload>
                        )}
                    </li>
                )
            })}
        </ul>
    )
}

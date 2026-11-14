import React, { useEffect, useState } from 'react'
import { Button, Collapse, Typography, message, theme } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
    EVIDENCE_VERDICT,
    checkMovEvidence,
    checkedAtDate,
    isEvidenceCheckStale,
    type EvidenceCheck
} from '@/services/evidenceCheckService'

const { Text } = Typography

type Props = {
    movId: string
    check: EvidenceCheck | null | undefined
    /** The evidence links on the MOV now, to tell when the check is out of date. */
    currentLinks: string[]
    /** Facilitators are told what to fix; reviewers what to look at. */
    audience: 'facilitator' | 'reviewer'
    onChecked?: (check: EvidenceCheck) => void
}

const yesNo = (value: boolean | null, yes: string, no: string) => (value === null ? null : value ? yes : no)

/** The automatic evidence check on one MOV: verdict, what to fix, figures found, per file. */
export const EvidenceCheckCard: React.FC<Props> = ({ movId, check: saved, currentLinks, audience, onChecked }) => {
    const { token } = theme.useToken()
    const [check, setCheck] = useState<EvidenceCheck | null>(saved || null)
    const [running, setRunning] = useState(false)

    useEffect(() => setCheck(saved || null), [movId, saved])

    const run = async () => {
        setRunning(true)
        try {
            const result = await checkMovEvidence(movId)
            setCheck(result)
            onChecked?.(result)
        } catch (error: any) {
            message.error(error?.message || 'The evidence check could not run right now.')
        } finally {
            setRunning(false)
        }
    }

    const stale = isEvidenceCheckStale(check, currentLinks)
    const meta = check ? EVIDENCE_VERDICT[check.verdict] || EVIDENCE_VERDICT.weak : null
    const toneColour = meta
        ? { success: token.colorSuccess, info: token.colorInfo, warning: token.colorWarning, danger: token.colorError, neutral: token.colorTextTertiary }[meta.tone]
        : token.colorTextTertiary
    const checkedAt = check ? checkedAtDate(check.checkedAt) : null

    return (
        <section
            data-guide='mov-evidence-check'
            style={{
                padding: '14px 16px',
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderLeft: `4px solid ${toneColour}`,
                background: token.colorBgContainer
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <SafetyCertificateOutlined style={{ color: toneColour, fontSize: 18 }} />
                <Text strong style={{ fontSize: 15 }}>{meta ? meta.label : 'Evidence not checked yet'}</Text>
                <Button
                    size='small'
                    icon={<ReloadOutlined />}
                    loading={running}
                    onClick={run}
                    style={{ marginLeft: 'auto' }}
                >
                    {check ? 'Re-check' : 'Check evidence'}
                </Button>
            </div>

            {!check ? (
                <Text type='secondary' style={{ display: 'block', marginTop: 6 }}>
                    The assistant reads the evidence and says whether it shows this intervention was delivered to this SME.
                </Text>
            ) : (
                <>
                    {stale ? (
                        <Text type='warning' style={{ display: 'block', marginTop: 6 }}>
                            Evidence has changed since this check. Re-check to update it.
                        </Text>
                    ) : null}
                    {check.summary ? <Text style={{ display: 'block', marginTop: 8 }}>{check.summary}</Text> : null}

                    {check.issues.length ? (
                        <div style={{ marginTop: 10 }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                {audience === 'facilitator' ? 'To fix before review' : 'Look at'}
                            </Text>
                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                {check.issues.map(issue => <li key={issue}>{issue}</li>)}
                            </ul>
                        </div>
                    ) : null}

                    {check.outcomes.length ? (
                        <div style={{ marginTop: 10 }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>Figures stated in the evidence</Text>
                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                {check.outcomes.map(outcome => (
                                    <li key={`${outcome.label}-${outcome.source}`}>
                                        {outcome.label}: <Text strong>{outcome.value.toLocaleString('en-ZA')}{outcome.unit ? ` ${outcome.unit}` : ''}</Text>
                                        <Text type='secondary'> · {outcome.source}</Text>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    {check.files.length ? (
                        <Collapse
                            ghost
                            size='small'
                            style={{ marginTop: 8, marginInline: -8 }}
                            items={[{
                                key: 'files',
                                label: `Each file (${check.files.length})`,
                                children: (
                                    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                                        {check.files.map(file => {
                                            const good = file.readable && file.matchesIntervention === 'yes'
                                            const facts = [
                                                file.matchesIntervention === 'partly' ? 'Partly matches' : file.matchesIntervention === 'no' ? 'Does not match' : null,
                                                yesNo(file.namesSme, 'Names the SME', 'SME not named'),
                                                file.dated === 'in_period' ? 'Dated in period' : file.dated === 'outside_period' ? 'Dated outside period' : file.dated === 'undated' ? 'Undated' : null,
                                                yesNo(file.signed, 'Signed', 'Not signed')
                                            ].filter(Boolean)
                                            return (
                                                <li key={file.label} style={{ display: 'flex', gap: 8 }}>
                                                    {good ? (
                                                        <CheckCircleOutlined style={{ color: token.colorSuccess, marginTop: 4 }} />
                                                    ) : file.readable ? (
                                                        <ExclamationCircleOutlined style={{ color: token.colorWarning, marginTop: 4 }} />
                                                    ) : (
                                                        <CloseCircleOutlined style={{ color: token.colorTextTertiary, marginTop: 4 }} />
                                                    )}
                                                    <div style={{ minWidth: 0 }}>
                                                        <Text strong style={{ wordBreak: 'break-word' }}>{file.label}</Text>
                                                        {facts.length ? <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>{facts.join(' · ')}</Text> : null}
                                                        {file.note ? <Text style={{ display: 'block', fontSize: 13 }}>{file.note}</Text> : null}
                                                    </div>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                )
                            }]}
                        />
                    ) : null}

                    <Text type='secondary' style={{ display: 'block', fontSize: 12, marginTop: 6 }}>
                        Checked by the assistant{checkedAt ? ` on ${dayjs(checkedAt).format('D MMM YYYY, HH:mm')}` : ''}. A guide for the reviewer, not a decision.
                    </Text>
                </>
            )}
        </section>
    )
}

export default EvidenceCheckCard

import React, { useEffect, useState } from 'react'
import { Avatar, Typography, theme } from 'antd'
import { AppstoreOutlined, UserOutlined } from '@ant-design/icons'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'

const { Text } = Typography

type Props = {
    participantId?: string | null
    /** Company name already on the record; the participant doc fills it in when missing. */
    companyName?: string | null
    photoUrl?: string | null
    /** Grouped interventions show the group instead of one SME. */
    groupCount?: number
    groupTitle?: string | null
    /** Shown under the names, e.g. the intervention title. */
    subtitle?: React.ReactNode
    /** Right-hand side: status tags and the like. */
    extra?: React.ReactNode
}

const firstText = (...values: unknown[]) =>
    values.map(value => String(value || '').trim()).find(Boolean) || ''

/** Who the evidence is for: photo, company and director, with optional status on the right. */
export const IncubateeBanner: React.FC<Props> = ({ participantId, companyName, photoUrl, groupCount, groupTitle, subtitle, extra }) => {
    const { token } = theme.useToken()
    const [profile, setProfile] = useState<{ company: string; director: string; photo: string }>({ company: '', director: '', photo: '' })
    const grouped = Boolean(groupCount)

    useEffect(() => {
        const id = String(participantId || '').trim()
        if (grouped || !id) return
        let cancelled = false
        void (async () => {
            try {
                const snap = await getDoc(doc(db, 'participants', id))
                const participant = snap.exists() ? (snap.data() as any) : null
                if (!participant) return
                const company = firstText(participant.beneficiaryName, participant.companyName, participant.participantName)
                const personName = firstText(participant.participantName, participant.name, participant.fullName)
                let photo = firstText(participant.photoURL, participant.logoUrl)
                if (!photo && participant.uid) {
                    const userSnap = await getDoc(doc(db, 'users', String(participant.uid)))
                    const user = userSnap.exists() ? (userSnap.data() as any) : null
                    photo = firstText(user?.photoURL)
                }
                const director = firstText(
                    participant.directorName,
                    participant.ownerName,
                    participant.representativeName,
                    personName && personName !== company ? personName : ''
                )
                if (!cancelled) setProfile({ company, director, photo })
            } catch (error) {
                // No access or no profile: the banner keeps what the record already has.
                console.warn(`Could not load SME profile for participant ${id}`, error)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [participantId, grouped])

    const company = grouped ? firstText(groupTitle, 'Grouped intervention') : firstText(profile.company, companyName, 'SME')
    const photo = firstText(photoUrl, profile.photo)

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                flexWrap: 'wrap',
                padding: '14px 18px',
                borderRadius: 16,
                background: token.colorFillAlter,
                border: `1px solid ${token.colorBorderSecondary}`
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 260px', minWidth: 0 }}>
                <Avatar
                    size={52}
                    src={grouped ? undefined : photo || undefined}
                    icon={grouped ? <AppstoreOutlined /> : undefined}
                    style={{ flexShrink: 0, background: photo && !grouped ? undefined : token.colorPrimaryBg, color: token.colorPrimary, fontWeight: 600 }}
                >
                    {company.charAt(0).toUpperCase()}
                </Avatar>
                <div style={{ minWidth: 0 }}>
                    <Text strong ellipsis={{ tooltip: company }} style={{ display: 'block', fontSize: 16 }}>
                        {company}
                    </Text>
                    {grouped ? (
                        <Text type='secondary' style={{ fontSize: 13 }}>
                            {groupCount} SME{groupCount === 1 ? '' : 's'}
                        </Text>
                    ) : profile.director ? (
                        <Text type='secondary' style={{ fontSize: 13 }}>
                            <UserOutlined style={{ marginInlineEnd: 6 }} />
                            {profile.director} · Director
                        </Text>
                    ) : null}
                    {subtitle ? (
                        <Text type='secondary' ellipsis style={{ display: 'block', fontSize: 12 }}>
                            {subtitle}
                        </Text>
                    ) : null}
                </div>
            </div>
            {extra ? <div style={{ flex: '0 0 auto', marginInlineStart: 'auto', textAlign: 'right' }}>{extra}</div> : null}
        </div>
    )
}

export default IncubateeBanner

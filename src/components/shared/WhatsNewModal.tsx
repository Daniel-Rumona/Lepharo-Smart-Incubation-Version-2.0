import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Carousel,
    Col,
    Grid,
    Image,
    Modal,
    Progress,
    Row,
    Space,
    Tag,
    Typography
} from 'antd'
import {
    CalendarOutlined,
    CheckOutlined,
    LeftOutlined,
    RightOutlined,
    RocketOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { featureGovernanceService } from '@/services/featureGovernanceService'
import type { FeatureGovernanceRecord } from '@/types/featureGovernance'
import { safeLocal } from '@/utils/safeStorage'
import { useLoginPrompt } from '@/contexts/LoginPromptContext'

const { Title, Text, Paragraph } = Typography
const { useBreakpoint } = Grid

const normalize = (value: unknown) => String(value || '').trim().toLowerCase()

const timestampMillis = (value: any): number => {
    if (value === undefined || value === null || value === '') return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (typeof value?.seconds === 'number') return value.seconds * 1000
    const parsed = dayjs(value)
    return parsed.isValid() ? parsed.valueOf() : 0
}

const releaseVersionMillis = (record: FeatureGovernanceRecord) =>
    timestampMillis(record.updatedAt) ||
    timestampMillis(record.createdAt) ||
    timestampMillis(record.whatsNew?.releaseDate || record.dueDate)

export const WhatsNewModal: React.FC = () => {
    const { user, actor, isViewingAs } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const screens = useBreakpoint()
    const { clockGateState, coverageGateState } = useLoginPrompt()
    const [records, setRecords] = useState<FeatureGovernanceRecord[]>([])
    const [dismissedAt, setDismissedAt] = useState(0)
    const [currentIndex, setCurrentIndex] = useState(0)

    const storageKey = actor?.uid
        ? `whats-new-seen-at:${actor.uid}`
        : ''
    const locallySeenAt = Number(storageKey ? safeLocal.get(storageKey) || 0 : 0)
    const profileSeenAt = timestampMillis(actor?.whatsNewLastSeenAt)
    const lastSeenAt = Math.max(locallySeenAt, profileSeenAt, dismissedAt)

    useEffect(() => {
        let active = true
        if (!actor?.uid || isViewingAs) {
            setRecords([])
            return () => { active = false }
        }

        featureGovernanceService
            .listPublished()
            .then(items => {
                if (active) setRecords(items)
            })
            .catch(error => console.error("[What's New] Could not load releases:", error))

        return () => { active = false }
    }, [actor?.uid, isViewingAs])

    const unseen = useMemo(() => {
        const role = normalize(user?.role)
        const departmentId = String(user?.departmentId || '')
        const branchId = String(user?.branchId || '')

        return records.filter(record => {
            const audience = record.audience
            const roleMatches =
                !audience?.roles?.length ||
                audience.roles.some(item => normalize(item) === role)
            const departmentMatches =
                audience?.allDepartments ||
                !audience?.departmentIds?.length ||
                audience.departmentIds.includes(departmentId)
            const branchMatches =
                audience?.allBranches ||
                !audience?.branchIds?.length ||
                audience.branchIds.includes(branchId)
            const programMatches =
                !record.programSpecific ||
                record.appliesToAllPrograms ||
                isAllPrograms ||
                (!!activeProgramId && record.programId === activeProgramId)

            return (
                roleMatches &&
                departmentMatches &&
                branchMatches &&
                programMatches &&
                releaseVersionMillis(record) > lastSeenAt
            )
        })
    }, [
        activeProgramId,
        isAllPrograms,
        lastSeenAt,
        records,
        user?.branchId,
        user?.departmentId,
        user?.role
    ])

    useEffect(() => {
        setCurrentIndex(0)
    }, [unseen.length])

    const dismiss = () => {
        const now = Date.now()
        setDismissedAt(now)
        if (storageKey) safeLocal.set(storageKey, String(now))
        if (actor?.uid) {
            void updateDoc(doc(db, 'users', actor.uid), {
                whatsNewLastSeenAt: serverTimestamp()
            }).catch(error => console.error("[What's New] Could not save viewed state:", error))
        }
    }

    const current = unseen[currentIndex]
    const images = current?.whatsNew?.imageUrls || []
    const releaseDate = current?.whatsNew?.releaseDate || current?.dueDate

    return (
        <Modal
            open={
                !!current &&
                !isViewingAs &&
                clockGateState === 'complete' &&
                coverageGateState === 'complete'
            }
            width={940}
            centered={!!screens.md}
            title={null}
            footer={null}
            onCancel={dismiss}
            destroyOnClose
            styles={{
                body: {
                    padding: screens.md ? 24 : 16,
                    maxHeight: screens.md ? '84vh' : '88vh',
                    overflowY: 'auto'
                }
            }}
        >
            {current && (
                <Row gutter={[28, 24]} align="middle">
                    <Col xs={24} lg={13}>
                        {images.length ? (
                            <Carousel arrows={images.length > 1} dots={images.length > 1}>
                                {images.map((url, index) => (
                                    <div key={`${url}-${index}`}>
                                        <Image
                                            preview
                                            src={url}
                                            width="100%"
                                            height={screens.md ? 390 : 230}
                                            style={{ objectFit: 'cover', borderRadius: 16 }}
                                        />
                                    </div>
                                ))}
                            </Carousel>
                        ) : (
                            <div
                                style={{
                                    minHeight: screens.md ? 330 : 190,
                                    display: 'grid',
                                    placeItems: 'center',
                                    borderRadius: 16,
                                    background: 'linear-gradient(135deg, #f0f5ff 0%, #f9f0ff 100%)'
                                }}
                            >
                                <RocketOutlined style={{ fontSize: 58, color: '#814dff' }} />
                            </div>
                        )}
                    </Col>

                    <Col xs={24} lg={11}>
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <Space wrap>
                                <Tag color="purple">WHAT'S NEW</Tag>
                                {releaseDate && (
                                    <Tag icon={<CalendarOutlined />}>
                                        {dayjs(releaseDate).format('DD MMM YYYY')}
                                    </Tag>
                                )}
                                {unseen.length > 1 && <Tag>{currentIndex + 1} of {unseen.length}</Tag>}
                            </Space>

                            <Title level={2} style={{ margin: 0, lineHeight: 1.15 }}>
                                {current.whatsNew?.headline || current.title}
                            </Title>
                            <Paragraph style={{ margin: 0, fontSize: 16, whiteSpace: 'pre-line' }}>
                                {current.whatsNew?.summary || current.description}
                            </Paragraph>
                            {current.whatsNew?.summary && current.description && (
                                <div
                                    style={{
                                        padding: 14,
                                        borderRadius: 12,
                                        background: '#f7f8fc',
                                        border: '1px solid #e7e9f2'
                                    }}
                                >
                                    <Text strong>What changed</Text>
                                    <Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-line' }}>
                                        {current.description}
                                    </Paragraph>
                                </div>
                            )}

                            {unseen.length > 1 && (
                                <Progress
                                    percent={Math.round(((currentIndex + 1) / unseen.length) * 100)}
                                    showInfo={false}
                                    strokeColor="#814dff"
                                />
                            )}

                            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                <Button
                                    icon={<LeftOutlined />}
                                    disabled={currentIndex === 0}
                                    onClick={() => setCurrentIndex(index => Math.max(0, index - 1))}
                                >
                                    Previous
                                </Button>
                                {currentIndex < unseen.length - 1 ? (
                                    <Button
                                        type="primary"
                                        onClick={() => setCurrentIndex(index => Math.min(unseen.length - 1, index + 1))}
                                    >
                                        Next <RightOutlined />
                                    </Button>
                                ) : (
                                    <Button type="primary" icon={<CheckOutlined />} onClick={dismiss}>
                                        Got it
                                    </Button>
                                )}
                            </Space>
                        </Space>
                    </Col>
                </Row>
            )}
        </Modal>
    )
}

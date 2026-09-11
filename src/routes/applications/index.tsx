import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
    Card,
    Button,
    Badge,
    Table,
    Select,
    Input,
    Modal,
    Tabs,
    Statistic,
    Row,
    Col,
    Divider,
    Tag,
    message,
    Skeleton,
    Typography,
    Space,
    Alert,
    Tooltip,
    Progress,
    Empty
} from 'antd'
import {
    FileTextOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    DownloadOutlined,
    SearchOutlined,
    FilterOutlined,
    EyeOutlined,
    UserOutlined,
    PieChartOutlined,
    RiseOutlined,
    MailOutlined,
    PhoneOutlined,
    EnvironmentOutlined,
    CopyOutlined,
    GlobalOutlined
} from '@ant-design/icons'
import { db, auth } from '@/firebase'
import {
    collection,
    getDocs,
    doc,
    getDoc,
    updateDoc,
    query,
    where,
    serverTimestamp,
    QueryConstraint
} from 'firebase/firestore'
import { motion } from 'framer-motion'
import { Helmet } from 'react-helmet'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { TabPane } = Tabs
const { Option } = Select
const { Text } = Typography

type ProgramOnboardingQuestion = {
    id: string
    label: string
    type?: string
    options?: string[]
    allowMultiple?: boolean
    systemKey?: string
}

const ApplicationsDashboard: React.FC = () => {
    const { user: fullUser } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [loading, setLoading] = useState(false)
    const [applications, setApplications] = useState<any[]>([])
    const [selectedApplication, setSelectedApplication] = useState<any>(null)
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [selectedDocApp, setSelectedDocApp] = useState<any>(null)

    const [searchTerm, setSearchTerm] = useState('')
    const [genderFilter, setGenderFilter] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [ageGroupFilter, setAgeGroupFilter] = useState<string>('all')
    const [hubFilter, setHubFilter] = useState<string>('all')

    const [programQuestionsCache, setProgramQuestionsCache] = useState<
        Record<string, Record<string, string>>
    >({})

    const [activeProgram, setActiveProgram] = useState<any | null>(null)

    const cleanRole = (fullUser?.role || '').toLowerCase().replace(/\s+/g, '')
    const isRestrictedRole =
        cleanRole === 'projectadmin' || cleanRole === 'projectmanager'

    useEffect(() => {
        const loadActiveProgram = async () => {
            if (!activeProgramId || isAllPrograms) {
                setActiveProgram(null)
                return
            }
            try {
                const snap = await getDoc(doc(db, 'programs', activeProgramId))
                setActiveProgram(
                    snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null
                )
            } catch (e) {
                console.error('[loadActiveProgram] failed:', e)
                setActiveProgram(null)
            }
        }
        loadActiveProgram()
    }, [activeProgramId, isAllPrograms])

    const showHubFilter = !!activeProgram?.isMultiBranch
    const lgSpan = showHubFilter ? 4 : 6

    useEffect(() => {
        if (!showHubFilter) setHubFilter('all')
    }, [showHubFilter])

    const emailKey = (e?: string) => (e || '').toLowerCase().trim()

    const HIDDEN_DOMAINS = ['quantilytix.co.za']
    const isInternalEmail = (email?: string) =>
        !!email &&
        HIDDEN_DOMAINS.some(d =>
            email.toLowerCase().trim().endsWith(`@${d}`)
        )

    const getValidDocs = (docs?: any[]) =>
        (docs || []).filter(d => typeof d?.url === 'string' && d.url.trim() !== '')

    const safe = (v: any, fb: any = 'N/A') =>
        v === undefined || v === null || v === '' ? fb : v

    const joinAddr = (a?: {
        streetAddress?: string
        suburb?: string
        city?: string
        province?: string
        postalCode?: string
    }) =>
        a
            ? [a.streetAddress, a.suburb, a.city, a.province, a.postalCode]
                .filter(Boolean)
                .join(', ')
            : ''

    const normalizeParticipantFields = (p: any = {}) => ({
        phone: p.phone || p.mobile || p.whatsapp || '',
        email: p.email || p.participantEmail || '',
        streetAddress: p.businessAddress || p.streetAddress || p.physicalAddress || '',
        city: p.city || p.town || '',
        province: p.province || p.state || '',
        postalCode: p.postalCode || p.zip || '',
        gps: p.gps || p.coordinates || '',
        blackOwnedPercent: Number(p.blackOwnedPercent ?? '') || 0,
        femaleOwnedPercent: Number(p.femaleOwnedPercent ?? '') || 0,
        youthOwnedPercent: Number(p.youthOwnedPercent ?? '') || 0
    })

    const buildMergedContactLocation = (app: any, pPatch: any) => {
        const contact = {
            phone: pPatch.phone || app._contact?.phone || app.phone || '',
            email: pPatch.email || app._contact?.email || app.email || '',
            website: app._contact?.website || app.website || ''
        }
        const location = {
            streetAddress: pPatch.streetAddress || app._location?.streetAddress || '',
            city: pPatch.city || app._location?.city || '',
            province: pPatch.province || app._location?.province || '',
            postalCode: pPatch.postalCode || app._location?.postalCode || '',
            hub: app._location?.hub || app.hub || ''
        }
        const ownership = {
            blackOwnedPercent: pPatch.blackOwnedPercent ?? 0,
            femaleOwnedPercent: pPatch.femaleOwnedPercent ?? 0,
            youthOwnedPercent: pPatch.youthOwnedPercent ?? 0
        }
        const _fullAddress = [
            location.streetAddress,
            location.city,
            location.province,
            location.postalCode
        ]
            .filter(Boolean)
            .join(', ')
        return {
            _contact: contact,
            _location: location,
            _ownership: ownership,
            _fullAddress
        }
    }

    const ensureProgramQuestionMap = useCallback(
        async (programId?: string | null) => {
            const pid = (programId || '').trim()
            if (!pid) return {}

            if (programQuestionsCache[pid]) return programQuestionsCache[pid]

            try {
                const progSnap = await getDoc(doc(db, 'programs', pid))
                if (!progSnap.exists()) {
                    setProgramQuestionsCache(prev => ({ ...prev, [pid]: {} }))
                    return {}
                }

                const prog = progSnap.data() as any
                const qs: ProgramOnboardingQuestion[] = Array.isArray(prog.onboardingQuestions)
                    ? prog.onboardingQuestions
                    : []

                const map: Record<string, string> = {}
                qs.forEach(q => {
                    if (q?.id && q?.label) map[String(q.id)] = String(q.label)
                })

                if (!map['nearest-hub']) {
                    map['nearest-hub'] = 'Which hub is closest to you?'
                }

                setProgramQuestionsCache(prev => ({ ...prev, [pid]: map }))
                return map
            } catch (e) {
                console.error('[ensureProgramQuestionMap] failed:', e)
                setProgramQuestionsCache(prev => ({ ...prev, [pid]: {} }))
                return {}
            }
        },
        [programQuestionsCache]
    )

    const hydrateAI = (data: any) => {
        const out = { ...data }
        const aiEvaluation = data?.aiEvaluation
        let aiRec = 'Pending'
        let aiScore: number | string = 'N/A'
        let aiJust = 'No justification provided.'

        try {
            if (typeof aiEvaluation?.raw_response === 'string') {
                const cleaned = aiEvaluation.raw_response
                    .replace(/```json/i, '')
                    .replace(/```/g, '')
                    .trim()
                const parsed = JSON.parse(cleaned)
                aiRec = parsed['AI Recommendation'] ?? aiEvaluation['AI Recommendation'] ?? aiRec
                aiScore = parsed['AI Score'] ?? aiEvaluation['AI Score'] ?? aiScore
                aiJust = parsed['Justification'] ?? aiEvaluation['Justification'] ?? aiJust
            } else if (aiEvaluation && typeof aiEvaluation === 'object') {
                aiRec = aiEvaluation['AI Recommendation'] ?? aiRec
                aiScore = aiEvaluation['AI Score'] ?? aiScore
                aiJust = aiEvaluation['Justification'] ?? aiJust
            }
        } catch {
            if (typeof aiEvaluation?.raw_response === 'string') {
                aiJust = aiEvaluation.raw_response
            }
        }

        return { ...out, aiRecommendation: aiRec, aiScore, aiJustification: aiJust }
    }

    const isPlainObject = (v: any) =>
        Object.prototype.toString.call(v) === '[object Object]'

    const normalizeProfileMap = (profile: any): Record<string, any> => {
        if (!profile) return {}
        if (isPlainObject(profile)) return profile as Record<string, any>
        return {}
    }

    const extractProfileQA = (app: any) => {
        const pid = String(app?.programId || '').trim()
        const labelMap = pid ? programQuestionsCache[pid] || {} : {}

        const resolveLabel = (rawKeyOrQuestion: string) => {
            const key = String(rawKeyOrQuestion || '').trim()
            if (!key) return 'Question'
            if (labelMap[key]) return labelMap[key]
            if (key === 'nearest-hub') return 'Which hub is closest to you?'
            return key
        }

        if (Array.isArray(app?.profile) && app.profile.some((x: any) => x && typeof x === 'object')) {
            const pairs = app.profile
                .map((x: any) => {
                    const qid = String(
                        x.id || x.key || x.questionId || x.question || x.q || ''
                    ).trim()
                    const a = x.answer ?? x.a ?? x.value ?? x.response ?? ''
                    return { questionRaw: qid, question: resolveLabel(qid), answer: a }
                })
                .filter((x: any) => x.questionRaw || x.answer !== undefined)

            if (pairs.length) return pairs
        }

        const map = normalizeProfileMap(app?.profile)
        const keys = Object.keys(map)
        if (keys.length) {
            return keys.map(k => ({
                questionRaw: k,
                question: resolveLabel(k),
                answer: map[k]
            }))
        }

        if (Array.isArray(app?.profileQuestions) && Array.isArray(app?.profileAnswers)) {
            return app.profileQuestions.map((q: any, i: number) => {
                const qid = String(q || '').trim()
                return {
                    questionRaw: qid,
                    question: resolveLabel(qid),
                    answer: app.profileAnswers[i] ?? ''
                }
            })
        }

        if (Array.isArray(app?.profile)) {
            return app.profile.map((ans: any, i: number) => ({
                questionRaw: `Q${i + 1}`,
                question: `Question ${i + 1}`,
                answer: ans ?? ''
            }))
        }

        return []
    }

    const extractNearestHubFromProfile = (app: any): string => {
        const map = normalizeProfileMap(app?.profile)
        if (Object.prototype.hasOwnProperty.call(map, 'nearest-hub')) {
            return String(map['nearest-hub'] ?? '').trim()
        }
        if (Array.isArray(app?.profile)) {
            const hit = app.profile.find((x: any) => {
                const id = String(x?.id || x?.key || x?.questionId || '')
                    .toLowerCase()
                    .trim()
                return id === 'nearest-hub'
            })
            if (hit) return String(hit.answer ?? hit.value ?? '').trim()
        }
        return ''
    }

    const [participantByAppEmail, setParticipantByAppEmail] = useState<Record<string, any>>({})

    useEffect(() => {
        const load = async () => {
            const app = selectedApplication
            if (!app) return
            const key = emailKey(app.email)
            if (!key) return
            if (Object.prototype.hasOwnProperty.call(participantByAppEmail, key)) return

            setParticipantByAppEmail(prev => ({ ...prev, [key]: { __loading: true } }))
            try {
                const q1 = query(collection(db, 'participants'), where('email', '==', app.email))
                const s1 = await getDocs(q1)

                if (!s1.empty) {
                    const pData = s1.docs[0].data()
                    const pNorm = normalizeParticipantFields(pData)
                    const merged = buildMergedContactLocation(app, pNorm)
                    setParticipantByAppEmail(prev => ({
                        ...prev,
                        [key]: { ...pData, ...pNorm, ...merged, __loading: false }
                    }))
                } else {
                    setParticipantByAppEmail(prev => ({
                        ...prev,
                        [key]: { notFound: true, __loading: false }
                    }))
                }
            } catch (e) {
                console.error('Failed to load participant for app:', selectedApplication?.id, e)
                setParticipantByAppEmail(prev => ({
                    ...prev,
                    [key]: { error: true, __loading: false }
                }))
            }
        }
        load()
    }, [selectedApplication?.email])

    useEffect(() => {
        const run = async () => {
            const pid = String(selectedApplication?.programId || '').trim()
            if (!pid) return
            await ensureProgramQuestionMap(pid)
        }
        run()
    }, [selectedApplication?.programId, ensureProgramQuestionMap])

    const getCompulsoryInterventions = async () => {
        const q = query(
            collection(db, 'interventions'),
            where('compulsory', '==', true)
        )
        const snap = await getDocs(q)
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    }

    const addCompulsoryIntoAppRequired = async ({
        applicationId,
    }: {
        applicationId: string
    }) => {
        const appRef = doc(db, 'applications', applicationId)
        const appSnap = await getDoc(appRef)
        if (!appSnap.exists()) throw new Error('Application not found')

        const app = appSnap.data() as any
        const currentRequired: any[] =
            app?.interventions?.required ?? app?.requiredInterventions ?? []
        const currentIds = new Set(
            currentRequired.map((x: any) => x?.id || x?.interventionId)
        )

        const compulsory = await getCompulsoryInterventions()

        const toAdd = compulsory
            .filter(iv => !currentIds.has(iv.id))
            .map(iv => ({
                id: iv.id,
                title: iv.interventionTitle || iv.title || 'Intervention',
                area: iv.areaOfSupport || iv.department || 'General'
            }))

        if (toAdd.length === 0) return 0
        const nextRequired = [...currentRequired, ...toAdd]

        if (app?.interventions?.required) {
            await updateDoc(appRef, {
                'interventions.required': nextRequired,
                updatedAt: serverTimestamp()
            })
        } else {
            await updateDoc(appRef, {
                requiredInterventions: nextRequired,
                updatedAt: serverTimestamp()
            })
        }
        return toAdd.length
    }

    const resetIncubateeFirstLogin = async ({
        participantId,
        email,
        applicationId
    }: {
        participantId?: string
        email?: string
        applicationId: string
    }) => {
        try {
            if (participantId) {
                const uref = doc(db, 'users', participantId)
                const usnap = await getDoc(uref)
                if (usnap.exists()) {
                    await updateDoc(uref, {
                        firstLoginComplete: false,
                        acceptance: { applicationId, acceptedAt: serverTimestamp() }
                    })
                    return true
                }
            }

            if (email) {
                const uq = query(
                    collection(db, 'users'),
                    where('email', '==', email)
                )
                const us = await getDocs(uq)
                if (!us.empty) {
                    await Promise.all(
                        us.docs.map(d =>
                            updateDoc(d.ref, {
                                firstLoginComplete: false,
                                acceptance: { applicationId, acceptedAt: serverTimestamp() }
                            })
                        )
                    )
                    return true
                }
            }

            return false
        } catch (e) {
            console.error('[resetIncubateeFirstLogin] failed:', e)
            return false
        }
    }

    const promptRejectReason = (): Promise<string | null> => {
        return new Promise(resolve => {
            let reason = ''
            Modal.confirm({
                title: 'Provide a rejection reason',
                content: (
                    <Input.TextArea
                        autoSize={{ minRows: 3 }}
                        placeholder='Why is this application being rejected?'
                        onChange={e => {
                            reason = e.target.value
                        }}
                    />
                ),
                okText: 'Save Reason & Reject',
                cancelText: 'Cancel',
                onOk: () => resolve(reason.trim() || null),
                onCancel: () => resolve(null)
            })
        })
    }

    const updateStatus = async (
        newStatus: 'accepted' | 'rejected' | 'pending',
        docId: string,
        options?: { requireReason?: boolean }
    ) => {
        try {
            const ref = doc(db, 'applications', docId)
            const snap = await getDoc(ref)
            if (!snap.exists()) throw new Error('Application not found')

            const app = snap.data() as any

            let rejectionReason: string | null = null
            if (newStatus === 'rejected' && options?.requireReason) {
                rejectionReason = await promptRejectReason()
                if (!rejectionReason) {
                    message.info('Rejection cancelled.')
                    return
                }
            }

            const applicantEmail = app.applicantEmail || app.email || null
            const applicantName =
                app.applicantName || app.beneficiaryName || app.businessName || null
            const programName = app.programName || app.program?.name || null

            const baseUpdate: any = {
                applicationStatus: newStatus,
                applicantEmail,
                applicantName,
                programName,
                decision: {
                    status: newStatus,
                    decidedAt: serverTimestamp(),
                    decidedBy: {
                        uid: auth.currentUser?.uid || null,
                        email: auth.currentUser?.email || null
                    },
                    ...(newStatus === 'rejected' && rejectionReason
                        ? { reason: rejectionReason }
                        : {})
                },
                ...(newStatus === 'rejected' && rejectionReason
                    ? { rejectionReason }
                    : {}),
                updatedAt: serverTimestamp()
            }

            if (newStatus === 'accepted' && !app.acceptedAt) {
                baseUpdate.acceptedAt = serverTimestamp()
                baseUpdate.rejectedAt = null
            } else if (newStatus === 'rejected') {
                baseUpdate.rejectedAt = serverTimestamp()
            }

            await updateDoc(ref, baseUpdate)

            if (newStatus === 'accepted') {
                const participantId = app.participantId

                await resetIncubateeFirstLogin({
                    participantId,
                    email: applicantEmail || undefined,
                    applicationId: docId
                })


                const created = await addCompulsoryIntoAppRequired({
                    applicationId: docId,
                })
                if (created > 0) {
                    message.success(
                        `Added ${created} compulsory intervention(s) to interventions.required`
                    )
                } else {
                    message.info('No new compulsory interventions to add.')
                }

            }

            message.success('Status updated successfully')
            await fetchApplications()

            const updated = await getDoc(ref)
            if (updated.exists()) {
                const hydrated = hydrateAI({ id: ref.id, ...updated.data() })
                setSelectedApplication(prev =>
                    prev?.id === ref.id ? hydrated : prev
                )
            }
        } catch (error: any) {
            console.error('Error updating status:', error)
            message.error(`Failed to update status: ${error?.message || String(error)}`)
        }
    }

    const fetchApplications = useCallback(async () => {

        if (isRestrictedRole && !activeProgramId) {
            setApplications([])
            return
        }

        if (!isRestrictedRole && !isAllPrograms && !activeProgramId) {
            setApplications([])
            return
        }

        setLoading(true)

        try {


            const applicationConstraints: QueryConstraint[] = []

            // Restricted roles must always work within an active program.
            // Other roles are only program-scoped when a specific program is selected.
            const shouldFilterByProgram =
                isRestrictedRole || !isAllPrograms

            if (shouldFilterByProgram && activeProgramId) {
                applicationConstraints.push(
                    where('programId', '==', activeProgramId)
                )
            }

            const qApps = query(
                collection(db, 'applications'),
                ...applicationConstraints
            )
            const snapshot = await getDocs(qApps)

            let apps = snapshot.docs.map(docSnap => {
                const data = docSnap.data() || {}

                const contact = {
                    phone: data.phone || '',
                    email: data.email || '',
                    website: data.website || '',
                    facebook: data.facebook || '',
                    instagram: data.instagram || '',
                    linkedin: data.linkedin || ''
                }

                const location = {
                    streetAddress: data.streetAddress || data.address || data.physicalAddress || '',
                    suburb: data.suburb || '',
                    city: data.city || data.town || '',
                    province: data.province || data.state || '',
                    postalCode: data.postalCode || data.zip || '',
                    hub: data.hub || ''
                }

                const normalizedProgramId =
                    data.programId ||
                    data.programID ||
                    data.program?.id ||
                    data.program ||
                    null

                const nearestHub = extractNearestHubFromProfile({
                    ...data,
                    profile: data.profile
                })
                const effectiveHub =
                    (nearestHub || location.hub || 'N/A').toString().trim() || 'N/A'

                const base = {
                    id: docSnap.id,
                    ...data,
                    beneficiaryName: data.beneficiaryName || 'N/A',
                    gender: data.gender || 'N/A',
                    ageGroup: data.ageGroup || 'N/A',
                    stage: data.stage || 'N/A',
                    hub: effectiveHub,
                    email: contact.email || 'N/A',
                    motivation: data.motivation || '',
                    challenges: data.challenges || '',
                    documents: data.complianceDocuments || [],
                    applicationStatus: data.applicationStatus || 'pending',
                    growthPlanDocUrl: data.growthPlanDocUrl || null,
                    programId: normalizedProgramId,
                    decision: data.decision || null,
                    _contact: contact,
                    _location: { ...location, hub: effectiveHub },
                    _fullAddress: joinAddr(location)
                }

                return hydrateAI(base)
            })

            apps = apps.filter(app => !isInternalEmail(app.email))

            apps.sort((a, b) => {
                const aScore = isNaN(Number(a.aiScore)) ? -Infinity : Number(a.aiScore)
                const bScore = isNaN(Number(b.aiScore)) ? -Infinity : Number(b.aiScore)
                return bScore - aScore
            })

            setApplications(apps)
            setSelectedApplication(previous =>
                previous && apps.some(app => app.id === previous.id)
                    ? previous
                    : null
            )

            const programIds = Array.from(
                new Set(
                    apps
                        .map(a => String(a.programId || '').trim())
                        .filter(Boolean)
                )
            )
            await Promise.all(programIds.map(pid => ensureProgramQuestionMap(pid)))
        } catch (error) {
            console.error('Error fetching applications:', error)
            message.error('Failed to fetch applications')
        } finally {
            setLoading(false)
        }
    }, [
        activeProgramId,
        isAllPrograms,
        isRestrictedRole,
        ensureProgramQuestionMap
    ])

    useEffect(() => {
        fetchApplications()
    }, [fetchApplications])

    const hubOptions = useMemo(() => {
        const set = new Set<string>()
        applications.forEach(a => {
            const h = String(a.hub || '').trim()
            if (h && h !== 'N/A') set.add(h)
        })
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    }, [applications])

    const filteredApplications = useMemo(() => {
        return applications.filter(app => {
            const matchesSearch =
                String(app.beneficiaryName || '')
                    .toLowerCase()
                    .includes(searchTerm.toLowerCase()) ||
                String(app.email || '')
                    .toLowerCase()
                    .includes(searchTerm.toLowerCase())

            const matchesGender =
                genderFilter === 'all' || app.gender === genderFilter
            const matchesStatus =
                statusFilter === 'all' || app.applicationStatus === statusFilter
            const matchesAgeGroup =
                ageGroupFilter === 'all' || app.ageGroup === ageGroupFilter

            const appHub = String(app.hub || '').trim()
            const matchesHub = hubFilter === 'all' || appHub === hubFilter
            const hubGate = showHubFilter ? matchesHub : true

            return (
                matchesSearch &&
                matchesGender &&
                matchesStatus &&
                matchesAgeGroup &&
                hubGate
            )
        })
    }, [
        applications,
        searchTerm,
        genderFilter,
        statusFilter,
        ageGroupFilter,
        hubFilter,
        showHubFilter
    ])

    const stats = useMemo(() => {
        const total = filteredApplications.length
        const accepted = filteredApplications.filter(
            a => a.applicationStatus === 'accepted'
        ).length
        const rejected = filteredApplications.filter(
            a => a.applicationStatus === 'rejected'
        ).length
        const pending = filteredApplications.filter(
            a => a.applicationStatus === 'pending'
        ).length
        return { total, accepted, rejected, pending }
    }, [filteredApplications])

    const genderDistribution = useMemo(() => {
        const distribution = filteredApplications.reduce((acc, app) => {
            acc[app.gender] = (acc[app.gender] || 0) + 1
            return acc
        }, {} as Record<string, number>)
        return Object.entries(distribution)
    }, [filteredApplications])

    const ageGroupDistribution = useMemo(() => {
        const distribution = filteredApplications.reduce((acc, app) => {
            acc[app.ageGroup] = (acc[app.ageGroup] || 0) + 1
            return acc
        }, {} as Record<string, number>)
        return Object.entries(distribution)
    }, [filteredApplications])

    const getStatusColor = (status: string) => {
        switch ((status || '').toLowerCase()) {
            case 'accept':
            case 'accepted':
                return 'success'
            case 'reject':
            case 'rejected':
                return 'error'
            case 'pending':
                return 'warning'
            default:
                return 'default'
        }
    }

    const getStatusIcon = (status: string) => {
        switch ((status || '').toLowerCase()) {
            case 'accepted':
                return <CheckCircleOutlined />
            case 'rejected':
                return <CloseCircleOutlined />
            default:
                return <FileTextOutlined />
        }
    }

    const exportCSV = () => {
        const headers = [
            'Enterprise Name',
            'Email',
            'Gender',
            'Age Group',
            'Stage',
            'Hub',
            'Status',
            'AI Score'
        ]
        const rows = filteredApplications.map(app => [
            app.beneficiaryName,
            app.email,
            app.gender,
            app.ageGroup,
            app.stage,
            app.hub,
            app.applicationStatus,
            app.aiScore
        ])
        const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'applications.csv'
        a.click()
        URL.revokeObjectURL(url)
    }

    const columns = [
        { title: 'Enterprise', dataIndex: 'beneficiaryName', key: 'beneficiaryName' },
        {
            title: 'Gender',
            dataIndex: 'gender',
            key: 'gender',
            responsive: ['md'] as any
        },
        {
            title: 'Age Group',
            dataIndex: 'ageGroup',
            key: 'ageGroup',
            responsive: ['md'] as any
        },
        {
            title: 'AI Score',
            dataIndex: 'aiScore',
            key: 'aiScore',
            render: (score: number) => (
                <Badge count={score} style={{ backgroundColor: '#faad14' }} />
            )
        },
        {
            title: 'Status',
            dataIndex: 'applicationStatus',
            key: 'status',
            render: (status: string) => (
                <Badge
                    status={getStatusColor(status)}
                    text={
                        <span>
                            {getStatusIcon(status)}{' '}
                            {status?.charAt(0).toUpperCase() + status?.slice(1)}
                        </span>
                    }
                />
            )
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, record: any) => (
                <Space>
                    <Button
                        type='text'
                        icon={<EyeOutlined />}
                        onClick={() => {
                            setSelectedDocApp(record)
                            setIsModalVisible(true)
                        }}
                    />
                    {record.growthPlanDocUrl && (
                        <Button
                            type='text'
                            icon={<DownloadOutlined />}
                            href={record.growthPlanDocUrl}
                            target='_blank'
                        />
                    )}
                </Space>
            )
        }
    ]

    const handleStatusSelect = async (
        value: 'accepted' | 'rejected' | 'pending',
        appId: string
    ) => {
        if (value === 'rejected') {
            await updateStatus('rejected', appId, { requireReason: true })
        } else {
            await updateStatus(value, appId)
        }
    }

    const showEmptyState =
        !loading &&
        ((isRestrictedRole && !activeProgramId) ||
            (!isRestrictedRole && !isAllPrograms && !activeProgramId))

    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Helmet>
                <title>Applications Overview</title>
            </Helmet>

            {showEmptyState ? (
                <MotionCard
                >
                    <Empty description='Select an active program to view applications' />
                </MotionCard>
            ) : (
                <>
                    <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                        {[
                            {
                                title: 'Total Applications',
                                value: stats.total,
                                icon: <FileTextOutlined />,
                                color: '#1890ff',
                                bgColor: '#e6f7ff'
                            },
                            {
                                title: 'Accepted',
                                value: stats.accepted,
                                icon: <CheckCircleOutlined />,
                                color: '#52c41a',
                                bgColor: '#f6ffed'
                            },
                            {
                                title: 'Rejected',
                                value: stats.rejected,
                                icon: <CloseCircleOutlined />,
                                color: '#f5222d',
                                bgColor: '#fff2f0'
                            },
                            {
                                title: 'Pending',
                                value: stats.pending,
                                icon: <RiseOutlined />,
                                color: '#faad14',
                                bgColor: '#fffbe6'
                            }
                        ].map((metric, index) => (
                            <Col span={24} md={12} lg={6} key={metric.title}>
                                <MotionCard>
                                    <MotionCard.Metric
                                        icon={React.cloneElement(metric.icon, {
                                            style: {
                                                fontSize: 18,
                                                color: metric.color
                                            }
                                        })}
                                        iconBg={metric.bgColor}
                                        title={metric.title}
                                        value={
                                            <span style={{ color: metric.color }}>
                                                {metric.value}
                                            </span>
                                        }
                                    />
                                </MotionCard>
                            </Col>
                        ))}
                    </Row>

                    <Row gutter={16} style={{ marginBottom: 24 }}>
                        <Col span={24} lg={12}>
                            <Card
                                title={
                                    <span>
                                        <UserOutlined style={{ marginRight: 8 }} />
                                        Gender Distribution
                                    </span>
                                }
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    border: '1px solid #d6e4ff'
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 16
                                    }}
                                >
                                    {genderDistribution.map(([gender, count]) => (
                                        <div
                                            key={gender}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between'
                                            }}
                                        >
                                            <span style={{ fontWeight: 500 }}>{gender}</span>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: 160,
                                                        height: 8,
                                                        background: '#f0f0f0',
                                                        borderRadius: 4,
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            height: '100%',
                                                            background: '#1890ff',
                                                            borderRadius: 4,
                                                            width: `${((count as number) /
                                                                (stats.total || 1)) *
                                                                100
                                                                }%`
                                                        }}
                                                    />
                                                </div>
                                                <span
                                                    style={{
                                                        color: 'rgba(0, 0, 0, 0.45)',
                                                        width: 32
                                                    }}
                                                >
                                                    {count as number}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        </Col>

                        <Col span={24} lg={12}>
                            <Card
                                title={
                                    <span>
                                        <PieChartOutlined style={{ marginRight: 8 }} />
                                        Age Group Distribution
                                    </span>
                                }
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    border: '1px solid #d6e4ff'
                                }}
                            >
                                <Skeleton loading={loading} active paragraph={{ rows: 4 }}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 16
                                        }}
                                    >
                                        {ageGroupDistribution.map(([ageGroup, count]) => (
                                            <div
                                                key={ageGroup}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between'
                                                }}
                                            >
                                                <span style={{ fontWeight: 500 }}>
                                                    {ageGroup}
                                                </span>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: 160,
                                                            height: 8,
                                                            background: '#f0f0f0',
                                                            borderRadius: 4,
                                                            overflow: 'hidden'
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                height: '100%',
                                                                background: '#13c2c2',
                                                                borderRadius: 4,
                                                                width: `${((count as number) /
                                                                    (stats.total || 1)) *
                                                                    100
                                                                    }%`
                                                            }}
                                                        />
                                                    </div>
                                                    <span
                                                        style={{
                                                            color: 'rgba(0, 0, 0, 0.45)',
                                                            width: 32
                                                        }}
                                                    >
                                                        {count as number}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </Skeleton>
                            </Card>
                        </Col>
                    </Row>

                    <MotionCard
                        filterBar={
                            <Row
                                gutter={12}
                                align='middle'
                                wrap={false}
                                style={{
                                    minWidth: showHubFilter ? 1120 : 960
                                }}
                            >
                                <Col flex='2 1 240px'>
                                    <Input
                                        placeholder='Search enterprises...'
                                        prefix={<SearchOutlined />}
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        allowClear
                                    />
                                </Col>

                                <Col flex='1 1 145px'>
                                    <Select
                                        style={{ width: '100%' }}
                                        value={genderFilter}
                                        onChange={setGenderFilter}
                                        placeholder='Filter by Gender'
                                    >
                                        <Option value='all'>All Genders</Option>
                                        <Option value='Male'>Male</Option>
                                        <Option value='Female'>Female</Option>
                                        <Option value='Other'>Other</Option>
                                    </Select>
                                </Col>

                                <Col flex='1 1 145px'>
                                    <Select
                                        style={{ width: '100%' }}
                                        value={ageGroupFilter}
                                        onChange={setAgeGroupFilter}
                                        placeholder='Filter by Age Group'
                                    >
                                        <Option value='all'>All Age Groups</Option>
                                        <Option value='Youth'>Youth</Option>
                                        <Option value='Adult'>Adult</Option>
                                        <Option value='Senior'>Senior</Option>
                                    </Select>
                                </Col>

                                <Col flex='1 1 145px'>
                                    <Select
                                        style={{ width: '100%' }}
                                        value={statusFilter}
                                        onChange={setStatusFilter}
                                        placeholder='Filter by Status'
                                    >
                                        <Option value='all'>All Statuses</Option>
                                        <Option value='accepted'>Accepted</Option>
                                        <Option value='rejected'>Rejected</Option>
                                        <Option value='pending'>Pending</Option>
                                    </Select>
                                </Col>

                                {showHubFilter && (
                                    <Col flex='1 1 145px'>
                                        <Select
                                            style={{ width: '100%' }}
                                            value={hubFilter}
                                            onChange={setHubFilter}
                                            placeholder='Filter by Hub'
                                        >
                                            <Option value='all'>All Hubs</Option>

                                            {hubOptions.map(h => (
                                                <Option key={h} value={h}>
                                                    {h}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Col>
                                )}

                                <Col flex='none'>
                                    <Space size={8} wrap={false}>
                                        <Button
                                            onClick={() => {
                                                setSearchTerm('')
                                                setGenderFilter('all')
                                                setAgeGroupFilter('all')
                                                setStatusFilter('all')
                                                setHubFilter('all')
                                            }}
                                        >
                                            Clear Filters
                                        </Button>

                                        <Button
                                            icon={<DownloadOutlined />}
                                            onClick={exportCSV}
                                        >
                                            Export CSV
                                        </Button>
                                    </Space>
                                </Col>
                            </Row>
                        }
                        filterBarProps={{ marginBottom: 0 }}
                        style={{ marginBottom: 16 }}
                    >



                    </MotionCard>

                    <Row gutter={16}>
                        <Col span={24} lg={16}>
                            <Card
                                title={`Applications (${filteredApplications.length})`}
                                bordered={false}
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    borderRadius: 8,
                                    marginBottom: 16,
                                    border: '1px solid #d6e4ff'
                                }}
                            >
                                <Table
                                    columns={columns as any}
                                    dataSource={filteredApplications}
                                    rowKey='id'
                                    loading={loading}
                                    onRow={record => ({
                                        onClick: () => setSelectedApplication(hydrateAI(record)),
                                        style: { cursor: 'pointer' }
                                    })}
                                    pagination={{ pageSize: 10, showSizeChanger: false, position: ['bottomCenter'] }}
                                />
                            </Card>
                        </Col>

                        <Col span={24} lg={8}>
                            <Card
                                title='Application Details'
                                bordered={false}
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    borderRadius: 8,
                                    border: '1px solid #d6e4ff'
                                }}
                            >
                                {selectedApplication ? (
                                    <Tabs centered defaultActiveKey='overview'>
                                        <TabPane tab='Overview' key='overview'>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: 16
                                                }}
                                            >
                                                <div>
                                                    <h3
                                                        style={{
                                                            fontSize: 16,
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        {selectedApplication.beneficiaryName}
                                                    </h3>
                                                    <p style={{ color: 'rgba(0, 0, 0, 0.45)' }}>
                                                        {selectedApplication.email}
                                                    </p>
                                                </div>

                                                <Row gutter={16}>
                                                    <Col span={12}>
                                                        <p style={{ fontWeight: 500 }}>Gender</p>
                                                        <p
                                                            style={{
                                                                color:
                                                                    'rgba(0, 0, 0, 0.45)'
                                                            }}
                                                        >
                                                            {selectedApplication.gender}
                                                        </p>
                                                    </Col>
                                                    <Col span={12}>
                                                        <p style={{ fontWeight: 500 }}>
                                                            Age Group
                                                        </p>
                                                        <p
                                                            style={{
                                                                color:
                                                                    'rgba(0, 0, 0, 0.45)'
                                                            }}
                                                        >
                                                            {selectedApplication.ageGroup}
                                                        </p>
                                                    </Col>
                                                    <Col span={12}>
                                                        <p style={{ fontWeight: 500 }}>Stage</p>
                                                        <p
                                                            style={{
                                                                color:
                                                                    'rgba(0, 0, 0, 0.45)'
                                                            }}
                                                        >
                                                            {selectedApplication.stage}
                                                        </p>
                                                    </Col>
                                                    <Col span={12}>
                                                        <p style={{ fontWeight: 500 }}>Hub</p>
                                                        <p
                                                            style={{
                                                                color:
                                                                    'rgba(0, 0, 0, 0.45)'
                                                            }}
                                                        >
                                                            {safe(selectedApplication.hub)}
                                                        </p>
                                                    </Col>
                                                </Row>

                                                <div>
                                                    <p
                                                        style={{
                                                            fontWeight: 500,
                                                            marginBottom: 8
                                                        }}
                                                    >
                                                        Motivation
                                                    </p>
                                                    <Text
                                                        style={{
                                                            color: 'rgba(0, 0, 0, 0.45)',
                                                            whiteSpace: 'pre-line'
                                                        }}
                                                    >
                                                        {selectedApplication.motivation || 'N/A'}
                                                    </Text>
                                                </div>

                                                <div>
                                                    <p
                                                        style={{
                                                            fontWeight: 500,
                                                            marginBottom: 8
                                                        }}
                                                    >
                                                        Challenges
                                                    </p>
                                                    <Text
                                                        style={{
                                                            color: 'rgba(0, 0, 0, 0.45)',
                                                            whiteSpace: 'pre-line'
                                                        }}
                                                    >
                                                        {selectedApplication.challenges || 'N/A'}
                                                    </Text>
                                                </div>
                                            </div>
                                        </TabPane>

                                        <TabPane tab='Profile' key='profile'>
                                            {(() => {
                                                const pid = String(
                                                    selectedApplication?.programId || ''
                                                ).trim()
                                                const hasMap = !!(
                                                    pid &&
                                                    programQuestionsCache[pid] &&
                                                    Object.keys(programQuestionsCache[pid]).length
                                                )

                                                const qa = extractProfileQA(selectedApplication)

                                                if (!qa.length) {
                                                    return (
                                                        <Alert
                                                            type='info'
                                                            showIcon
                                                            message='No profile answers found'
                                                            description='This application does not have stored profile answers yet.'
                                                        />
                                                    )
                                                }

                                                return (
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: 10
                                                        }}
                                                    >
                                                        {!hasMap && (
                                                            <Alert
                                                                type='warning'
                                                                showIcon
                                                                message='Program onboarding questions not found'
                                                                description='This application has profile answers, but the program onboardingQuestions could not be loaded, so labels may look like ids.'
                                                                style={{ marginBottom: 8 }}
                                                            />
                                                        )}

                                                        {qa.map((item: any, idx: number) => (
                                                            <Card key={idx} size='small'>
                                                                <Text strong>
                                                                    {item.question ||
                                                                        `Question ${idx + 1}`}
                                                                </Text>
                                                                <div
                                                                    style={{
                                                                        marginTop: 6,
                                                                        color:
                                                                            'rgba(0,0,0,0.65)',
                                                                        whiteSpace:
                                                                            'pre-line'
                                                                    }}
                                                                >
                                                                    {String(item.answer ?? '').trim() ||
                                                                        'N/A'}
                                                                </div>
                                                            </Card>
                                                        ))}
                                                    </div>
                                                )
                                            })()}
                                        </TabPane>

                                        <TabPane tab='Contact' key='contact'>
                                            {(() => {
                                                const key = emailKey(selectedApplication.email)
                                                const cacheEntry = participantByAppEmail[key]
                                                const hasCache =
                                                    Object.prototype.hasOwnProperty.call(
                                                        participantByAppEmail,
                                                        key
                                                    )
                                                const isLoadingEntry =
                                                    !!cacheEntry?.__loading

                                                if (!hasCache || isLoadingEntry) {
                                                    return (
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: 12
                                                            }}
                                                        >
                                                            <Card size='small'>
                                                                <Skeleton
                                                                    active
                                                                    title={false}
                                                                    paragraph={{
                                                                        rows: 2
                                                                    }}
                                                                />
                                                            </Card>
                                                            <Card size='small'>
                                                                <Skeleton
                                                                    active
                                                                    title={false}
                                                                    paragraph={{
                                                                        rows: 2
                                                                    }}
                                                                />
                                                            </Card>
                                                            <Card size='small'>
                                                                <Skeleton
                                                                    active
                                                                    title={false}
                                                                    paragraph={{
                                                                        rows: 2
                                                                    }}
                                                                />
                                                            </Card>
                                                        </div>
                                                    )
                                                }

                                                const p = cacheEntry || {}
                                                const effectiveContact =
                                                    p._contact ||
                                                    selectedApplication._contact ||
                                                    {}
                                                const effectiveLocation =
                                                    p._location ||
                                                    selectedApplication._location ||
                                                    {}
                                                const effectiveFullAddress =
                                                    p._fullAddress ||
                                                    selectedApplication._fullAddress ||
                                                    ''
                                                const ownership = p._ownership || {
                                                    blackOwnedPercent: 0,
                                                    femaleOwnedPercent: 0,
                                                    youthOwnedPercent: 0
                                                }

                                                return (
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: 12
                                                        }}
                                                    >
                                                        <Card size='small' bordered>
                                                            <Row gutter={[12, 8]}>
                                                                <Col span={24}>
                                                                    <Text strong>
                                                                        Contact
                                                                    </Text>
                                                                </Col>
                                                                <Col span={24}>
                                                                    <Space wrap>
                                                                        <MailOutlined />
                                                                        <a
                                                                            href={
                                                                                effectiveContact.email
                                                                                    ? `mailto:${effectiveContact.email}`
                                                                                    : undefined
                                                                            }
                                                                            onClick={e => {
                                                                                if (
                                                                                    !effectiveContact.email
                                                                                )
                                                                                    e.preventDefault()
                                                                            }}
                                                                        >
                                                                            {effectiveContact.email ||
                                                                                'N/A'}
                                                                        </a>
                                                                        {effectiveContact.email && (
                                                                            <Tooltip title='Copy email'>
                                                                                <Button
                                                                                    size='small'
                                                                                    icon={
                                                                                        <CopyOutlined />
                                                                                    }
                                                                                    onClick={() =>
                                                                                        navigator.clipboard.writeText(
                                                                                            effectiveContact.email
                                                                                        )
                                                                                    }
                                                                                />
                                                                            </Tooltip>
                                                                        )}
                                                                    </Space>
                                                                </Col>

                                                                <Col span={24}>
                                                                    <Space wrap>
                                                                        <PhoneOutlined />
                                                                        {effectiveContact.phone ? (
                                                                            <>
                                                                                <a
                                                                                    href={`tel:${effectiveContact.phone}`}
                                                                                >
                                                                                    {
                                                                                        effectiveContact.phone
                                                                                    }
                                                                                </a>
                                                                                <Tooltip title='Copy phone'>
                                                                                    <Button
                                                                                        size='small'
                                                                                        icon={
                                                                                            <CopyOutlined />
                                                                                        }
                                                                                        onClick={() =>
                                                                                            navigator.clipboard.writeText(
                                                                                                effectiveContact.phone
                                                                                            )
                                                                                        }
                                                                                    />
                                                                                </Tooltip>
                                                                            </>
                                                                        ) : (
                                                                            <span
                                                                                style={{
                                                                                    color: 'rgba(0,0,0,0.45)'
                                                                                }}
                                                                            >
                                                                                N/A
                                                                            </span>
                                                                        )}
                                                                    </Space>
                                                                </Col>

                                                                {effectiveContact.website && (
                                                                    <Col span={24}>
                                                                        <Space wrap>
                                                                            <GlobalOutlined />
                                                                            <a
                                                                                href={
                                                                                    effectiveContact.website.startsWith(
                                                                                        'http'
                                                                                    )
                                                                                        ? effectiveContact.website
                                                                                        : `https://${effectiveContact.website}`
                                                                                }
                                                                                target='_blank'
                                                                                rel='noreferrer'
                                                                            >
                                                                                {
                                                                                    effectiveContact.website
                                                                                }
                                                                            </a>
                                                                        </Space>
                                                                    </Col>
                                                                )}
                                                            </Row>
                                                        </Card>

                                                        <Card size='small' bordered>
                                                            <Row gutter={[12, 8]}>
                                                                <Col span={24}>
                                                                    <Text strong>
                                                                        Location
                                                                    </Text>
                                                                </Col>
                                                                <Col span={24}>
                                                                    <Space
                                                                        align='start'
                                                                        style={{
                                                                            display: 'flex'
                                                                        }}
                                                                    >
                                                                        <EnvironmentOutlined
                                                                            style={{
                                                                                marginTop: 2
                                                                            }}
                                                                        />
                                                                        <div style={{ flex: 1 }}>
                                                                            <div>
                                                                                {effectiveFullAddress ||
                                                                                    'N/A'}
                                                                            </div>
                                                                            <div
                                                                                style={{
                                                                                    color: 'rgba(0,0,0,0.45)'
                                                                                }}
                                                                            >
                                                                                {[
                                                                                    effectiveLocation.city,
                                                                                    effectiveLocation.province
                                                                                ]
                                                                                    .filter(Boolean)
                                                                                    .join(', ')}
                                                                            </div>
                                                                        </div>
                                                                    </Space>
                                                                </Col>
                                                                {effectiveLocation.hub && (
                                                                    <Col span={24}>
                                                                        <Tag color='blue'>
                                                                            Hub:{' '}
                                                                            {effectiveLocation.hub}
                                                                        </Tag>
                                                                    </Col>
                                                                )}
                                                            </Row>
                                                        </Card>

                                                        <Card size='small' bordered>
                                                            <Row gutter={[12, 12]}>
                                                                <Col span={24}>
                                                                    <Text strong>
                                                                        Ownership
                                                                    </Text>
                                                                </Col>
                                                                <Col span={24}>
                                                                    <Row gutter={12}>
                                                                        <Col span={24}>
                                                                            <div
                                                                                style={{
                                                                                    display: 'flex',
                                                                                    justifyContent:
                                                                                        'space-between'
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    Black Owned
                                                                                </span>
                                                                                <span>
                                                                                    {
                                                                                        ownership.blackOwnedPercent
                                                                                    }
                                                                                    %
                                                                                </span>
                                                                            </div>
                                                                            <Progress
                                                                                percent={
                                                                                    ownership.blackOwnedPercent
                                                                                }
                                                                                showInfo={false}
                                                                            />
                                                                        </Col>
                                                                        <Col span={24}>
                                                                            <div
                                                                                style={{
                                                                                    display: 'flex',
                                                                                    justifyContent:
                                                                                        'space-between'
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    Female Owned
                                                                                </span>
                                                                                <span>
                                                                                    {
                                                                                        ownership.femaleOwnedPercent
                                                                                    }
                                                                                    %
                                                                                </span>
                                                                            </div>
                                                                            <Progress
                                                                                percent={
                                                                                    ownership.femaleOwnedPercent
                                                                                }
                                                                                showInfo={false}
                                                                            />
                                                                        </Col>
                                                                        <Col span={24}>
                                                                            <div
                                                                                style={{
                                                                                    display: 'flex',
                                                                                    justifyContent:
                                                                                        'space-between'
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    Youth Owned
                                                                                </span>
                                                                                <span>
                                                                                    {
                                                                                        ownership.youthOwnedPercent
                                                                                    }
                                                                                    %
                                                                                </span>
                                                                            </div>
                                                                            <Progress
                                                                                percent={
                                                                                    ownership.youthOwnedPercent
                                                                                }
                                                                                showInfo={false}
                                                                            />
                                                                        </Col>
                                                                    </Row>
                                                                </Col>
                                                            </Row>
                                                        </Card>
                                                    </div>
                                                )
                                            })()}
                                        </TabPane>

                                        <TabPane tab='AI Analysis' key='ai'>
                                            <Card>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 16
                                                    }}
                                                >
                                                    <div>
                                                        <p
                                                            style={{
                                                                fontWeight: 500,
                                                                margin: 0
                                                            }}
                                                        >
                                                            Current Status (Alterable)
                                                        </p>
                                                        <Select
                                                            style={{
                                                                width: '100%',
                                                                marginTop: 8
                                                            }}
                                                            value={
                                                                selectedApplication.applicationStatus
                                                            }
                                                            placeholder='Update Status'
                                                            onChange={value =>
                                                                handleStatusSelect(
                                                                    value,
                                                                    selectedApplication.id
                                                                )
                                                            }
                                                        >
                                                            <Option value='accepted'>
                                                                Accept
                                                            </Option>
                                                            <Option value='rejected'>
                                                                Reject
                                                            </Option>
                                                            <Option value='pending'>
                                                                Pending
                                                            </Option>
                                                        </Select>
                                                    </div>

                                                    {String(
                                                        selectedApplication.applicationStatus
                                                    ).toLowerCase() === 'rejected' && (
                                                            <Alert
                                                                type='error'
                                                                showIcon
                                                                message='Rejection Reason'
                                                                description={
                                                                    selectedApplication?.decision
                                                                        ?.reason ||
                                                                    selectedApplication?.rejectionReason ||
                                                                    'No reason captured.'
                                                                }
                                                            />
                                                        )}

                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent:
                                                                'space-between'
                                                        }}
                                                    >
                                                        <p
                                                            style={{
                                                                fontWeight: 500,
                                                                margin: 0
                                                            }}
                                                        >
                                                            AI Score
                                                        </p>
                                                        <Badge
                                                            count={selectedApplication.aiScore}
                                                            style={{
                                                                backgroundColor: '#faad14'
                                                            }}
                                                        />
                                                    </div>

                                                    <div>
                                                        <p
                                                            style={{
                                                                fontWeight: 500,
                                                                marginBottom: 8
                                                            }}
                                                        >
                                                            AI Recommendation
                                                        </p>
                                                        <Tag
                                                            color={getStatusColor(
                                                                selectedApplication.aiRecommendation?.toLowerCase?.() ||
                                                                ''
                                                            )}
                                                        >
                                                            {
                                                                selectedApplication.aiRecommendation
                                                            }
                                                        </Tag>
                                                    </div>

                                                    <div>
                                                        <p
                                                            style={{
                                                                fontWeight: 500,
                                                                marginBottom: 8
                                                            }}
                                                        >
                                                            Justification
                                                        </p>
                                                        <Text
                                                            style={{
                                                                color: 'rgba(0, 0, 0, 0.45)',
                                                                whiteSpace: 'pre-line'
                                                            }}
                                                        >
                                                            {selectedApplication.aiJustification ||
                                                                'N/A'}
                                                        </Text>
                                                    </div>
                                                </div>
                                            </Card>
                                        </TabPane>

                                        <TabPane tab='Documents' key='documents'>
                                            {(() => {
                                                const docs = getValidDocs(
                                                    selectedApplication?.documents
                                                )
                                                const hasGrowth = Boolean(
                                                    selectedApplication?.growthPlanDocUrl
                                                )
                                                const hasAny = docs.length > 0 || hasGrowth

                                                if (!hasAny) {
                                                    return (
                                                        <Alert
                                                            type='info'
                                                            showIcon
                                                            message='No documents uploaded'
                                                            description='We couldn’t find any files for this application yet.'
                                                        />
                                                    )
                                                }

                                                return (
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: 8
                                                        }}
                                                    >
                                                        {docs.map(
                                                            (docItem: any, idx: number) => (
                                                                <Card
                                                                    key={idx}
                                                                    size='small'
                                                                >
                                                                    <div
                                                                        style={{
                                                                            display: 'flex',
                                                                            justifyContent:
                                                                                'space-between',
                                                                            alignItems:
                                                                                'center'
                                                                        }}
                                                                    >
                                                                        <div>
                                                                            <p
                                                                                style={{
                                                                                    fontWeight: 500
                                                                                }}
                                                                            >
                                                                                {docItem.type ||
                                                                                    'Document'}
                                                                            </p>
                                                                            <p
                                                                                style={{
                                                                                    color:
                                                                                        'rgba(0, 0, 0, 0.45)'
                                                                                }}
                                                                            >
                                                                                {docItem.fileName ||
                                                                                    (() => {
                                                                                        try {
                                                                                            return new URL(
                                                                                                docItem.url
                                                                                            ).pathname
                                                                                                .split(
                                                                                                    '/'
                                                                                                )
                                                                                                .pop()
                                                                                        } catch {
                                                                                            return 'file'
                                                                                        }
                                                                                    })()}
                                                                            </p>
                                                                        </div>
                                                                        <Button
                                                                            type='text'
                                                                            icon={
                                                                                <DownloadOutlined />
                                                                            }
                                                                            href={
                                                                                docItem.url
                                                                            }
                                                                            target='_blank'
                                                                        />
                                                                    </div>
                                                                </Card>
                                                            )
                                                        )}

                                                        {hasGrowth && (
                                                            <Card size='small'>
                                                                <div
                                                                    style={{
                                                                        display: 'flex',
                                                                        justifyContent:
                                                                            'space-between',
                                                                        alignItems: 'center'
                                                                    }}
                                                                >
                                                                    <div>
                                                                        <p
                                                                            style={{
                                                                                fontWeight: 500
                                                                            }}
                                                                        >
                                                                            Growth Plan
                                                                        </p>
                                                                        <p
                                                                            style={{
                                                                                color:
                                                                                    'rgba(0, 0, 0, 0.45)'
                                                                            }}
                                                                        >
                                                                            growth_plan.pdf
                                                                        </p>
                                                                    </div>
                                                                    <Button
                                                                        type='text'
                                                                        icon={
                                                                            <DownloadOutlined />
                                                                        }
                                                                        href={
                                                                            selectedApplication.growthPlanDocUrl!
                                                                        }
                                                                        target='_blank'
                                                                    />
                                                                </div>
                                                            </Card>
                                                        )}
                                                    </div>
                                                )
                                            })()}
                                        </TabPane>
                                    </Tabs>
                                ) : (
                                    <p style={{ color: 'rgba(0, 0, 0, 0.45)' }}>
                                        Select an application to view details
                                    </p>
                                )}
                            </Card>
                        </Col>
                    </Row>
                </>
            )
            }

            <Modal
                title='Application Documents'
                open={isModalVisible}
                onCancel={() => setIsModalVisible(false)}
                footer={null}
                width={800}
            >
                {selectedDocApp?.documents?.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {selectedDocApp.documents.map((docItem: any, idx: number) => (
                            <Card key={idx} size='small'>
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <div>
                                        <p style={{ fontWeight: 500 }}>{docItem.type}</p>
                                        <p style={{ color: 'rgba(0, 0, 0, 0.45)' }}>
                                            {docItem.fileName}
                                        </p>
                                    </div>
                                    <Button
                                        type='text'
                                        icon={<DownloadOutlined />}
                                        href={docItem.url}
                                        target='_blank'
                                    />
                                </div>
                            </Card>
                        ))}
                    </div>
                ) : (
                    <p style={{ color: 'rgba(0, 0, 0, 0.45)' }}>No documents uploaded</p>
                )}
            </Modal>
        </div >
    )
}

export default ApplicationsDashboard

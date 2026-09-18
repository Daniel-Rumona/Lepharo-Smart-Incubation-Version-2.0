import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Checkbox,
    Col,
    Divider,
    Empty,
    Form,
    Grid,
    Input,
    Modal,
    Row,
    Select,
    Space,
    Spin,
    Tag,
    Typography,
    Upload,
    message,
    theme
} from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import {
    BookOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EditOutlined,
    EyeOutlined,
    FileExcelOutlined,
    FilePdfOutlined,
    FilePptOutlined,
    FileTextOutlined,
    FileUnknownOutlined,
    FileWordOutlined,
    FilterOutlined,
    InboxOutlined,
    PlusOutlined,
    ReadOutlined,
    ReloadOutlined,
    SearchOutlined,
    UploadOutlined
} from '@ant-design/icons'
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import {
    deleteObject,
    getBlob,
    ref,
    uploadBytes
} from 'firebase/storage'
import { db, storage } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { Helmet } from 'react-helmet'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import DocumentViewer from '@/components/modals/documents/DocumentViewer'

const { Title, Text, Paragraph } = Typography

type LibraryMaterial = {
    id: string
    title: string
    description?: string
    category: string
    departmentId?: string
    departmentName: string
    fileName: string
    fileType?: string
    fileSize?: number
    fileUrl?: string
    storagePath: string
    downloadable?: boolean
    uploadedBy: string
    uploadedByName: string
    createdAt?: any
    updatedAt?: any
}

const CATEGORIES = ['Guide', 'Template', 'Policy', 'Training', 'Reference', 'Other']
const MAX_FILE_SIZE = 25 * 1024 * 1024
const ACCEPTED_FILES = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.epub'
const INLINE_PREVIEW_EXTENSIONS = new Set(['pdf', 'txt'])

const ACCENT = '#176b87'

const CATEGORY_COLORS: Record<string, string> = {
    Guide: 'blue',
    Template: 'purple',
    Policy: 'volcano',
    Training: 'green',
    Reference: 'gold',
    Other: 'default'
}

type FileMeta = {
    icon: React.ComponentType<{ style?: React.CSSProperties }>
    color: string
    bg: string
    label: string
}

const FILE_META: Record<string, FileMeta> = {
    pdf: { icon: FilePdfOutlined, color: '#d4380d', bg: 'rgba(212,56,13,.1)', label: 'PDF' },
    doc: { icon: FileWordOutlined, color: '#1554ad', bg: 'rgba(21,84,173,.1)', label: 'DOC' },
    docx: { icon: FileWordOutlined, color: '#1554ad', bg: 'rgba(21,84,173,.1)', label: 'DOCX' },
    ppt: { icon: FilePptOutlined, color: '#d46b08', bg: 'rgba(212,107,8,.1)', label: 'PPT' },
    pptx: { icon: FilePptOutlined, color: '#d46b08', bg: 'rgba(212,107,8,.1)', label: 'PPTX' },
    xls: { icon: FileExcelOutlined, color: '#237804', bg: 'rgba(35,120,4,.1)', label: 'XLS' },
    xlsx: { icon: FileExcelOutlined, color: '#237804', bg: 'rgba(35,120,4,.1)', label: 'XLSX' },
    txt: { icon: FileTextOutlined, color: '#595959', bg: 'rgba(89,89,89,.1)', label: 'TXT' },
    epub: { icon: ReadOutlined, color: '#6a1b9a', bg: 'rgba(106,27,154,.1)', label: 'EPUB' }
}

const DEFAULT_FILE_META: FileMeta = {
    icon: FileUnknownOutlined,
    color: '#8c8c8c',
    bg: 'rgba(140,140,140,.1)',
    label: 'FILE'
}

const getExtension = (fileName: string) =>
    fileName.split('.').pop()?.toLowerCase() || ''

const getFileMeta = (fileName: string): FileMeta =>
    FILE_META[getExtension(fileName)] || DEFAULT_FILE_META

const isInlinePreviewable = (fileName: string) =>
    INLINE_PREVIEW_EXTENSIONS.has(getExtension(fileName))

const formatSize = (bytes?: number) => {
    if (!bytes) return 'File'
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const LibraryPage: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { token } = theme.useToken()
    const screens = Grid.useBreakpoint()

    const isMobile = !screens.md
    const useFilterRail = !!screens.lg
    const [materials, setMaterials] = useState<LibraryMaterial[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const [materialModalOpen, setMaterialModalOpen] = useState(false)
    const [editingMaterial, setEditingMaterial] = useState<LibraryMaterial | null>(null)

    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewItem, setPreviewItem] = useState<LibraryMaterial | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewUrl, setPreviewUrl] = useState('')
    const [previewText, setPreviewText] = useState('')

    const [search, setSearch] = useState('')
    const [departmentFilter, setDepartmentFilter] = useState('all')
    const [categoryFilter, setCategoryFilter] = useState('all')
    const [fileList, setFileList] = useState<UploadFile[]>([])

    const [form] = Form.useForm()

    const role = String(user?.role || '').toLowerCase().replace(/\s+/g, '')
    const isOperations = role === 'operations'
    const isSme = role === 'incubatee' || role === 'participant'
    const departmentId = String(user?.departmentId || '')
    const departmentName = String(user?.departmentName || user?.department?.name || '')

    const loadMaterials = async () => {
        if (!user?.id) return

        setLoading(true)
        try {
            const base = collection(db, 'libraryMaterials')
            let snapshot

            if (isOperations && departmentId) {
                snapshot = await getDocs(query(base, where('departmentId', '==', departmentId)))
            } else if (isOperations && departmentName) {
                snapshot = await getDocs(query(base, where('departmentName', '==', departmentName)))
            } else {
                snapshot = await getDocs(base)
            }

            const rows = snapshot.docs.map(item => ({
                id: item.id,
                ...(item.data() as Omit<LibraryMaterial, 'id'>)
            }))

            rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
            setMaterials(rows)
        } catch (error) {
            console.error('Failed to load library materials', error)
            message.error('Could not load the library. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!identityLoading && user?.id) loadMaterials()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identityLoading, user?.id, departmentId, departmentName])

    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
        }
    }, [previewUrl])

    const departments = useMemo(
        () => Array.from(new Set(materials.map(item => item.departmentName).filter(Boolean))).sort(),
        [materials]
    )

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase()

        return materials.filter(item => {
            const searchable = [
                item.title,
                item.description,
                item.category,
                item.departmentName,
                item.fileName
            ]
                .join(' ')
                .toLowerCase()

            return (
                (!needle || searchable.includes(needle)) &&
                (departmentFilter === 'all' || item.departmentName === departmentFilter) &&
                (categoryFilter === 'all' || item.category === categoryFilter)
            )
        })
    }, [materials, search, departmentFilter, categoryFilter])

    const activeFilterCount =
        (search.trim() ? 1 : 0) +
        (departmentFilter !== 'all' ? 1 : 0) +
        (categoryFilter !== 'all' ? 1 : 0)

    const clearFilters = () => {
        setSearch('')
        setDepartmentFilter('all')
        setCategoryFilter('all')
    }

    const hasVisibleMaterials = filtered.length > 0
    const hasPreviewableMaterial = filtered.some(item =>
        isInlinePreviewable(item.fileName)
    )
    const hasDownloadableMaterial =
        isSme && filtered.some(item => item.downloadable !== false)
    const hasManageableMaterial =
        isOperations && filtered.some(item => item.uploadedBy === user?.id)
    const canUploadMaterial = isOperations && Boolean(departmentName)

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'sme-library',
            pageTitle: 'SME Library',
            guides: [
                {
                    id: 'library-overview',
                    title: 'Quick tour',
                    description: isOperations
                        ? 'Learn how to find, upload and manage reading material for your department.'
                        : 'Learn how to find, open and download reading material available to SMEs.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('library-filters'),
                            popover: {
                                title: 'Find material',
                                description: isOperations
                                    ? 'Search your department library and filter by category.'
                                    : 'Search the library and filter by department or category.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        ...(canUploadMaterial
                            ? [{
                                element: guideTarget('library-upload-action'),
                                popover: {
                                    title: 'Upload material',
                                    description: 'Operations can add reading material for their assigned department.',
                                    side: 'bottom' as const,
                                    align: 'end' as const
                                }
                            }]
                            : []),
                        {
                            element: guideTarget('library-materials'),
                            waitForElement: 1500,
                            popover: {
                                title: 'Library materials',
                                description: 'Each card shows the material title, department, category, file format and whether SMEs may download it.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                ...(hasVisibleMaterials
                    ? [{
                        id: 'library-open-material',
                        title: 'Open library material',
                        description: 'Open reading material and understand how view-only files behave.',
                        kind: 'task' as const,
                        order: 2,
                        steps: hasPreviewableMaterial
                            ? [
                                {
                                    element: '[data-guide="library-preview-action"]',
                                    waitForElement: 1500,
                                    advanceOnClick: true,
                                    popover: {
                                        title: 'View material',
                                        description: 'PDF and TXT material opens inside Smart Incubation. View-only material stays in-system rather than being downloaded.',
                                        side: 'top' as const,
                                        align: 'center' as const,
                                        showButtons: ['close']
                                    }
                                },
                                {
                                    element: '.guide-library-preview-modal',
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'In-system preview',
                                        description: 'Review the material here without leaving the library. PDF files use the embedded viewer and TXT files are shown directly.',
                                        side: 'left' as const,
                                        align: 'start' as const
                                    }
                                }
                            ]
                            : [{
                                element: '[data-guide="library-view-action"]',
                                waitForElement: 1500,
                                popover: {
                                    title: 'Open material',
                                    description: 'Use View to open the material. File formats that cannot be previewed in-system are downloaded when downloads are allowed.',
                                    side: 'top' as const,
                                    align: 'center' as const
                                }
                            }]
                    }]
                    : []),
                ...(hasDownloadableMaterial
                    ? [{
                        id: 'library-download-material',
                        title: 'Download material',
                        description: 'Download material that the uploader has made available for SME download.',
                        kind: 'task' as const,
                        order: 3,
                        steps: [{
                            element: '[data-guide="library-download-action"]',
                            waitForElement: 1500,
                            popover: {
                                title: 'Download',
                                description: 'This action only appears when the material is marked as downloadable. View-only material does not expose a Download button to SMEs.',
                                side: 'top' as const,
                                align: 'center' as const
                            }
                        }]
                    }]
                    : []),
                ...(canUploadMaterial
                    ? [{
                        id: 'library-upload-material',
                        title: 'Upload material',
                        description: 'Add department reading material and control whether SMEs may download it.',
                        kind: 'task' as const,
                        order: 4,
                        steps: [
                            {
                                element: guideTarget('library-upload-action'),
                                advanceOnClick: true,
                                popover: {
                                    title: 'Upload material',
                                    description: 'Start a new library upload for your department.',
                                    side: 'bottom' as const,
                                    align: 'end' as const,
                                    showButtons: ['close']
                                }
                            },
                            {
                                element: '.guide-library-material-modal',
                                waitForElement: 5000,
                                popover: {
                                    title: 'Material details',
                                    description: 'Add a clear title, category and description so SMEs can understand what the material is for.',
                                    side: 'left' as const,
                                    align: 'start' as const
                                }
                            },
                            {
                                element: guideTarget('library-material-details'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Title and category',
                                    description: 'Give the material a descriptive title and choose the most appropriate category.',
                                    side: 'top' as const,
                                    align: 'start' as const
                                }
                            },
                            {
                                element: guideTarget('library-material-description'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Description',
                                    description: 'Briefly explain what SMEs will learn or what the material should be used for.',
                                    side: 'top' as const,
                                    align: 'start' as const
                                }
                            },
                            {
                                element: guideTarget('library-download-setting'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Allow download',
                                    description: 'Leave this off for view-only material. View-only files must be PDF or TXT because those formats can be opened inside the system.',
                                    side: 'top' as const,
                                    align: 'start' as const
                                }
                            },
                            {
                                element: guideTarget('library-file-upload'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Choose the file',
                                    description: 'Upload a supported file up to 25 MB. If downloads are disabled, choose a PDF or TXT file.',
                                    side: 'top' as const,
                                    align: 'start' as const
                                }
                            },
                            {
                                element: '.guide-library-save-material',
                                waitForElement: 1500,
                                popover: {
                                    title: 'Add to library',
                                    description: 'Save the material when its details, access setting and file are ready.',
                                    side: 'top' as const,
                                    align: 'center' as const
                                }
                            }
                        ]
                    }]
                    : []),
                ...(hasManageableMaterial
                    ? [{
                        id: 'library-manage-material',
                        title: 'Manage uploaded material',
                        description: 'Edit material that you uploaded and control SME download access.',
                        kind: 'task' as const,
                        order: 5,
                        steps: [
                            {
                                element: '[data-guide="library-edit-action"]',
                                waitForElement: 1500,
                                advanceOnClick: true,
                                popover: {
                                    title: 'Edit material',
                                    description: 'You can edit material that you uploaded, including its title, category, description and SME download setting.',
                                    side: 'top' as const,
                                    align: 'center' as const,
                                    showButtons: ['close']
                                }
                            },
                            {
                                element: '.guide-library-material-modal',
                                waitForElement: 5000,
                                popover: {
                                    title: 'Edit library material',
                                    description: 'Update the material details or change whether SMEs may download it.',
                                    side: 'left' as const,
                                    align: 'start' as const
                                }
                            },
                            {
                                element: guideTarget('library-edit-download-setting'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'SME downloads',
                                    description: 'Change whether SMEs are allowed to download this existing material.',
                                    side: 'top' as const,
                                    align: 'start' as const
                                }
                            },
                            {
                                element: '.guide-library-save-material',
                                waitForElement: 1500,
                                popover: {
                                    title: 'Save changes',
                                    description: 'Save the updated material details when you are finished.',
                                    side: 'top' as const,
                                    align: 'center' as const
                                }
                            }
                        ]
                    }]
                    : [])
            ]
        }),
        [
            canUploadMaterial,
            hasDownloadableMaterial,
            hasManageableMaterial,
            hasPreviewableMaterial,
            hasVisibleMaterials,
            isOperations,
            isSme
        ]
    )

    usePageGuides(guideRegistration)

    const closeMaterialModal = () => {
        if (saving) return

        setMaterialModalOpen(false)
        setEditingMaterial(null)
        setFileList([])
        form.resetFields()
    }

    const openUploadModal = () => {
        setEditingMaterial(null)
        setFileList([])
        form.resetFields()
        form.setFieldsValue({
            category: 'Guide',
            downloadable: false
        })
        setMaterialModalOpen(true)
    }

    const openEditModal = (item: LibraryMaterial) => {
        setEditingMaterial(item)
        setFileList([])
        form.resetFields()
        form.setFieldsValue({
            title: item.title,
            category: item.category,
            description: item.description || '',
            downloadable: item.downloadable !== false
        })
        setMaterialModalOpen(true)
    }

    const submitMaterial = async (values: any) => {
        if (!user?.id || !departmentName) {
            message.error('Your account needs a department before you can manage library material.')
            return
        }

        if (editingMaterial) {
            setSaving(true)
            try {
                await updateDoc(doc(db, 'libraryMaterials', editingMaterial.id), {
                    title: values.title.trim(),
                    description: values.description?.trim() || '',
                    category: values.category,
                    downloadable: Boolean(values.downloadable),
                    updatedAt: serverTimestamp()
                })

                setMaterials(current =>
                    current.map(item =>
                        item.id === editingMaterial.id
                            ? {
                                ...item,
                                title: values.title.trim(),
                                description: values.description?.trim() || '',
                                category: values.category,
                                downloadable: Boolean(values.downloadable)
                            }
                            : item
                    )
                )

                message.success('Library material updated')
                closeMaterialModal()
            } catch (error) {
                console.error('Library material update failed', error)
                message.error('Could not update the material. Please try again.')
            } finally {
                setSaving(false)
            }
            return
        }

        const selectedFile = fileList[0]
        const file = (selectedFile?.originFileObj || selectedFile) as File | undefined

        if (!file) {
            message.error('Choose a file to upload.')
            return
        }

        const downloadable = Boolean(values.downloadable)

        if (!downloadable && !isInlinePreviewable(file.name)) {
            message.error('Non-downloadable material must be PDF or TXT so it can be viewed inside the system.')
            return
        }

        setSaving(true)
        let storagePath = ''

        try {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
            storagePath = `library/${user.id}/${Date.now()}-${safeName}`

            await uploadBytes(ref(storage, storagePath), file, {
                contentType: file.type || 'application/octet-stream'
            })

            await addDoc(collection(db, 'libraryMaterials'), {
                title: values.title.trim(),
                description: values.description?.trim() || '',
                category: values.category,
                departmentId: departmentId || null,
                departmentName,
                fileName: file.name,
                fileType: file.type || '',
                fileSize: file.size,
                storagePath,
                downloadable,
                uploadedBy: user.id,
                uploadedByName: user.name || user.email || 'Operations',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            })

            message.success('Reading material added to the library')
            closeMaterialModal()
            await loadMaterials()
        } catch (error) {
            console.error('Library upload failed', error)

            if (storagePath) {
                await deleteObject(ref(storage, storagePath)).catch(() => undefined)
            }

            message.error('The upload failed. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    const closePreview = () => {
        setPreviewOpen(false)
        setPreviewItem(null)
        setPreviewText('')

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl)
            setPreviewUrl('')
        }
    }

    const viewMaterial = async (item: LibraryMaterial) => {
        if (!item.storagePath) {
            message.error('This material does not have a valid storage path.')
            return
        }

        if (!isInlinePreviewable(item.fileName)) {
            if (item.downloadable !== false) {
                await downloadMaterial(item)
            } else {
                message.warning('This file type cannot be previewed in-system. Upload it as PDF or TXT if downloads must remain disabled.')
            }
            return
        }

        setPreviewItem(item)
        setPreviewOpen(true)
        setPreviewLoading(true)
        setPreviewText('')

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl)
            setPreviewUrl('')
        }

        try {
            const blob = await getBlob(ref(storage, item.storagePath))
            const ext = getExtension(item.fileName)

            if (ext === 'txt') {
                setPreviewText(await blob.text())
            } else {
                setPreviewUrl(URL.createObjectURL(blob))
            }
        } catch (error) {
            console.error('Failed to preview library material', error)
            message.error('Could not open this material.')
            closePreview()
        } finally {
            setPreviewLoading(false)
        }
    }

    const downloadMaterial = async (item: LibraryMaterial) => {
        if (item.downloadable === false && isSme) {
            message.warning('Downloads are disabled for this material.')
            return
        }

        try {
            const blob = await getBlob(ref(storage, item.storagePath))
            const objectUrl = URL.createObjectURL(blob)
            const anchor = document.createElement('a')

            anchor.href = objectUrl
            anchor.download = item.fileName
            document.body.appendChild(anchor)
            anchor.click()
            anchor.remove()

            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
        } catch (error) {
            console.error('Failed to download library material', error)
            message.error('Could not download this material.')
        }
    }

    const removeMaterial = (item: LibraryMaterial) => {
        Modal.confirm({
            title: 'Remove this material?',
            content: `${item.title} will no longer be available to SMEs.`,
            okText: 'Remove',
            centered: true,
            okButtonProps: { danger: true },
            onOk: async () => {
                await deleteDoc(doc(db, 'libraryMaterials', item.id))

                if (item.storagePath) {
                    await deleteObject(ref(storage, item.storagePath)).catch(() => undefined)
                }

                setMaterials(current => current.filter(row => row.id !== item.id))
                message.success('Material removed')
            }
        })
    }

    if (identityLoading) {
        return (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 360 }}>
                <Spin size='large' />
            </div>
        )
    }

    if (!isOperations && !isSme) {
        return (
            <Alert
                type='warning'
                showIcon
                message='Library access is available to operations teams and SMEs.'
            />
        )
    }

    return (
        <div
            style={{
                padding: isMobile ? '14px 12px 22px' : '22px 24px 28px',
                minHeight: '100vh',
                background: token.colorBgLayout
            }}
        >
            <Helmet>
                <title>SME Library | Smart Incubation</title>
            </Helmet>

            <div
                style={{
                    width: '100%',
                    maxWidth: 1500,
                    margin: '0 auto'
                }}
            >
                {isOperations && !departmentName && (
                    <Alert
                        style={{
                            marginBottom: 16,
                            borderRadius: 14
                        }}
                        type='warning'
                        showIcon
                        message='Department assignment required'
                        description='Ask an administrator to assign your account to a department before uploading.'
                    />
                )}

                <div
                    style={{
                        display: 'flex',
                        alignItems: isMobile ? 'flex-start' : 'center',
                        justifyContent: 'space-between',
                        gap: 14,
                        marginBottom: isMobile ? 14 : 18,
                        flexDirection: isMobile ? 'column' : 'row'
                    }}
                >
                    {isOperations && !useFilterRail ? (
                        <Button
                            data-guide='library-upload-action'
                            type='primary'
                            size='large'
                            shape='round'
                            icon={<PlusOutlined />}
                            onClick={openUploadModal}
                            disabled={!departmentName}
                            style={{
                                width: isMobile ? '100%' : undefined,
                                background: ACCENT,
                                borderColor: ACCENT
                            }}
                        >
                            Upload material
                        </Button>
                    ) : null}
                </div>

                {!useFilterRail ? (
                    <MotionCard
                        style={{
                            marginBottom: 14,
                            borderRadius: 18
                        }}
                        bodyStyle={{
                            padding: isMobile ? 12 : 14
                        }}
                    >
                        <div
                            data-guide='library-filters'
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 10
                            }}
                        >
                            <Input
                                size='large'
                                allowClear
                                prefix={
                                    <SearchOutlined
                                        style={{
                                            color: ACCENT
                                        }}
                                    />
                                }
                                placeholder='Search library'
                                value={search}
                                onChange={event =>
                                    setSearch(event.target.value)
                                }
                            />

                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: isSme
                                        ? 'repeat(2, minmax(0, 1fr))'
                                        : 'minmax(0, 1fr)',
                                    gap: 8
                                }}
                            >
                                {isSme ? (
                                    <Select
                                        size='large'
                                        style={{
                                            width: '100%'
                                        }}
                                        value={departmentFilter}
                                        onChange={setDepartmentFilter}
                                        options={[
                                            {
                                                value: 'all',
                                                label: 'All departments'
                                            },
                                            ...departments.map(value => ({
                                                value,
                                                label: value
                                            }))
                                        ]}
                                    />
                                ) : null}

                                <Select
                                    size='large'
                                    style={{
                                        width: '100%'
                                    }}
                                    value={categoryFilter}
                                    onChange={setCategoryFilter}
                                    options={[
                                        {
                                            value: 'all',
                                            label: 'All categories'
                                        },
                                        ...CATEGORIES.map(value => ({
                                            value,
                                            label: value
                                        }))
                                    ]}
                                />
                            </div>

                            {activeFilterCount > 0 ? (
                                <Button
                                    type='text'
                                    shape='round'
                                    icon={<ReloadOutlined />}
                                    onClick={clearFilters}
                                    style={{
                                        alignSelf: 'flex-start',
                                        paddingInline: 6
                                    }}
                                >
                                    Clear filters
                                </Button>
                            ) : null}
                        </div>
                    </MotionCard>
                ) : null}

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: useFilterRail
                            ? '250px minmax(0, 1fr)'
                            : 'minmax(0, 1fr)',
                        gap: 18,
                        alignItems: 'start'
                    }}
                >
                    {useFilterRail ? (
                        <div
                            data-guide='library-filters'
                            style={{
                                position: 'sticky',
                                top: 18,
                                alignSelf: 'start'
                            }}
                        >
                            <MotionCard
                                size='small'
                                style={{
                                    borderRadius: 18
                                }}
                                bodyStyle={{
                                    padding: 14
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 10,
                                        marginBottom: 14
                                    }}
                                >
                                    <Space size={7}>
                                        <FilterOutlined
                                            style={{
                                                color: ACCENT
                                            }}
                                        />
                                        <Text strong>
                                            Filter library
                                        </Text>
                                    </Space>

                                    {activeFilterCount > 0 ? (
                                        <Tag
                                            color='blue'
                                            style={{
                                                margin: 0,
                                                borderRadius: 999
                                            }}
                                        >
                                            {activeFilterCount}
                                        </Tag>
                                    ) : null}
                                </div>

                                <Space
                                    direction='vertical'
                                    size={12}
                                    style={{
                                        width: '100%'
                                    }}
                                >
                                    <div>
                                        <Text
                                            type='secondary'
                                            style={{
                                                display: 'block',
                                                fontSize: 11,
                                                marginBottom: 5
                                            }}
                                        >
                                            Search
                                        </Text>

                                        <Input
                                            allowClear
                                            prefix={
                                                <SearchOutlined
                                                    style={{
                                                        color: ACCENT
                                                    }}
                                                />
                                            }
                                            placeholder='Title, file or topic'
                                            value={search}
                                            onChange={event =>
                                                setSearch(event.target.value)
                                            }
                                        />
                                    </div>

                                    {isSme ? (
                                        <div>
                                            <Text
                                                type='secondary'
                                                style={{
                                                    display: 'block',
                                                    fontSize: 11,
                                                    marginBottom: 5
                                                }}
                                            >
                                                Department
                                            </Text>

                                            <Select
                                                style={{
                                                    width: '100%'
                                                }}
                                                value={departmentFilter}
                                                onChange={setDepartmentFilter}
                                                options={[
                                                    {
                                                        value: 'all',
                                                        label: 'All departments'
                                                    },
                                                    ...departments.map(value => ({
                                                        value,
                                                        label: value
                                                    }))
                                                ]}
                                            />
                                        </div>
                                    ) : null}

                                    <div>
                                        <Text
                                            type='secondary'
                                            style={{
                                                display: 'block',
                                                fontSize: 11,
                                                marginBottom: 5
                                            }}
                                        >
                                            Category
                                        </Text>

                                        <Select
                                            style={{
                                                width: '100%'
                                            }}
                                            value={categoryFilter}
                                            onChange={setCategoryFilter}
                                            options={[
                                                {
                                                    value: 'all',
                                                    label: 'All categories'
                                                },
                                                ...CATEGORIES.map(value => ({
                                                    value,
                                                    label: value
                                                }))
                                            ]}
                                        />
                                    </div>

                                    {activeFilterCount > 0 ? (
                                        <Button
                                            block
                                            shape='round'
                                            icon={<ReloadOutlined />}
                                            onClick={clearFilters}
                                        >
                                            Clear filters
                                        </Button>
                                    ) : null}

                                    {isOperations ? (
                                        <>
                                            <Divider
                                                style={{
                                                    margin: '2px 0'
                                                }}
                                            />

                                            <Button
                                                data-guide='library-upload-action'
                                                type='primary'
                                                block
                                                shape='round'
                                                icon={<PlusOutlined />}
                                                onClick={openUploadModal}
                                                disabled={!departmentName}
                                                style={{
                                                    background: ACCENT,
                                                    borderColor: ACCENT
                                                }}
                                            >
                                                Upload material
                                            </Button>
                                        </>
                                    ) : null}
                                </Space>
                            </MotionCard>
                        </div>
                    ) : null}

                    <div
                        data-guide='library-materials'
                        style={{
                            minWidth: 0
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                marginBottom: 12
                            }}
                        >
                            <div>
                                <Text
                                    strong
                                    style={{
                                        fontSize: isMobile ? 14 : 15
                                    }}
                                >
                                    {filtered.length}{' '}
                                    {filtered.length === 1
                                        ? 'material'
                                        : 'materials'}
                                </Text>

                                {activeFilterCount > 0 ? (
                                    <Text
                                        type='secondary'
                                        style={{
                                            marginLeft: 6,
                                            fontSize: 12
                                        }}
                                    >
                                        matching your filters
                                    </Text>
                                ) : null}
                            </div>

                            {!isMobile && categoryFilter !== 'all' ? (
                                <Tag
                                    color={CATEGORY_COLORS[categoryFilter] || 'default'}
                                    style={{
                                        margin: 0,
                                        borderRadius: 999
                                    }}
                                >
                                    {categoryFilter}
                                </Tag>
                            ) : null}
                        </div>

                        <Spin spinning={loading}>
                            {filtered.length === 0 ? (
                                <MotionCard
                                    size='small'
                                    style={{
                                        borderRadius: 18
                                    }}
                                    bodyStyle={{
                                        padding: isMobile ? '34px 16px' : 42
                                    }}
                                >
                                    <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description={
                                            materials.length
                                                ? 'No materials match your filters.'
                                                : 'No reading material has been uploaded yet.'
                                        }
                                    />

                                    {materials.length > 0 &&
                                        activeFilterCount > 0 ? (
                                        <div
                                            style={{
                                                textAlign: 'center',
                                                marginTop: 10
                                            }}
                                        >
                                            <Button
                                                shape='round'
                                                onClick={clearFilters}
                                            >
                                                Reset filters
                                            </Button>
                                        </div>
                                    ) : null}
                                </MotionCard>
                            ) : (
                                <Row
                                    gutter={[
                                        isMobile ? 10 : 16,
                                        isMobile ? 10 : 16
                                    ]}
                                >
                                    {filtered.map(item => {
                                        const meta =
                                            getFileMeta(item.fileName)
                                        const FileIcon = meta.icon
                                        const canManage =
                                            isOperations &&
                                            item.uploadedBy === user?.id
                                        const downloadable =
                                            item.downloadable !== false
                                        const previewable =
                                            isInlinePreviewable(item.fileName)

                                        return (
                                            <Col
                                                xs={24}
                                                md={12}
                                                lg={12}
                                                xl={8}
                                                key={item.id}
                                            >
                                                <Card
                                                    variant='borderless'
                                                    hoverable={!isMobile}
                                                    className='library-resource-card'
                                                    style={{
                                                        height: '100%',
                                                        overflow: 'hidden',
                                                        borderRadius: isMobile
                                                            ? 18
                                                            : 20,
                                                        border: `1px solid ${token.colorBorderSecondary}`,
                                                        background: token.colorBgContainer,
                                                        boxShadow: isMobile
                                                            ? '0 4px 14px rgba(15,23,42,.055)'
                                                            : '0 10px 30px rgba(15,23,42,.065)'
                                                    }}
                                                    styles={{
                                                        body: {
                                                            padding: 0,
                                                            height: '100%',
                                                            display: 'flex',
                                                            flexDirection: 'column'
                                                        }
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            padding: isMobile
                                                                ? '14px 14px 10px'
                                                                : '17px 17px 12px',
                                                            display: 'flex',
                                                            alignItems: 'flex-start',
                                                            gap: isMobile ? 11 : 13
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                width: isMobile ? 44 : 50,
                                                                height: isMobile ? 44 : 50,
                                                                borderRadius: isMobile ? 13 : 15,
                                                                background: meta.bg,
                                                                display: 'grid',
                                                                placeItems: 'center',
                                                                flex: '0 0 auto',
                                                                border: `1px solid ${meta.color}24`
                                                            }}
                                                        >
                                                            <FileIcon
                                                                style={{
                                                                    fontSize: isMobile ? 19 : 23,
                                                                    color: meta.color
                                                                }}
                                                            />
                                                        </div>

                                                        <div
                                                            style={{
                                                                minWidth: 0,
                                                                flex: 1
                                                            }}
                                                        >
                                                            <Title
                                                                level={5}
                                                                ellipsis={{
                                                                    rows: 2,
                                                                    tooltip: item.title
                                                                }}
                                                                style={{
                                                                    margin: 0,
                                                                    fontSize: isMobile ? 15 : 16,
                                                                    lineHeight: 1.35
                                                                }}
                                                            >
                                                                {item.title}
                                                            </Title>

                                                            <Space
                                                                size={[5, 5]}
                                                                wrap
                                                                style={{
                                                                    marginTop: 7
                                                                }}
                                                            >
                                                                <Tag
                                                                    bordered={false}
                                                                    style={{
                                                                        margin: 0,
                                                                        borderRadius: 999,
                                                                        background: meta.bg,
                                                                        color: meta.color,
                                                                        fontWeight: 600
                                                                    }}
                                                                >
                                                                    {meta.label}
                                                                </Tag>

                                                                <Tag
                                                                    color={
                                                                        CATEGORY_COLORS[
                                                                        item.category
                                                                        ] || 'default'
                                                                    }
                                                                    style={{
                                                                        margin: 0,
                                                                        borderRadius: 999
                                                                    }}
                                                                >
                                                                    {item.category}
                                                                </Tag>

                                                                <Tag
                                                                    bordered={false}
                                                                    style={{
                                                                        margin: 0,
                                                                        borderRadius: 999,
                                                                        background: downloadable
                                                                            ? token.colorSuccessBg
                                                                            : token.colorFillAlter,
                                                                        color: downloadable
                                                                            ? token.colorSuccess
                                                                            : token.colorTextSecondary
                                                                    }}
                                                                >
                                                                    {downloadable
                                                                        ? 'Download'
                                                                        : 'View only'}
                                                                </Tag>
                                                            </Space>
                                                        </div>
                                                    </div>

                                                    <div
                                                        style={{
                                                            padding: isMobile
                                                                ? '0 14px 12px'
                                                                : '0 17px 14px',
                                                            flex: 1
                                                        }}
                                                    >
                                                        <Paragraph
                                                            type='secondary'
                                                            ellipsis={{
                                                                rows: isMobile ? 2 : 3,
                                                                tooltip:
                                                                    item.description ||
                                                                    undefined
                                                            }}
                                                            style={{
                                                                margin: 0,
                                                                minHeight: isMobile
                                                                    ? 38
                                                                    : 58,
                                                                fontSize: 12.5,
                                                                lineHeight: 1.55
                                                            }}
                                                        >
                                                            {item.description ||
                                                                'No description provided.'}
                                                        </Paragraph>

                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                gap: 10,
                                                                marginTop: 11,
                                                                paddingTop: 10,
                                                                borderTop: `1px solid ${token.colorBorderSecondary}`
                                                            }}
                                                        >
                                                            <Text
                                                                type='secondary'
                                                                ellipsis
                                                                style={{
                                                                    minWidth: 0,
                                                                    fontSize: 11
                                                                }}
                                                            >
                                                                {isSme
                                                                    ? item.departmentName
                                                                    : item.fileName}
                                                            </Text>

                                                            <Text
                                                                type='secondary'
                                                                style={{
                                                                    flex: '0 0 auto',
                                                                    fontSize: 11
                                                                }}
                                                            >
                                                                {formatSize(item.fileSize)}
                                                            </Text>
                                                        </div>
                                                    </div>

                                                    <div
                                                        className='library-resource-actions'
                                                        style={{
                                                            padding: isMobile
                                                                ? '10px 12px 12px'
                                                                : '10px 14px 14px',
                                                            borderTop: `1px solid ${token.colorBorderSecondary}`,
                                                            background: token.colorFillAlter
                                                        }}
                                                    >
                                                        <Button
                                                            data-guide={
                                                                previewable
                                                                    ? 'library-preview-action'
                                                                    : 'library-view-action'
                                                            }
                                                            type='primary'
                                                            block
                                                            shape='round'
                                                            icon={<EyeOutlined />}
                                                            onClick={() =>
                                                                viewMaterial(item)
                                                            }
                                                            style={{
                                                                background: ACCENT,
                                                                borderColor: ACCENT
                                                            }}
                                                        >
                                                            {previewable
                                                                ? 'Open'
                                                                : downloadable
                                                                    ? 'Open file'
                                                                    : 'View'}
                                                        </Button>

                                                        {isSme && downloadable ? (
                                                            <Button
                                                                data-guide='library-download-action'
                                                                block
                                                                shape='round'
                                                                icon={<DownloadOutlined />}
                                                                onClick={() =>
                                                                    downloadMaterial(item)
                                                                }
                                                            >
                                                                Download
                                                            </Button>
                                                        ) : null}

                                                        {canManage ? (
                                                            <>
                                                                <Button
                                                                    data-guide='library-edit-action'
                                                                    block
                                                                    shape='round'
                                                                    icon={<EditOutlined />}
                                                                    onClick={() =>
                                                                        openEditModal(item)
                                                                    }
                                                                >
                                                                    Edit
                                                                </Button>

                                                                <Button
                                                                    data-guide='library-remove-action'
                                                                    block
                                                                    shape='round'
                                                                    danger
                                                                    icon={<DeleteOutlined />}
                                                                    onClick={() =>
                                                                        removeMaterial(item)
                                                                    }
                                                                >
                                                                    Remove
                                                                </Button>
                                                            </>
                                                        ) : null}
                                                    </div>
                                                </Card>
                                            </Col>
                                        )
                                    })}
                                </Row>
                            )}
                        </Spin>
                    </div>
                </div>
            </div>

            <style>{`
                .library-resource-card {
                    transition:
                        transform .18s ease,
                        box-shadow .18s ease,
                        border-color .18s ease;
                }

                @media (hover: hover) and (pointer: fine) {
                    .library-resource-card:hover {
                        transform: translateY(-3px);
                        border-color: rgba(23,107,135,.30) !important;
                        box-shadow: 0 16px 38px rgba(15,23,42,.11) !important;
                    }
                }

                .library-resource-actions {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 8px;
                }

                .library-resource-actions > .ant-btn:only-child {
                    grid-column: 1 / -1;
                }

                @media (max-width: 575px) {
                    .library-resource-actions {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }

                    .library-resource-actions .ant-btn {
                        min-width: 0;
                    }
                }
            `}</style>

            <Modal
                className='guide-library-material-modal'
                open={materialModalOpen}
                onCancel={closeMaterialModal}
                onOk={() => form.submit()}
                okText={editingMaterial ? 'Save changes' : 'Add to library'}
                cancelText='Cancel'
                confirmLoading={saving}
                okButtonProps={{
                    disabled: !departmentName,
                    className: 'guide-library-save-material',
                    style: { background: ACCENT, borderColor: ACCENT },
                    icon: editingMaterial ? <EditOutlined /> : <UploadOutlined />
                }}
                cancelButtonProps={{ disabled: saving }}
                destroyOnHidden
                centered
                maskClosable={false}
                width={560}
                styles={{
                    body: {
                        paddingTop: 4
                    },
                    footer: {
                        marginTop: 10
                    }
                }}
                title={
                    <Space align='center' size={10}>
                        <div
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 9,
                                background: 'rgba(23,107,135,.1)',
                                display: 'grid',
                                placeItems: 'center'
                            }}
                        >
                            {editingMaterial ? (
                                <EditOutlined style={{ color: ACCENT, fontSize: 16 }} />
                            ) : (
                                <BookOutlined style={{ color: ACCENT, fontSize: 16 }} />
                            )}
                        </div>
                        <span>{editingMaterial ? 'Edit library material' : 'Add to the library'}</span>
                    </Space>
                }
            >
                <Text
                    type='secondary'
                    style={{
                        display: 'block',
                        marginTop: -6,
                        marginBottom: 12,
                        fontSize: 13
                    }}
                >
                    {editingMaterial
                        ? 'Update the material details and SME access.'
                        : `Share reading material with SMEs in ${departmentName || 'your department'}.`}
                </Text>

                <Form
                    form={form}
                    layout='vertical'
                    onFinish={submitMaterial}
                    preserve={false}
                    initialValues={{ category: 'Guide', downloadable: false }}
                    style={{ marginTop: -2 }}
                >
                    <Row
                        data-guide='library-material-details'
                        gutter={12}
                    >
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='title'
                                label='Title'
                                rules={[
                                    { required: true, message: 'Enter a title' },
                                    { max: 120 }
                                ]}
                                style={{ marginBottom: 12 }}
                            >
                                <Input placeholder='e.g. Cash flow planning guide' />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name='category'
                                label='Category'
                                rules={[{ required: true }]}
                                style={{ marginBottom: 12 }}
                            >
                                <Select
                                    options={CATEGORIES.map(value => ({ value, label: value }))}
                                    optionRender={option => (
                                        <Tag
                                            color={CATEGORY_COLORS[option.value as string] || 'default'}
                                            style={{ borderRadius: 999 }}
                                        >
                                            {option.label}
                                        </Tag>
                                    )}
                                    labelRender={label => (
                                        <Tag
                                            color={CATEGORY_COLORS[label.value as string] || 'default'}
                                            style={{ borderRadius: 999 }}
                                        >
                                            {label.label}
                                        </Tag>
                                    )}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item
                        data-guide='library-material-description'
                        name='description'
                        label='Description'
                        rules={[{ max: 600 }]}
                        style={{ marginBottom: 12 }}
                    >
                        <Input.TextArea
                            rows={2}
                            placeholder='What will SMEs learn from this material?'
                            maxLength={600}
                        />
                    </Form.Item>

                    {editingMaterial ? (
                        <div
                            data-guide='library-edit-download-setting'
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                padding: '9px 11px',
                                border: '1px solid #edf0f3',
                                borderRadius: 9,
                                background: '#fafcfd'
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <Text style={{ display: 'block', fontWeight: 500, fontSize: 13 }}>
                                    SME downloads
                                </Text>
                                <Text type='secondary' style={{ fontSize: 11 }}>
                                    Disable this to keep supported files view-only.
                                </Text>
                            </div>

                            <Form.Item
                                name='downloadable'
                                valuePropName='checked'
                                noStyle
                            >
                                <Checkbox>Allow download</Checkbox>
                            </Form.Item>
                        </div>
                    ) : (
                        <>
                            <div data-guide='library-download-setting'>
                                <Alert
                                    type='info'
                                    showIcon
                                    message='View-only files must be PDF or TXT.'
                                    style={{
                                        marginBottom: 10,
                                        padding: '7px 10px',
                                        borderRadius: 8,
                                        fontSize: 12
                                    }}
                                />

                                <Form.Item
                                    data-guide='library-file-upload'
                                    label={
                                        <div
                                            style={{
                                                width: '100%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: 12
                                            }}
                                        >
                                            <span>File</span>

                                            <Form.Item
                                                name='downloadable'
                                                valuePropName='checked'
                                                noStyle
                                            >
                                                <Checkbox style={{ fontWeight: 400 }}>
                                                    Allow download
                                                </Checkbox>
                                            </Form.Item>
                                        </div>
                                    }
                                    required
                                    style={{ marginBottom: 0 }}
                                    extra={
                                        <Text type='secondary' style={{ fontSize: 11 }}>
                                            Max 25 MB. View-only files must be PDF or TXT.
                                        </Text>
                                    }
                                >
                                    {fileList[0] ? (
                                        (() => {
                                            const current = fileList[0]
                                            const meta = getFileMeta(current.name)
                                            const FileIcon = meta.icon

                                            return (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 10,
                                                        padding: '9px 11px',
                                                        borderRadius: 9,
                                                        border: `1px solid ${meta.color}33`,
                                                        background: meta.bg,
                                                        minWidth: 0
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: 34,
                                                            height: 34,
                                                            borderRadius: 8,
                                                            background: '#fff',
                                                            display: 'grid',
                                                            placeItems: 'center',
                                                            flex: '0 0 auto'
                                                        }}
                                                    >
                                                        <FileIcon style={{ fontSize: 17, color: meta.color }} />
                                                    </div>

                                                    <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                                                        <Text ellipsis style={{ display: 'block', fontWeight: 500 }}>
                                                            {current.name}
                                                        </Text>
                                                        <Text type='secondary' style={{ fontSize: 11 }}>
                                                            {formatSize(current.size)}
                                                        </Text>
                                                    </div>

                                                    <Button
                                                        type='text'
                                                        size='small'
                                                        icon={<DeleteOutlined />}
                                                        onClick={() => setFileList([])}
                                                        disabled={saving}
                                                    />
                                                </div>
                                            )
                                        })()
                                    ) : (
                                        <Upload.Dragger
                                            accept={ACCEPTED_FILES}
                                            maxCount={1}
                                            showUploadList={false}
                                            fileList={fileList}
                                            style={{
                                                background: '#fafcfd',
                                                borderColor: '#d6e8ee',
                                                borderRadius: 9,
                                                padding: '2px 0'
                                            }}
                                            beforeUpload={file => {
                                                if (file.size > MAX_FILE_SIZE) {
                                                    message.error('The file must be 25 MB or smaller.')
                                                    return Upload.LIST_IGNORE
                                                }

                                                setFileList([file])
                                                return false
                                            }}
                                        >
                                            <Space size={10} align='center'>
                                                <InboxOutlined style={{ fontSize: 22, color: ACCENT }} />

                                                <div style={{ textAlign: 'left' }}>
                                                    <Text style={{ display: 'block', fontSize: 13 }}>
                                                        Click or drag a file here
                                                    </Text>
                                                    <Text type='secondary' style={{ fontSize: 11 }}>
                                                        PDF, Office, TXT or EPUB
                                                    </Text>
                                                </div>
                                            </Space>
                                        </Upload.Dragger>
                                    )}
                                </Form.Item>
                            </div>
                        </>
                    )}
                </Form>
            </Modal>

            <Modal
                className='guide-library-preview-modal'
                open={previewOpen}
                onCancel={closePreview}
                footer={null}
                destroyOnHidden
                centered
                width='min(1180px, 96vw)'
                styles={{
                    body: {
                        paddingTop: 8
                    }
                }}
                title={previewItem?.title || 'Library material'}
            >
                <Spin spinning={previewLoading}>
                    {previewItem && (
                        <div style={{ minHeight: 320 }}>
                            <Space size={[8, 8]} wrap style={{ marginBottom: 14 }}>
                                <Tag color='blue' style={{ borderRadius: 999 }}>
                                    {previewItem.departmentName}
                                </Tag>
                                <Tag
                                    color={CATEGORY_COLORS[previewItem.category] || 'default'}
                                    style={{ borderRadius: 999 }}
                                >
                                    {previewItem.category}
                                </Tag>
                                <Tag style={{ borderRadius: 999 }}>
                                    {getFileMeta(previewItem.fileName).label}
                                </Tag>
                            </Space>

                            {getExtension(previewItem.fileName) === 'txt' ? (
                                <pre
                                    style={{
                                        margin: 0,
                                        maxHeight: '72vh',
                                        overflow: 'auto',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        padding: 18,
                                        borderRadius: 10,
                                        background: '#f7f9fb',
                                        border: '1px solid #edf1f5',
                                        fontFamily: 'inherit'
                                    }}
                                >
                                    {previewText}
                                </pre>
                            ) : previewUrl ? (
                                <DocumentViewer
                                    file={previewUrl}
                                    fileName={previewItem.fileName}
                                />
                            ) : null}
                        </div>
                    )}
                </Spin>
            </Modal>
        </div>
    )
}

export default LibraryPage

import {
    CloseOutlined,
    EditOutlined,
    FontSizeOutlined,
    FormOutlined,
    LockOutlined,
    MailOutlined,
    UserOutlined
} from '@ant-design/icons'
import {
    Avatar,
    Button,
    ConfigProvider,
    Form,
    Input,
    Modal,
    Segmented,
    Skeleton,
    Tag,
    Typography,
    message,
    theme
} from 'antd'
import './account-settings.css'
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from 'react'
import { getNameInitials } from '@/utilities'
import { auth, db, storage } from '@/firebase'
import {
    EmailAuthProvider,
    reauthenticateWithCredential,
    updateEmail,
    updatePassword,
    updateProfile
} from 'firebase/auth'
import {
    doc,
    getDoc,
    updateDoc
} from 'firebase/firestore'
import {
    getDownloadURL,
    ref,
    uploadBytes
} from 'firebase/storage'
import SignatureCanvas from 'react-signature-canvas'

const { Text, Title } = Typography

type Props = {
    opened: boolean
    setOpened: (opened: boolean) => void
    userId: string
}

type SettingsSection = 'profile' | 'security' | 'signature'
type SignatureMethod = 'typed' | 'drawn'

const fontOptions = [
    {
        label: 'Classic',
        value: 'Dancing Script'
    },
    {
        label: 'Elegant',
        value: 'Great Vibes'
    }
]

const roleLabels: Record<string, string> = {
    operations: 'Heads Of Departments',
    coordinator: 'Project Coordinator',
    projectadmin: 'Center Coordinator',
    incubatee: 'SME',
    director: 'Director',
    receptionist: 'Receptionist',
    receiptionist: 'Receptionist',
    admin: 'Admin',
    employee: 'Employee',
    government: 'Government',
    headsofdepartment: 'Heads Of Departments',
    hod: 'Heads Of Departments',
    center_coordinator: 'Center Coordinator'
}

const formatRole = (role?: string) => {
    if (!role) return 'User'

    const normalized = role
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/-/g, '_')

    if (roleLabels[normalized]) {
        return roleLabels[normalized]
    }

    return role
        .replace(/_/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase())
}

export const AccountSettings = ({
    opened,
    setOpened,
    userId
}: Props) => {
    const { token } = theme.useToken()

    const [profileForm] = Form.useForm()
    const [passwordForm] = Form.useForm()

    const [loading, setLoading] = useState(true)

    const [savingProfile, setSavingProfile] = useState(false)
    const [savingPassword, setSavingPassword] = useState(false)
    const [savingSignature, setSavingSignature] = useState(false)

    const [userData, setUserData] = useState<any>(null)

    const [activeSection, setActiveSection] =
        useState<SettingsSection>('profile')

    // Profile
    const [editingProfile, setEditingProfile] = useState(false)

    // Security
    const [changingPassword, setChangingPassword] = useState(false)

    // Signature
    const [savedSignatureURL, setSavedSignatureURL] =
        useState<string | null>(null)

    const [signatureEditing, setSignatureEditing] = useState(false)

    const [signatureMethod, setSignatureMethod] =
        useState<SignatureMethod>('typed')

    const [typedName, setTypedName] = useState('')
    const [typedFont, setTypedFont] = useState(fontOptions[0].value)

    const [drawnHasInk, setDrawnHasInk] = useState(false)

    const canvasRef = useRef<SignatureCanvas | null>(null)
    const canvasHostRef = useRef<HTMLDivElement | null>(null)

    const [canvasWidth, setCanvasWidth] = useState(640)

    const closeModal = () => {
        setOpened(false)
    }

    const passwordProviderEnabled =
        auth.currentUser?.providerData?.some(
            provider => provider.providerId === 'password'
        ) ?? false

    /**
     * Load signature fonts only when settings are opened.
     */
    useEffect(() => {
        if (!opened) return

        const existingLink = document.getElementById(
            'account-settings-signature-fonts'
        )

        if (existingLink) return

        const link = document.createElement('link')

        link.id = 'account-settings-signature-fonts'
        link.rel = 'stylesheet'
        link.href =
            'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Great+Vibes&display=swap'

        document.head.appendChild(link)
    }, [opened])

    /**
     * Fetch user.
     */
    useEffect(() => {
        const fetchUserData = async () => {
            setLoading(true)

            try {
                const userRef = doc(db, 'users', userId)
                const userSnap = await getDoc(userRef)

                if (!userSnap.exists()) {
                    message.error('User profile could not be found.')
                    return
                }

                const data = userSnap.data()

                const resolvedName =
                    data.name ||
                    data.fullName ||
                    auth.currentUser?.displayName ||
                    ''

                const resolvedEmail =
                    data.email ||
                    auth.currentUser?.email ||
                    ''

                const resolvedSignature =
                    data.signatureURL || null

                const resolvedData = {
                    ...data,
                    name: resolvedName,
                    email: resolvedEmail
                }

                setUserData(resolvedData)

                profileForm.setFieldsValue({
                    name: resolvedName,
                    email: resolvedEmail
                })

                setSavedSignatureURL(resolvedSignature)

                setTypedName(resolvedName)
                setTypedFont(fontOptions[0].value)

                setActiveSection('profile')

                setEditingProfile(false)
                setChangingPassword(false)
                setSignatureEditing(false)

                setSignatureMethod('typed')
                setDrawnHasInk(false)

                passwordForm.resetFields()
            } catch (error) {
                console.error('Account settings load error:', error)
                message.error('Failed to load user profile.')
            } finally {
                setLoading(false)
            }
        }

        if (opened && userId) {
            fetchUserData()
        }
    }, [
        opened,
        userId,
        profileForm,
        passwordForm
    ])

    /**
     * Resize drawing canvas.
     */
    useLayoutEffect(() => {
        if (
            !opened ||
            !signatureEditing ||
            signatureMethod !== 'drawn'
        ) {
            return
        }

        const host = canvasHostRef.current

        if (!host) return

        const updateWidth = () => {
            const width = Math.floor(
                host.getBoundingClientRect().width
            )

            if (width > 0) {
                setCanvasWidth(width)
            }
        }

        updateWidth()

        const observer = new ResizeObserver(updateWidth)

        observer.observe(host)

        return () => observer.disconnect()
    }, [
        opened,
        signatureEditing,
        signatureMethod
    ])

    /**
     * Change tab.
     *
     * Cancel any unfinished edit mode when moving sections.
     */
    const handleSectionChange = (value: string | number) => {
        const section = value as SettingsSection

        setEditingProfile(false)
        setChangingPassword(false)
        setSignatureEditing(false)

        passwordForm.resetFields()

        profileForm.setFieldsValue({
            name: userData?.name || '',
            email: userData?.email || ''
        })

        setTypedName(userData?.name || '')
        setTypedFont(fontOptions[0].value)

        canvasRef.current?.clear()
        setDrawnHasInk(false)

        setActiveSection(section)
    }

    /**
     * Start profile editing.
     */
    const startProfileEditing = () => {
        profileForm.setFieldsValue({
            name: userData?.name || '',
            email: userData?.email || ''
        })

        setEditingProfile(true)
    }

    const cancelProfileEditing = () => {
        profileForm.setFieldsValue({
            name: userData?.name || '',
            email: userData?.email || ''
        })

        setEditingProfile(false)
    }

    /**
     * Save profile.
     */
    const handleProfileSave = async () => {
        try {
            const values = await profileForm.validateFields()

            setSavingProfile(true)

            const user = auth.currentUser

            if (!user) {
                throw new Error('No authenticated user.')
            }

            const name = values.name.trim()
            const email = values.email.trim()

            if (user.displayName !== name) {
                await updateProfile(user, {
                    displayName: name
                })
            }

            if (
                user.email &&
                user.email.toLowerCase() !== email.toLowerCase()
            ) {
                await updateEmail(user, email)
            }

            const payload: Record<string, any> = {
                name,
                email
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    userData || {},
                    'fullName'
                )
            ) {
                payload.fullName = name
            }

            await updateDoc(
                doc(db, 'users', user.uid),
                payload
            )

            setUserData((previous: any) => ({
                ...previous,
                ...payload
            }))

            setTypedName(name)

            setEditingProfile(false)

            message.success('Profile updated successfully.')
        } catch (error: any) {
            console.error(error)

            if (
                error?.code === 'auth/requires-recent-login'
            ) {
                message.error(
                    'Please sign in again before changing your email address.'
                )
                return
            }

            message.error(
                error?.message || 'Failed to update profile.'
            )
        } finally {
            setSavingProfile(false)
        }
    }

    /**
     * Password.
     */
    const startPasswordChange = () => {
        passwordForm.resetFields()
        setChangingPassword(true)
    }

    const cancelPasswordChange = () => {
        passwordForm.resetFields()
        setChangingPassword(false)
    }

    const handlePasswordSave = async () => {
        try {
            const values = await passwordForm.validateFields()

            setSavingPassword(true)

            const user = auth.currentUser

            if (!user?.email) {
                throw new Error(
                    'No authenticated email account found.'
                )
            }

            const credential =
                EmailAuthProvider.credential(
                    user.email,
                    values.currentPassword
                )

            await reauthenticateWithCredential(
                user,
                credential
            )

            await updatePassword(
                user,
                values.newPassword
            )

            passwordForm.resetFields()
            setChangingPassword(false)

            message.success('Password updated successfully.')
        } catch (error: any) {
            console.error(error)

            if (
                error?.code === 'auth/invalid-credential' ||
                error?.code === 'auth/wrong-password'
            ) {
                message.error(
                    'Your current password is incorrect.'
                )
                return
            }

            message.error(
                error?.message || 'Failed to update password.'
            )
        } finally {
            setSavingPassword(false)
        }
    }

    /**
     * Signature editing.
     */
    const startSignatureEditing = () => {
        setSignatureMethod('typed')
        setTypedName(userData?.name || '')
        setTypedFont(fontOptions[0].value)
        setDrawnHasInk(false)

        setSignatureEditing(true)
    }

    const cancelSignatureEditing = () => {
        canvasRef.current?.clear()

        setSignatureEditing(false)
        setSignatureMethod('typed')
        setTypedName(userData?.name || '')
        setTypedFont(fontOptions[0].value)
        setDrawnHasInk(false)
    }

    /**
     * Generate typed signature PNG.
     */
    const createTypedSignatureImage =
        async (): Promise<string> => {
            const name = typedName.trim()

            if (!name) {
                throw new Error(
                    'Enter the name you want to use for your signature.'
                )
            }

            try {
                await document.fonts?.load(
                    `52px "${typedFont}"`
                )
            } catch {
                // Browser fallback is acceptable.
            }

            const measureCanvas =
                document.createElement('canvas')

            const measureContext =
                measureCanvas.getContext('2d')

            if (!measureContext) {
                throw new Error(
                    'Unable to generate signature.'
                )
            }

            const fontSize = 52

            measureContext.font =
                `${fontSize}px "${typedFont}", cursive`

            const metrics =
                measureContext.measureText(name)

            const horizontalPadding = 34
            const verticalPadding = 24

            const width = Math.ceil(
                metrics.width + horizontalPadding * 2
            )

            const height =
                fontSize + verticalPadding * 2

            const scale = 2

            const canvas =
                document.createElement('canvas')

            canvas.width = width * scale
            canvas.height = height * scale

            const context =
                canvas.getContext('2d')

            if (!context) {
                throw new Error(
                    'Unable to generate signature.'
                )
            }

            context.scale(scale, scale)

            context.font =
                `${fontSize}px "${typedFont}", cursive`

            context.textBaseline = 'middle'
            context.fillStyle = '#111'

            context.fillText(
                name,
                horizontalPadding,
                height / 2
            )

            return canvas.toDataURL('image/png')
        }

    /**
     * Generate drawn signature PNG.
     */
    const createDrawnSignatureImage = (): string => {
        if (
            !canvasRef.current ||
            canvasRef.current.isEmpty()
        ) {
            throw new Error(
                'Draw your signature before saving.'
            )
        }

        return canvasRef.current
            .getTrimmedCanvas()
            .toDataURL('image/png')
    }

    /**
     * Upload only new signature data.
     */
    const uploadNewSignature = async (
        dataURL: string
    ): Promise<string> => {
        const user = auth.currentUser

        if (!user) {
            throw new Error('No authenticated user.')
        }

        const blob = await (
            await fetch(dataURL)
        ).blob()

        const fileRef = ref(
            storage,
            `signatures/${user.uid}_${Date.now()}.png`
        )

        await uploadBytes(
            fileRef,
            blob,
            {
                contentType: 'image/png'
            }
        )

        return getDownloadURL(fileRef)
    }

    const handleSignatureSave = async () => {
        try {
            setSavingSignature(true)

            const user = auth.currentUser

            if (!user) {
                throw new Error('No authenticated user.')
            }

            const dataURL =
                signatureMethod === 'typed'
                    ? await createTypedSignatureImage()
                    : createDrawnSignatureImage()

            const signatureURL =
                await uploadNewSignature(dataURL)

            await updateDoc(
                doc(db, 'users', user.uid),
                {
                    signatureURL
                }
            )

            setSavedSignatureURL(signatureURL)

            setUserData((previous: any) => ({
                ...previous,
                signatureURL
            }))

            setSignatureEditing(false)
            setDrawnHasInk(false)

            message.success('Signature updated successfully.')
        } catch (error: any) {
            console.error(error)

            message.error(
                error?.message || 'Failed to save signature.'
            )
        } finally {
            setSavingSignature(false)
        }
    }

    const clearDrawing = () => {
        canvasRef.current?.clear()
        setDrawnHasInk(false)
    }

    const signatureCanSave =
        signatureEditing &&
        (
            signatureMethod === 'typed'
                ? Boolean(typedName.trim())
                : drawnHasInk
        )

    /**
     * Header
     */
    const renderHeader = () => (
        <>
            <div
                style={{
                    minHeight: 72,
                    padding: '15px 20px',
                    display: 'grid',
                    // Equal-width flanking columns are what actually centres
                    // the title — a two-column flex row centres it against
                    // the wrong axis the moment the close button's own width
                    // is added to one side.
                    gridTemplateColumns: '32px 1fr 32px',
                    alignItems: 'center',
                    gap: 16,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`
                }}
            >
                <div />

                <div style={{ textAlign: 'center' }}>
                    <Text
                        strong
                        style={{
                            display: 'block',
                            fontSize: 16
                        }}
                    >
                        Account settings
                    </Text>

                    <Text
                        type="secondary"
                        style={{
                            fontSize: 12
                        }}
                    >
                        Manage your profile, security and signature.
                    </Text>
                </div>

                <button
                    type="button"
                    className="account-settings-close"
                    onClick={closeModal}
                    aria-label="Close"
                    style={{
                        width: 32,
                        height: 32,
                        display: 'grid',
                        placeItems: 'center',
                        justifySelf: 'end',
                        borderRadius: '50%',
                        border: '1px solid #ff4d4f',
                        color: '#ff4d4f',
                        background: 'color-mix(in srgb, #ff4d4f 8%, transparent)',
                        cursor: 'pointer',
                        font: 'inherit'
                    }}
                >
                    <CloseOutlined />
                </button>
            </div>

            <div
                style={{
                    padding: '12px 20px',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`
                }}
            >
                <Segmented
                    block
                    size="large"
                    className="account-settings-segmented"
                    value={activeSection}
                    onChange={handleSectionChange}
                    options={[
                        {
                            label: 'Profile',
                            value: 'profile',
                            icon: <UserOutlined />
                        },
                        {
                            label: 'Security',
                            value: 'security',
                            icon: <LockOutlined />
                        },
                        {
                            label: 'Signature',
                            value: 'signature',
                            icon: <FormOutlined />
                        }
                    ]}
                />
            </div>
        </>
    )

    /**
     * PROFILE
     */
    const renderProfileOverview = () => (
        <div>
            <div
                style={{
                    marginBottom: 22
                }}
            >
                <Title
                    level={5}
                    style={{
                        margin: '0 0 4px'
                    }}
                >
                    Profile
                </Title>

                <Text
                    type="secondary"
                    style={{
                        fontSize: 13
                    }}
                >
                    Your personal account information.
                </Text>
            </div>

            <div
                style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 20,
                    padding: 24,
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    gap: 24,
                    alignItems: 'center'
                }}
            >
                <Avatar
                    size={88}
                    src={
                        userData?.photoURL ||
                        auth.currentUser?.photoURL ||
                        undefined
                    }
                    style={{
                        background: token.colorPrimary,
                        fontSize: 28,
                        fontWeight: 600,
                        flexShrink: 0
                    }}
                >
                    {getNameInitials(userData?.name)}
                </Avatar>

                <div
                    style={{
                        minWidth: 0
                    }}
                >
                    <div
                        style={{
                            marginBottom: 12
                        }}
                    >
                        <Title
                            level={4}
                            style={{
                                margin: 0,
                                lineHeight: 1.3
                            }}
                        >
                            {userData?.name}
                        </Title>

                        <Tag
                            style={{
                                marginTop: 8,
                                borderRadius: 999,
                                paddingInline: 10
                            }}
                        >
                            {formatRole(userData?.role)}
                        </Tag>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            color: token.colorTextSecondary
                        }}
                    >
                        <MailOutlined />

                        <Text
                            type="secondary"
                            style={{
                                fontSize: 13,
                                overflowWrap: 'anywhere'
                            }}
                        >
                            {userData?.email}
                        </Text>
                    </div>
                </div>
            </div>

            <button
                type="button"
                className="account-settings-row"
                onClick={startProfileEditing}
                style={{
                    width: '100%',
                    marginTop: 14,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                    borderRadius: 16,
                    padding: '14px 16px',
                    cursor: 'pointer',
                    font: 'inherit',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 11
                    }}
                >
                    <div
                        style={{
                            width: 36,
                            height: 36,
                            display: 'grid',
                            placeItems: 'center',
                            borderRadius: 10,
                            background: token.colorFillTertiary,
                            color: token.colorTextSecondary
                        }}
                    >
                        <EditOutlined />
                    </div>

                    <div>
                        <Text
                            strong
                            style={{
                                display: 'block'
                            }}
                        >
                            Edit profile
                        </Text>

                        <Text
                            type="secondary"
                            style={{
                                fontSize: 12
                            }}
                        >
                            Change your name or email address.
                        </Text>
                    </div>
                </div>

                <EditOutlined
                    style={{
                        color: token.colorTextSecondary
                    }}
                />
            </button>
        </div>
    )

    const renderProfileEditor = () => (
        <div>
            <div
                style={{
                    marginBottom: 22
                }}
            >
                <Title
                    level={5}
                    style={{
                        margin: '0 0 4px'
                    }}
                >
                    Edit profile
                </Title>

                <Text
                    type="secondary"
                    style={{
                        fontSize: 13
                    }}
                >
                    Update the personal information linked to your account.
                </Text>
            </div>

            <Form
                form={profileForm}
                layout="vertical"
            >
                <Form.Item
                    name="name"
                    label="Full name"
                    rules={[
                        {
                            required: true,
                            whitespace: true,
                            message: 'Please enter your name'
                        }
                    ]}
                >
                    <Input
                        size="large"
                        prefix={
                            <UserOutlined
                                style={{
                                    color: token.colorTextSecondary
                                }}
                            />
                        }
                        placeholder="Full name"
                    />
                </Form.Item>

                <Form.Item
                    name="email"
                    label="Email address"
                    rules={[
                        {
                            required: true,
                            message: 'Please enter your email'
                        },
                        {
                            type: 'email',
                            message: 'Enter a valid email'
                        }
                    ]}
                >
                    <Input
                        size="large"
                        prefix={
                            <MailOutlined
                                style={{
                                    color: token.colorTextSecondary
                                }}
                            />
                        }
                        placeholder="Email address"
                    />
                </Form.Item>
            </Form>
        </div>
    )

    const renderProfile = () =>
        editingProfile
            ? renderProfileEditor()
            : renderProfileOverview()

    /**
     * SECURITY
     */
    const renderSecurityOverview = () => (
        <div>
            <div
                style={{
                    marginBottom: 22
                }}
            >
                <Title
                    level={5}
                    style={{
                        margin: '0 0 4px'
                    }}
                >
                    Security
                </Title>

                <Text
                    type="secondary"
                    style={{
                        fontSize: 13
                    }}
                >
                    Manage how you secure access to your account.
                </Text>
            </div>

            <div
                style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 20,
                    padding: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12
                    }}
                >
                    <div
                        style={{
                            width: 42,
                            height: 42,
                            borderRadius: 12,
                            display: 'grid',
                            placeItems: 'center',
                            background: token.colorFillTertiary,
                            color: token.colorTextSecondary,
                            fontSize: 16
                        }}
                    >
                        <LockOutlined />
                    </div>

                    <div>
                        <Text
                            strong
                            style={{
                                display: 'block'
                            }}
                        >
                            Password
                        </Text>

                        <Text
                            type="secondary"
                            style={{
                                fontSize: 12
                            }}
                        >
                            Change your account password.
                        </Text>
                    </div>
                </div>

                {passwordProviderEnabled ? (
                    <Button
                        icon={<EditOutlined />}
                        onClick={startPasswordChange}
                    >
                        Change password
                    </Button>
                ) : (
                    <Tag>
                        Managed externally
                    </Tag>
                )}
            </div>

            {!passwordProviderEnabled && (
                <div
                    style={{
                        marginTop: 12,
                        padding: '12px 14px',
                        borderRadius: 16,
                        background: token.colorFillTertiary
                    }}
                >
                    <Text
                        type="secondary"
                        style={{
                            fontSize: 12
                        }}
                    >
                        Your password is managed by the provider you use to
                        sign in, such as Google.
                    </Text>
                </div>
            )}
        </div>
    )

    const renderPasswordEditor = () => (
        <div>
            <div
                style={{
                    marginBottom: 22
                }}
            >
                <Title
                    level={5}
                    style={{
                        margin: '0 0 4px'
                    }}
                >
                    Change password
                </Title>

                <Text
                    type="secondary"
                    style={{
                        fontSize: 13
                    }}
                >
                    Enter your current password before setting a new one.
                </Text>
            </div>

            <Form
                form={passwordForm}
                layout="vertical"
            >
                <Form.Item
                    label="Current password"
                    name="currentPassword"
                    rules={[
                        {
                            required: true,
                            message: 'Enter your current password'
                        }
                    ]}
                >
                    <Input.Password
                        size="large"
                        placeholder="Current password"
                    />
                </Form.Item>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            'repeat(auto-fit, minmax(230px, 1fr))',
                        gap: '0 16px'
                    }}
                >
                    <Form.Item
                        label="New password"
                        name="newPassword"
                        rules={[
                            {
                                required: true,
                                message: 'Enter a new password'
                            },
                            {
                                min: 8,
                                message: 'Use at least 8 characters'
                            },
                            {
                                validator: (_, value) => {
                                    if (!value) {
                                        return Promise.resolve()
                                    }

                                    const valid =
                                        /[A-Z]/.test(value) &&
                                        /[a-z]/.test(value) &&
                                        /[^A-Za-z]/.test(value)

                                    if (!valid) {
                                        return Promise.reject(
                                            new Error(
                                                'Use uppercase, lowercase and a number or symbol'
                                            )
                                        )
                                    }

                                    return Promise.resolve()
                                }
                            }
                        ]}
                    >
                        <Input.Password
                            size="large"
                            placeholder="New password"
                        />
                    </Form.Item>

                    <Form.Item
                        label="Confirm new password"
                        name="confirmPassword"
                        dependencies={['newPassword']}
                        rules={[
                            {
                                required: true,
                                message: 'Confirm your new password'
                            },
                            ({ getFieldValue }) => ({
                                validator(_, value) {
                                    if (
                                        !value ||
                                        getFieldValue('newPassword') === value
                                    ) {
                                        return Promise.resolve()
                                    }

                                    return Promise.reject(
                                        new Error(
                                            'Passwords do not match'
                                        )
                                    )
                                }
                            })
                        ]}
                    >
                        <Input.Password
                            size="large"
                            placeholder="Confirm password"
                        />
                    </Form.Item>
                </div>

                <div
                    style={{
                        background: token.colorFillTertiary,
                        borderRadius: 16,
                        padding: '12px 14px'
                    }}
                >
                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            fontSize: 12,
                            marginBottom: 4
                        }}
                    >
                        • At least 8 characters
                    </Text>

                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            fontSize: 12,
                            marginBottom: 4
                        }}
                    >
                        • Uppercase and lowercase letters
                    </Text>

                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            fontSize: 12
                        }}
                    >
                        • At least one number or symbol
                    </Text>
                </div>
            </Form>
        </div>
    )

    const renderSecurity = () =>
        changingPassword
            ? renderPasswordEditor()
            : renderSecurityOverview()

    /**
     * SIGNATURE
     */
    const renderSignatureMethodCard = (
        method: SignatureMethod,
        icon: React.ReactNode,
        title: string,
        description: string
    ) => {
        const selected =
            signatureMethod === method

        return (
            <button
                type="button"
                onClick={() => {
                    if (signatureMethod === method) {
                        return
                    }

                    canvasRef.current?.clear()
                    setDrawnHasInk(false)
                    setSignatureMethod(method)
                }}
                style={{
                    width: '100%',
                    padding: 16,
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                    borderRadius: 16,
                    border: `1px solid ${selected
                            ? token.colorPrimary
                            : token.colorBorderSecondary
                        }`,
                    background: selected
                        ? token.colorPrimaryBg
                        : token.colorBgContainer
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12
                    }}
                >
                    <div
                        style={{
                            width: 38,
                            height: 38,
                            borderRadius: 11,
                            display: 'grid',
                            placeItems: 'center',
                            background: selected
                                ? token.colorPrimary
                                : token.colorFillTertiary,
                            color: selected
                                ? token.colorTextLightSolid
                                : token.colorTextSecondary
                        }}
                    >
                        {icon}
                    </div>

                    <div>
                        <Text
                            strong
                            style={{
                                display: 'block'
                            }}
                        >
                            {title}
                        </Text>

                        <Text
                            type="secondary"
                            style={{
                                fontSize: 12
                            }}
                        >
                            {description}
                        </Text>
                    </div>
                </div>
            </button>
        )
    }

    const renderTypedSignature = () => (
        <div
            style={{
                marginTop: 22
            }}
        >
            <div
                style={{
                    marginBottom: 20
                }}
            >
                <Text
                    strong
                    style={{
                        display: 'block',
                        marginBottom: 7
                    }}
                >
                    Name on signature
                </Text>

                <Input
                    size="large"
                    value={typedName}
                    onChange={event =>
                        setTypedName(event.target.value)
                    }
                    placeholder="Enter your name"
                />
            </div>

            <Text
                strong
                style={{
                    display: 'block',
                    marginBottom: 9
                }}
            >
                Choose a signature style
            </Text>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns:
                        'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 12
                }}
            >
                {fontOptions.map(option => {
                    const selected =
                        typedFont === option.value

                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                                setTypedFont(option.value)
                            }
                            style={{
                                width: '100%',
                                minHeight: 110,
                                padding: '15px 16px',
                                cursor: 'pointer',
                                textAlign: 'left',
                                borderRadius: 16,
                                border: `1px solid ${selected
                                        ? token.colorPrimary
                                        : token.colorBorderSecondary
                                    }`,
                                background: selected
                                    ? token.colorPrimaryBg
                                    : token.colorBgContainer,
                                font: 'inherit'
                            }}
                        >
                            <div
                                style={{
                                    minHeight: 48,
                                    display: 'flex',
                                    alignItems: 'center',
                                    fontFamily: `"${option.value}", cursive`,
                                    fontSize:
                                        option.value === 'Great Vibes'
                                            ? 34
                                            : 31,
                                    lineHeight: 1.2,
                                    color: token.colorText,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}
                            >
                                {typedName || 'Your signature'}
                            </div>

                            <Text
                                type="secondary"
                                style={{
                                    display: 'block',
                                    fontSize: 11,
                                    marginTop: 8
                                }}
                            >
                                {option.label}
                            </Text>
                        </button>
                    )
                })}
            </div>
        </div>
    )

    const renderDrawnSignature = () => (
        <div
            style={{
                marginTop: 22
            }}
        >
            <Text
                strong
                style={{
                    display: 'block',
                    marginBottom: 9
                }}
            >
                Draw your signature
            </Text>

            <div
                ref={canvasHostRef}
                style={{
                    width: '100%',
                    height: 190,
                    overflow: 'hidden',
                    position: 'relative',
                    borderRadius: 16,
                    border: `1px dashed ${token.colorBorder}`,
                    background: '#fff'
                }}
            >
                {!drawnHasInk && (
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'grid',
                            placeItems: 'center',
                            pointerEvents: 'none'
                        }}
                    >
                        <Text
                            style={{
                                color: '#b7b7b7',
                                fontSize: 13
                            }}
                        >
                            Sign anywhere in this area
                        </Text>
                    </div>
                )}

                <div
                    style={{
                        position: 'absolute',
                        left: 30,
                        right: 30,
                        bottom: 38,
                        height: 1,
                        background: '#ddd',
                        pointerEvents: 'none'
                    }}
                />

                <SignatureCanvas
                    ref={canvasRef}
                    penColor="#111"
                    onEnd={() =>
                        setDrawnHasInk(true)
                    }
                    canvasProps={{
                        width: canvasWidth,
                        height: 190,
                        style: {
                            display: 'block',
                            width: '100%',
                            height: 190,
                            position: 'relative',
                            zIndex: 1,
                            cursor: 'crosshair'
                        }
                    }}
                />
            </div>

            <div
                style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginTop: 8
                }}
            >
                <Button
                    type="text"
                    disabled={!drawnHasInk}
                    onClick={clearDrawing}
                >
                    Clear
                </Button>
            </div>
        </div>
    )

    const renderSignatureOverview = () => (
        <div>
            <div
                style={{
                    marginBottom: 22
                }}
            >
                <Title
                    level={5}
                    style={{
                        margin: '0 0 4px'
                    }}
                >
                    Signature
                </Title>

                <Text
                    type="secondary"
                    style={{
                        fontSize: 13
                    }}
                >
                    Used when signing documents through Smart Incubation.
                </Text>
            </div>

            {savedSignatureURL ? (
                <div
                    style={{
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: 20,
                        overflow: 'hidden'
                    }}
                >
                    <div
                        style={{
                            minHeight: 190,
                            display: 'grid',
                            placeItems: 'center',
                            padding: 24,
                            background: token.colorFillTertiary
                        }}
                    >
                        <img
                            src={savedSignatureURL}
                            alt="Current signature"
                            style={{
                                maxWidth: '100%',
                                maxHeight: 120,
                                objectFit: 'contain'
                            }}
                        />
                    </div>

                    <div
                        style={{
                            padding: '14px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12
                        }}
                    >
                        <div>
                            <Text
                                strong
                                style={{
                                    display: 'block'
                                }}
                            >
                                Current signature
                            </Text>

                            <Text
                                type="secondary"
                                style={{
                                    fontSize: 12
                                }}
                            >
                                This signature is currently saved to your profile.
                            </Text>
                        </div>

                        <Button
                            icon={<EditOutlined />}
                            onClick={startSignatureEditing}
                        >
                            Replace
                        </Button>
                    </div>
                </div>
            ) : (
                <div
                    style={{
                        minHeight: 250,
                        padding: 28,
                        border: `1px dashed ${token.colorBorder}`,
                        borderRadius: 20,
                        display: 'grid',
                        placeItems: 'center',
                        textAlign: 'center'
                    }}
                >
                    <div
                        style={{
                            maxWidth: 320
                        }}
                    >
                        <div
                            style={{
                                width: 54,
                                height: 54,
                                borderRadius: 16,
                                background: token.colorFillTertiary,
                                display: 'grid',
                                placeItems: 'center',
                                margin: '0 auto 14px',
                                fontSize: 21,
                                color: token.colorTextSecondary
                            }}
                        >
                            <FormOutlined />
                        </div>

                        <Title
                            level={5}
                            style={{
                                margin: '0 0 5px'
                            }}
                        >
                            No signature saved
                        </Title>

                        <Text
                            type="secondary"
                            style={{
                                fontSize: 13
                            }}
                        >
                            Create a typed or hand-drawn signature for document signing.
                        </Text>

                        <div
                            style={{
                                marginTop: 18
                            }}
                        >
                            <Button
                                type="primary"
                                onClick={startSignatureEditing}
                            >
                                Create signature
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )

    const renderSignatureEditor = () => (
        <div>
            <div
                style={{
                    marginBottom: 22
                }}
            >
                <Title
                    level={5}
                    style={{
                        margin: '0 0 4px'
                    }}
                >
                    {savedSignatureURL
                        ? 'Replace signature'
                        : 'Create signature'}
                </Title>

                <Text
                    type="secondary"
                    style={{
                        fontSize: 13
                    }}
                >
                    Choose whether you want to type or draw your signature.
                </Text>
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns:
                        'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 10
                }}
            >
                {renderSignatureMethodCard(
                    'typed',
                    <FontSizeOutlined />,
                    'Type my signature',
                    'Create a styled signature from your name.'
                )}

                {renderSignatureMethodCard(
                    'drawn',
                    <FormOutlined />,
                    'Draw my signature',
                    'Sign using your mouse, touchpad or screen.'
                )}
            </div>

            {signatureMethod === 'typed'
                ? renderTypedSignature()
                : renderDrawnSignature()}
        </div>
    )

    const renderSignature = () =>
        signatureEditing
            ? renderSignatureEditor()
            : renderSignatureOverview()

    const renderContent = () => {
        switch (activeSection) {
            case 'security':
                return renderSecurity()

            case 'signature':
                return renderSignature()

            case 'profile':
            default:
                return renderProfile()
        }
    }

    /**
     * Full-width modal footer.
     */
    const footerButtonStyle = {
        flex: 1,
        minWidth: 0
    }

    const renderFooter = () => {
        if (activeSection === 'profile') {
            if (editingProfile) {
                return (
                    <div
                        style={{
                            display: 'flex',
                            gap: 10,
                            width: '100%'
                        }}
                    >
                        <Button
                            size="large"
                            style={footerButtonStyle}
                            disabled={savingProfile}
                            onClick={cancelProfileEditing}
                        >
                            Cancel
                        </Button>

                        <Button
                            size="large"
                            type="primary"
                            style={footerButtonStyle}
                            loading={savingProfile}
                            onClick={handleProfileSave}
                        >
                            Update profile
                        </Button>
                    </div>
                )
            }

            return (
                <Button
                    size="large"
                    block
                    onClick={closeModal}
                >
                    Close
                </Button>
            )
        }

        if (activeSection === 'security') {
            if (changingPassword) {
                return (
                    <div
                        style={{
                            display: 'flex',
                            gap: 10,
                            width: '100%'
                        }}
                    >
                        <Button
                            size="large"
                            style={footerButtonStyle}
                            disabled={savingPassword}
                            onClick={cancelPasswordChange}
                        >
                            Cancel
                        </Button>

                        <Button
                            size="large"
                            type="primary"
                            style={footerButtonStyle}
                            loading={savingPassword}
                            onClick={handlePasswordSave}
                        >
                            Update password
                        </Button>
                    </div>
                )
            }

            return (
                <Button
                    size="large"
                    block
                    onClick={closeModal}
                >
                    Close
                </Button>
            )
        }

        if (signatureEditing) {
            return (
                <div
                    style={{
                        display: 'flex',
                        gap: 10,
                        width: '100%'
                    }}
                >
                    <Button
                        size="large"
                        style={footerButtonStyle}
                        disabled={savingSignature}
                        onClick={cancelSignatureEditing}
                    >
                        Cancel
                    </Button>

                    <Button
                        size="large"
                        type="primary"
                        style={footerButtonStyle}
                        loading={savingSignature}
                        disabled={!signatureCanSave}
                        onClick={handleSignatureSave}
                    >
                        Save signature
                    </Button>
                </div>
            )
        }

        return (
            <Button
                size="large"
                block
                onClick={closeModal}
            >
                Close
            </Button>
        )
    }

    return (
        <Modal
            open={opened}
            onCancel={closeModal}
            footer={null}
            closable={false}
            centered
            width={760}
            destroyOnClose
            maskClosable={false}
            styles={{
                content: {
                    padding: 0,
                    overflow: 'hidden',
                    borderRadius: 24,
                    background: token.colorBgContainer
                },
                body: {
                    padding: 0,
                    overflow: 'hidden'
                }
            }}
        >
            {/*
                Scoped to this modal only — softens buttons, the Segmented
                control, inputs and tags without touching the app-wide radius
                token everything else still relies on.
            */}
            <ConfigProvider
                theme={{
                    token: {
                        borderRadius: 10,
                        borderRadiusLG: 16
                    }
                }}
            >
                {loading ? (
                    <div
                        style={{
                            padding: 24
                        }}
                    >
                        <Skeleton
                            active
                            avatar
                            paragraph={{
                                rows: 6
                            }}
                        />
                    </div>
                ) : (
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            // A tall cap rather than a tight one: on any
                            // reasonably sized screen the content below never
                            // reaches it, so the scroll region — and its
                            // scrollbar — stay dormant. It only earns its keep
                            // on short windows or the longer Security/Signature
                            // forms.
                            maxHeight: 'min(90vh, 780px)',
                            background: token.colorBgContainer
                        }}
                    >
                        {renderHeader()}

                        <div
                            className="account-settings-scroll"
                            style={{
                                flex: 1,
                                minHeight: 0,
                                overflowY: 'auto',
                                padding: '22px 20px'
                            }}
                        >
                            {renderContent()}
                        </div>

                        <div
                            style={{
                                padding: '12px 20px',
                                borderTop: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorBgContainer
                            }}
                        >
                            {renderFooter()}
                        </div>
                    </div>
                )}
            </ConfigProvider>
        </Modal>
    )
}

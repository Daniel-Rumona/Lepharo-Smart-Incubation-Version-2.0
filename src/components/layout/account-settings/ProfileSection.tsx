import React, { type ChangeEvent, useRef, useState } from 'react'
import { Avatar, Button, Form, Input, Tag, message, theme } from 'antd'
import {
    CameraOutlined,
    EditOutlined,
    GoogleOutlined,
    MailOutlined,
    UserOutlined
} from '@ant-design/icons'
import {
    EmailAuthProvider,
    reauthenticateWithCredential,
    updateProfile,
    verifyBeforeUpdateEmail
} from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from '@/firebase'
import { getNameInitials } from '@/utils/get-name-initials'
import { formatRole } from '@/lib/roleLabels'
import { SectionHead, SectionLayout, type SectionProps } from './SectionLayout'

type Mode = 'view' | 'name' | 'email'

const emailChangeError = (error: any): string => {
    switch (error?.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
            return 'Your current password is incorrect.'
        case 'auth/email-already-in-use':
            return 'Another account already uses that email address.'
        case 'auth/invalid-email':
            return 'Enter a valid email address.'
        case 'auth/too-many-requests':
            return 'Too many attempts. Wait a few minutes and try again.'
        default:
            return error?.message || 'Could not start the email change.'
    }
}

/** Tell the rest of the app (top bar avatar, identity) about a profile change. */
const broadcastProfile = (detail: Record<string, unknown>) =>
    window.dispatchEvent(new CustomEvent('user-profile-updated', { detail }))

export const ProfileSection: React.FC<SectionProps> = ({ userData, onUpdate }) => {
    const { token } = theme.useToken()
    const [nameForm] = Form.useForm()
    const [emailForm] = Form.useForm()
    const [mode, setMode] = useState<Mode>('view')
    const [saving, setSaving] = useState(false)
    const [savingPhoto, setSavingPhoto] = useState(false)
    /** Address awaiting confirmation via the emailed link, this session. */
    const [pendingEmail, setPendingEmail] = useState<string | null>(null)
    const photoInputRef = useRef<HTMLInputElement | null>(null)

    const providers = auth.currentUser?.providerData ?? []
    const hasPassword = providers.some(provider => provider.providerId === 'password')
    const usesGoogle = providers.some(provider => provider.providerId === 'google.com')
    const photoURL = userData.photoURL || auth.currentUser?.photoURL || undefined

    const backToView = () => {
        nameForm.resetFields()
        emailForm.resetFields()
        setMode('view')
    }

    const handlePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        if (!file.type.startsWith('image/')) {
            message.error('Please choose an image file.')
            return
        }
        if (file.size > 5 * 1024 * 1024) {
            message.error('Profile images must be 5 MB or smaller.')
            return
        }

        const user = auth.currentUser
        if (!user) {
            message.error('No authenticated user.')
            return
        }

        try {
            setSavingPhoto(true)
            const fileRef = ref(storage, `profile-images/${user.uid}/avatar`)
            await uploadBytes(fileRef, file, { contentType: file.type })
            const url = await getDownloadURL(fileRef)

            // users/{uid}.photoURL is the one place a profile photo lives.
            await updateProfile(user, { photoURL: url })
            await updateDoc(doc(db, 'users', user.uid), { photoURL: url })

            onUpdate({ photoURL: url })
            broadcastProfile({ uid: user.uid, photoURL: url })
            message.success('Profile photo updated.')
        } catch (error: any) {
            console.error('Profile photo upload failed:', error)
            message.error(error?.message || 'Failed to update profile photo.')
        } finally {
            setSavingPhoto(false)
        }
    }

    const handleNameSave = async () => {
        try {
            const { name: rawName } = await nameForm.validateFields()
            const name = String(rawName).trim()
            const user = auth.currentUser
            if (!user) throw new Error('No authenticated user.')

            setSaving(true)
            if (user.displayName !== name) await updateProfile(user, { displayName: name })

            const payload: Record<string, string> = { name }
            // Some older profiles carry the name twice; keep both in step.
            if (Object.prototype.hasOwnProperty.call(userData, 'fullName')) payload.fullName = name
            await updateDoc(doc(db, 'users', user.uid), payload)

            onUpdate(payload)
            broadcastProfile({ uid: user.uid, name })
            message.success('Name updated.')
            backToView()
        } catch (error: any) {
            if (error?.errorFields) return // validation message is already shown
            console.error(error)
            message.error(error?.message || 'Failed to update your name.')
        } finally {
            setSaving(false)
        }
    }

    /**
     * Firebase sends a confirmation link to the new address and only switches
     * the account over once it is clicked; the profile copy is synced the next
     * time settings open (see index.tsx). Changing the address directly is
     * deprecated and fails under email-enumeration protection.
     */
    const handleEmailChange = async () => {
        try {
            const values = await emailForm.validateFields()
            const user = auth.currentUser
            if (!user?.email) throw new Error('No authenticated email account found.')

            const newEmail = String(values.newEmail).trim()
            if (newEmail.toLowerCase() === user.email.toLowerCase()) {
                message.info('That is already your email address.')
                return
            }

            setSaving(true)
            await reauthenticateWithCredential(
                user,
                EmailAuthProvider.credential(user.email, values.currentPassword)
            )
            await verifyBeforeUpdateEmail(user, newEmail)

            setPendingEmail(newEmail)
            message.success(`We sent a confirmation link to ${newEmail}.`)
            backToView()
        } catch (error: any) {
            if (error?.errorFields) return
            console.error(error)
            message.error(emailChangeError(error))
        } finally {
            setSaving(false)
        }
    }

    const iconStyle = { color: token.colorTextSecondary }

    if (mode === 'name') {
        return (
            <SectionLayout
                footer={
                    <>
                        <Button size='large' disabled={saving} onClick={backToView}>
                            Cancel
                        </Button>
                        <Button size='large' type='primary' loading={saving} onClick={handleNameSave}>
                            Save name
                        </Button>
                    </>
                }
            >
                <SectionHead title='Edit name' sub='This is how your name appears across the platform.' />
                <Form
                    form={nameForm}
                    layout='vertical'
                    initialValues={{ name: userData.name ?? '' }}
                    onFinish={handleNameSave}
                >
                    <Form.Item
                        name='name'
                        label='Full name'
                        rules={[{ required: true, whitespace: true, message: 'Please enter your name' }]}
                    >
                        <Input size='large' prefix={<UserOutlined style={iconStyle} />} autoFocus />
                    </Form.Item>
                </Form>
            </SectionLayout>
        )
    }

    if (mode === 'email') {
        return (
            <SectionLayout
                footer={
                    <>
                        <Button size='large' disabled={saving} onClick={backToView}>
                            Cancel
                        </Button>
                        <Button size='large' type='primary' loading={saving} onClick={handleEmailChange}>
                            Send confirmation link
                        </Button>
                    </>
                }
            >
                <SectionHead
                    title='Change email address'
                    sub='We will email a link to the new address. Your email only changes once you open it.'
                />
                <Form form={emailForm} layout='vertical' onFinish={handleEmailChange}>
                    <Form.Item
                        name='newEmail'
                        label='New email address'
                        rules={[
                            { required: true, message: 'Enter the new email address' },
                            { type: 'email', message: 'Enter a valid email address' }
                        ]}
                    >
                        <Input
                            size='large'
                            type='email'
                            inputMode='email'
                            autoComplete='email'
                            prefix={<MailOutlined style={iconStyle} />}
                            autoFocus
                        />
                    </Form.Item>
                    <Form.Item
                        name='currentPassword'
                        label='Current password'
                        extra='Confirms it is really you before the change.'
                        rules={[{ required: true, message: 'Enter your current password' }]}
                    >
                        <Input.Password size='large' autoComplete='current-password' />
                    </Form.Item>
                </Form>
            </SectionLayout>
        )
    }

    return (
        <SectionLayout>
            <div className='acs-card acs-profile'>
                <div className='acs-avatar'>
                    <Avatar
                        size={88}
                        src={photoURL}
                        style={{ background: token.colorPrimary, fontSize: 28, fontWeight: 600 }}
                    >
                        {getNameInitials(userData.name ?? '')}
                    </Avatar>
                    <input
                        ref={photoInputRef}
                        type='file'
                        accept='image/*'
                        onChange={handlePhotoChange}
                        hidden
                    />
                    <button
                        type='button'
                        className='acs-camera'
                        aria-label={photoURL ? 'Change profile photo' : 'Add profile photo'}
                        onClick={() => photoInputRef.current?.click()}
                        disabled={savingPhoto}
                    >
                        <CameraOutlined />
                    </button>
                </div>

                <div style={{ minWidth: 0 }}>
                    <h3 className='acs-name'>{userData.name}</h3>
                    <Tag style={{ marginTop: 8, borderRadius: 999, paddingInline: 10 }}>
                        {formatRole(userData.role)}
                    </Tag>
                    <div className='acs-email'>
                        <MailOutlined />
                        <span>{userData.email}</span>
                    </div>
                </div>
            </div>

            <button type='button' className='acs-row' onClick={() => setMode('name')}>
                <span className='acs-row-main'>
                    <span className='acs-tile'>
                        <UserOutlined />
                    </span>
                    <span>
                        <span className='acs-label'>Name</span>
                        <span className='acs-hint'>{userData.name}</span>
                    </span>
                </span>
                <EditOutlined style={iconStyle} />
            </button>

            {hasPassword ? (
                <button type='button' className='acs-row' onClick={() => setMode('email')}>
                    <span className='acs-row-main'>
                        <span className='acs-tile'>
                            <MailOutlined />
                        </span>
                        <span>
                            <span className='acs-label'>Email address</span>
                            <span className='acs-hint'>Change the address you sign in with</span>
                        </span>
                    </span>
                    <EditOutlined style={iconStyle} />
                </button>
            ) : (
                <div className='acs-row'>
                    <span className='acs-row-main'>
                        <span className='acs-tile'>
                            {usesGoogle ? <GoogleOutlined /> : <MailOutlined />}
                        </span>
                        <span>
                            <span className='acs-label'>Email address</span>
                            <span className='acs-hint'>
                                Managed by {usesGoogle ? 'your Google account' : 'your sign-in provider'}
                            </span>
                        </span>
                    </span>
                </div>
            )}

            {pendingEmail && (
                <div className='acs-note'>
                    Check <strong>{pendingEmail}</strong> for a confirmation link. Until you open it, keep
                    signing in with {userData.email}.
                </div>
            )}
        </SectionLayout>
    )
}

export default ProfileSection

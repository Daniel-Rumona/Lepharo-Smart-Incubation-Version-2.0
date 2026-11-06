import { useEffect, useState } from 'react'
import { CloseOutlined, FormOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { ConfigProvider, Modal, Segmented, Skeleton, message } from 'antd'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { ProfileSection } from './ProfileSection'
import { SecuritySection } from './SecuritySection'
import { SignatureSection } from './SignatureSection'
import type { AccountUser } from './SectionLayout'
import './account-settings.css'

type Props = {
    opened: boolean
    setOpened: (opened: boolean) => void
    userId: string
}

type Section = 'profile' | 'security' | 'signature'

const SECTIONS = [
    { label: 'Profile', value: 'profile', icon: <UserOutlined /> },
    { label: 'Security', value: 'security', icon: <LockOutlined /> },
    { label: 'Signature', value: 'signature', icon: <FormOutlined /> }
]

/**
 * Account settings: profile, password and signature. Each section owns its
 * own edit state and Save/Cancel footer; switching tabs unmounts the section,
 * which is what discards an unfinished edit.
 */
export const AccountSettings = ({ opened, setOpened, userId }: Props) => {
    const [loading, setLoading] = useState(true)
    const [userData, setUserData] = useState<AccountUser | null>(null)
    const [section, setSection] = useState<Section>('profile')

    useEffect(() => {
        if (!opened || !userId) return
        let cancelled = false

        const load = async () => {
            setLoading(true)
            setSection('profile')
            try {
                const snap = await getDoc(doc(db, 'users', userId))
                if (!snap.exists()) {
                    message.error('User profile could not be found.')
                    return
                }
                const data = snap.data() as AccountUser
                const authUser = auth.currentUser?.uid === userId ? auth.currentUser : null

                // An email change only takes effect once its confirmation link
                // is opened, which happens outside the app. Pick up the
                // confirmed address and copy it onto the profile here.
                if (authUser) {
                    try {
                        await authUser.reload()
                    } catch {
                        // Offline or token trouble: keep the cached copy.
                    }
                }
                const authEmail = authUser?.email || ''
                let email = data.email || authEmail
                if (authEmail && authEmail.toLowerCase() !== String(data.email || '').toLowerCase()) {
                    email = authEmail
                    await updateDoc(doc(db, 'users', userId), { email })
                    window.dispatchEvent(
                        new CustomEvent('user-profile-updated', { detail: { uid: userId, email } })
                    )
                }

                if (!cancelled) {
                    setUserData({
                        ...data,
                        name: data.name || data.fullName || authUser?.displayName || '',
                        email
                    })
                }
            } catch (error) {
                console.error('Account settings load error:', error)
                message.error('Failed to load your profile.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [opened, userId])

    const handleUpdate = (patch: Partial<AccountUser>) =>
        setUserData(previous => (previous ? { ...previous, ...patch } : previous))

    const close = () => setOpened(false)

    return (
        <Modal
            open={opened}
            onCancel={close}
            footer={null}
            closable={false}
            centered
            width={760}
            destroyOnClose
            maskClosable={false}
            styles={{
                content: { padding: 0, overflow: 'hidden', borderRadius: 24 },
                body: { padding: 0, overflow: 'hidden' }
            }}
        >
            {/* Softer corners for this modal only, without touching the
                app-wide radius token everything else relies on. */}
            <ConfigProvider theme={{ token: { borderRadius: 10, borderRadiusLG: 16 } }}>
                {loading || !userData ? (
                    <div style={{ padding: 24 }}>
                        <Skeleton active avatar paragraph={{ rows: 6 }} />
                    </div>
                ) : (
                    <div className='acs'>
                        <header className='acs-head'>
                            <span />
                            <div>
                                <span className='acs-head-title'>Account settings</span>
                                <span className='acs-head-sub'>
                                    Manage your profile, security and signature.
                                </span>
                            </div>
                            <button
                                type='button'
                                className='acs-close'
                                onClick={close}
                                aria-label='Close account settings'
                            >
                                <CloseOutlined />
                            </button>
                        </header>

                        <div className='acs-tabs'>
                            <Segmented
                                block
                                size='large'
                                value={section}
                                onChange={value => setSection(value as Section)}
                                options={SECTIONS}
                            />
                        </div>

                        {section === 'profile' && (
                            <ProfileSection userData={userData} onUpdate={handleUpdate} />
                        )}
                        {section === 'security' && <SecuritySection />}
                        {section === 'signature' && (
                            <SignatureSection userData={userData} onUpdate={handleUpdate} />
                        )}
                    </div>
                )}
            </ConfigProvider>
        </Modal>
    )
}

export default AccountSettings

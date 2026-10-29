import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Input, message } from 'antd'
import { EditOutlined, FontSizeOutlined, FormOutlined } from '@ant-design/icons'
import { doc, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import SignatureCanvas from 'react-signature-canvas'
import { auth, db, storage } from '@/firebase'
import {
    captureSignatureStrokes,
    rememberProfileSignature,
    trimmedSignaturePng,
    type SignatureStrokes
} from '@/utils/signatureReplay'
import { SectionHead, SectionLayout, type SectionProps } from './SectionLayout'

type SignatureMethod = 'typed' | 'drawn'

const FONT_OPTIONS = [
    { label: 'Classic', value: 'Dancing Script', size: 31 },
    { label: 'Elegant', value: 'Great Vibes', size: 34 }
]
const FONT_LINK_ID = 'account-settings-signature-fonts'
const PAD_HEIGHT = 190

/** Renders the typed name in the chosen script font as a PNG data URL. */
const renderTypedSignature = async (name: string, font: string): Promise<string> => {
    try {
        await document.fonts?.load(`52px "${font}"`)
    } catch {
        // The browser's fallback font is acceptable.
    }

    const fontSize = 52
    const paddingX = 34
    const paddingY = 24
    const scale = 2

    const measure = document.createElement('canvas').getContext('2d')
    if (!measure) throw new Error('Unable to generate signature.')
    measure.font = `${fontSize}px "${font}", cursive`

    const width = Math.ceil(measure.measureText(name).width + paddingX * 2)
    const height = fontSize + paddingY * 2

    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to generate signature.')

    context.scale(scale, scale)
    context.font = `${fontSize}px "${font}", cursive`
    context.textBaseline = 'middle'
    context.fillStyle = '#111'
    context.fillText(name, paddingX, height / 2)

    return canvas.toDataURL('image/png')
}

export const SignatureSection: React.FC<SectionProps> = ({ userData, onUpdate }) => {
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [method, setMethod] = useState<SignatureMethod>('typed')
    const [typedName, setTypedName] = useState(userData.name ?? '')
    const [typedFont, setTypedFont] = useState(FONT_OPTIONS[0].value)
    const [hasInk, setHasInk] = useState(false)
    const [canvasWidth, setCanvasWidth] = useState(640)
    const canvasRef = useRef<SignatureCanvas | null>(null)
    const padRef = useRef<HTMLDivElement | null>(null)

    const savedSignatureURL = userData.signatureURL || null

    // The script fonts are only needed here, so load them on first visit.
    useEffect(() => {
        if (document.getElementById(FONT_LINK_ID)) return
        const link = document.createElement('link')
        link.id = FONT_LINK_ID
        link.rel = 'stylesheet'
        link.href =
            'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Great+Vibes&display=swap'
        document.head.appendChild(link)
    }, [])

    // Keep the drawing canvas's pixel width matched to its box.
    useLayoutEffect(() => {
        if (!editing || method !== 'drawn') return
        const pad = padRef.current
        if (!pad) return

        const updateWidth = () => {
            const width = Math.floor(pad.getBoundingClientRect().width)
            if (width > 0) setCanvasWidth(width)
        }
        updateWidth()
        const observer = new ResizeObserver(updateWidth)
        observer.observe(pad)
        return () => observer.disconnect()
    }, [editing, method])

    const resetEditor = () => {
        canvasRef.current?.clear()
        setMethod('typed')
        setTypedName(userData.name ?? '')
        setTypedFont(FONT_OPTIONS[0].value)
        setHasInk(false)
    }

    const startEditing = () => {
        resetEditor()
        setEditing(true)
    }

    const cancel = () => {
        resetEditor()
        setEditing(false)
    }

    const chooseMethod = (next: SignatureMethod) => {
        if (next === method) return
        canvasRef.current?.clear()
        setHasInk(false)
        setMethod(next)
    }

    const canSave = method === 'typed' ? Boolean(typedName.trim()) : hasInk

    const handleSave = async () => {
        try {
            const user = auth.currentUser
            if (!user) throw new Error('No authenticated user.')

            setSaving(true)
            let dataURL: string
            let signatureStrokes: SignatureStrokes | null = null
            if (method === 'typed') {
                const name = typedName.trim()
                if (!name) throw new Error('Enter the name you want to use for your signature.')
                dataURL = await renderTypedSignature(name, typedFont)
            } else {
                if (!canvasRef.current || canvasRef.current.isEmpty()) {
                    throw new Error('Draw your signature before saving.')
                }
                dataURL = trimmedSignaturePng(canvasRef.current)
                // Kept so signing can re-draw the signature stroke by stroke.
                signatureStrokes = captureSignatureStrokes(canvasRef.current, true)
            }

            const blob = await (await fetch(dataURL)).blob()
            const fileRef = ref(storage, `signatures/${user.uid}_${Date.now()}.png`)
            await uploadBytes(fileRef, blob, { contentType: 'image/png' })
            const signatureURL = await getDownloadURL(fileRef)

            await updateDoc(doc(db, 'users', user.uid), {
                signatureURL,
                signatureMethod: method,
                signatureStrokes
            })
            rememberProfileSignature(user.uid, signatureURL, signatureStrokes)
            onUpdate({ signatureURL })
            message.success('Signature saved.')
            cancel()
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Failed to save signature.')
        } finally {
            setSaving(false)
        }
    }

    if (editing) {
        return (
            <SectionLayout
                footer={
                    <>
                        <Button size='large' disabled={saving} onClick={cancel}>
                            Cancel
                        </Button>
                        <Button
                            size='large'
                            type='primary'
                            loading={saving}
                            disabled={!canSave}
                            onClick={handleSave}
                        >
                            Save signature
                        </Button>
                    </>
                }
            >
                <SectionHead
                    title={savedSignatureURL ? 'Replace signature' : 'Create signature'}
                    sub='Choose whether you want to type or draw your signature.'
                />

                <div className='acs-grid-2'>
                    {(
                        [
                            ['typed', <FontSizeOutlined key='t' />, 'Type my signature', 'Create a styled signature from your name.'],
                            ['drawn', <FormOutlined key='d' />, 'Draw my signature', 'Sign using your mouse, touchpad or screen.']
                        ] as const
                    ).map(([key, icon, title, hint]) => (
                        <button
                            key={key}
                            type='button'
                            className={method === key ? 'acs-choice is-selected' : 'acs-choice'}
                            aria-pressed={method === key}
                            onClick={() => chooseMethod(key)}
                        >
                            <span className='acs-row-main'>
                                <span className='acs-tile'>{icon}</span>
                                <span>
                                    <span className='acs-label'>{title}</span>
                                    <span className='acs-hint'>{hint}</span>
                                </span>
                            </span>
                        </button>
                    ))}
                </div>

                {method === 'typed' ? (
                    <div style={{ marginTop: 22 }}>
                        <label className='acs-label' htmlFor='acs-typed-name' style={{ marginBottom: 7 }}>
                            Name on signature
                        </label>
                        <Input
                            id='acs-typed-name'
                            size='large'
                            value={typedName}
                            onChange={event => setTypedName(event.target.value)}
                            placeholder='Enter your name'
                        />

                        <span className='acs-label' style={{ margin: '20px 0 9px' }}>
                            Choose a signature style
                        </span>
                        <div className='acs-grid-2' style={{ gap: 12 }}>
                            {FONT_OPTIONS.map(option => (
                                <button
                                    key={option.value}
                                    type='button'
                                    className={typedFont === option.value ? 'acs-choice is-selected' : 'acs-choice'}
                                    aria-pressed={typedFont === option.value}
                                    onClick={() => setTypedFont(option.value)}
                                    style={{ minHeight: 110 }}
                                >
                                    <div
                                        className='acs-font-sample'
                                        style={{
                                            fontFamily: `"${option.value}", cursive`,
                                            fontSize: option.size
                                        }}
                                    >
                                        {typedName || 'Your signature'}
                                    </div>
                                    <span className='acs-hint' style={{ display: 'block', marginTop: 8 }}>
                                        {option.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div style={{ marginTop: 22 }}>
                        <span className='acs-label' style={{ marginBottom: 9 }}>
                            Draw your signature
                        </span>
                        <div ref={padRef} className='acs-pad'>
                            {!hasInk && <div className='acs-pad-hint'>Sign anywhere in this area</div>}
                            <div className='acs-pad-line' />
                            <SignatureCanvas
                                ref={canvasRef}
                                penColor='#111'
                                onEnd={() => setHasInk(true)}
                                canvasProps={{
                                    width: canvasWidth,
                                    height: PAD_HEIGHT,
                                    'aria-label': 'Signature drawing area',
                                    style: {
                                        display: 'block',
                                        width: '100%',
                                        height: PAD_HEIGHT,
                                        position: 'relative',
                                        zIndex: 1,
                                        cursor: 'crosshair'
                                    }
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                            <Button
                                type='text'
                                disabled={!hasInk}
                                onClick={() => {
                                    canvasRef.current?.clear()
                                    setHasInk(false)
                                }}
                            >
                                Clear
                            </Button>
                        </div>
                    </div>
                )}
            </SectionLayout>
        )
    }

    return (
        <SectionLayout>
            <SectionHead title='Signature' sub='Used when signing documents through Smart Incubation.' />

            {savedSignatureURL ? (
                <div className='acs-card'>
                    <div className='acs-sig-preview'>
                        <img src={savedSignatureURL} alt='Current signature' />
                    </div>
                    <div className='acs-row' style={{ margin: 0, border: 0, borderRadius: '0 0 20px 20px' }}>
                        <span>
                            <span className='acs-label'>Current signature</span>
                            <span className='acs-hint'>This signature is saved to your profile.</span>
                        </span>
                        <Button icon={<EditOutlined />} onClick={startEditing}>
                            Replace
                        </Button>
                    </div>
                </div>
            ) : (
                <div className='acs-sig-empty'>
                    <div style={{ maxWidth: 320 }}>
                        <div className='acs-tile'>
                            <FormOutlined />
                        </div>
                        <h3 className='acs-section-title'>No signature saved</h3>
                        <p className='acs-section-sub'>
                            Create a typed or hand-drawn signature for document signing.
                        </p>
                        <Button type='primary' onClick={startEditing} style={{ marginTop: 18 }}>
                            Create signature
                        </Button>
                    </div>
                </div>
            )}
        </SectionLayout>
    )
}

export default SignatureSection

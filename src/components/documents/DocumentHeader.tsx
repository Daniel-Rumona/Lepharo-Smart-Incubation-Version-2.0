// src/components/DocumentHeader.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'

interface DocumentHeaderProps {
    leftLogo?: string // if provided, overrides program logo
    rightLogo?: string // if provided, overrides default right logo
    title: string
    subtitle?: string
    programName?: string // if provided, overrides fetched program name
    altLeft?: string
    altRight?: string

    /**
     * If true (default), component will fetch active program and use its logoUrl
     * when leftLogo prop is not provided.
     */
    useActiveProgramLogo?: boolean
}

export const DocumentHeader: React.FC<DocumentHeaderProps> = ({
    leftLogo,
    rightLogo = '/assets/images/lepharo.png',
    title,
    subtitle,
    programName,
    altLeft = 'Program Logo',
    altRight = 'Right Logo',
    useActiveProgramLogo = true
}) => {
    const { activeProgramId } = useActiveProgramId()

    const [programLogoUrl, setProgramLogoUrl] = useState<string | null>(null)
    const [programTitle, setProgramTitle] = useState<string | null>(null)

    useEffect(() => {
        let mounted = true

        const run = async () => {
            if (!useActiveProgramLogo) return
            if (!activeProgramId) {
                if (mounted) {
                    setProgramLogoUrl(null)
                    setProgramTitle(null)
                }
                return
            }

            try {
                const ref = doc(db, 'programs', activeProgramId)
                const snap = await getDoc(ref)

                if (!mounted) return

                if (!snap.exists()) {
                    setProgramLogoUrl(null)
                    setProgramTitle(null)
                    return
                }

                const data = snap.data() as any
                setProgramLogoUrl(typeof data.logoUrl === 'string' ? data.logoUrl : null)
                setProgramTitle(typeof data.name === 'string' ? data.name : null)
            } catch {
                if (mounted) {
                    setProgramLogoUrl(null)
                    setProgramTitle(null)
                }
            }
        }

        run()
        return () => {
            mounted = false
        }
    }, [activeProgramId, useActiveProgramLogo])

    // Final logo precedence:
    // 1) prop leftLogo
    // 2) active program logoUrl
    // 3) optional fallback local asset (if you want one)
    const finalLeftLogo = useMemo(() => {
        return leftLogo || programLogoUrl || '/assets/images/sibanye-logo.png'
    }, [leftLogo, programLogoUrl])

    const finalProgramName = useMemo(() => {
        return programName || programTitle || undefined
    }, [programName, programTitle])

    const logoStyle: React.CSSProperties = {
        width: 200,
        height: 72,
        objectFit: 'contain'
    }

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '1fr 2fr 1fr',
                alignItems: 'center',
                marginBottom: 12
            }}
        >
            {/* Left Logo (Program Logo) */}
            <div style={{ textAlign: 'left' }}>
                <img
                    src={finalLeftLogo}
                    alt={altLeft}
                    style={logoStyle}
                />
            </div>

            {/* Center Section */}
            <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{title || '—'}</div>

                {subtitle && (
                    <div style={{ fontSize: 14, color: '#444', marginTop: 4 }}>
                        {subtitle}
                    </div>
                )}

                {finalProgramName && (
                    <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        {finalProgramName}
                    </div>
                )}
            </div>

            {/* Right Logo */}
            <div style={{ textAlign: 'right' }}>
                <img
                    src={rightLogo}
                    alt={altRight}
                    style={logoStyle}
                />
            </div>
        </div>
    )
}

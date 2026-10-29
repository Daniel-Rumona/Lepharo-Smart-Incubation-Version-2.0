// An SME's choice about receiving WhatsApp messages from the programme.
// Stored on users/{uid}.whatsappConsent so it can be read by the reminder job,
// and so existing SMEs who have never been asked can be asked once.

export type WhatsAppConsent = {
    status: 'granted' | 'declined'
    /** Digits with a leading +, only when granted. */
    number?: string
    answeredAt: unknown
    /** Bump when the wording changes materially, to ask again. */
    version: number
    source: 'welcome' | 'login-prompt'
}

export const WHATSAPP_CONSENT_VERSION = 1

/**
 * Normalise a typed number to +<country><digits>. A leading 0 is read as South
 * Africa (+27). Returns null when it is not plausibly a phone number.
 */
export function normalizeWhatsAppNumber(input: unknown): string | null {
    const raw = String(input ?? '').trim()
    if (!raw) return null
    let digits = raw.replace(/[^0-9]/g, '')
    if (raw.startsWith('00')) digits = digits.slice(2)
    else if (digits.startsWith('0')) digits = `27${digits.slice(1)}`
    if (digits.length < 10 || digits.length > 15) return null
    return `+${digits}`
}

/** Existing and new SMEs who have not answered (for this version of the wording) still need asking. */
export function needsWhatsAppPrompt(userDoc: Record<string, any> | null | undefined): boolean {
    const consent = userDoc?.whatsappConsent
    if (!consent?.answeredAt) return true
    return Number(consent.version || 0) < WHATSAPP_CONSENT_VERSION
}

export function buildConsent(input: {
    status: 'granted' | 'declined'
    number?: unknown
    source: WhatsAppConsent['source']
    now: unknown
}): { consent: WhatsAppConsent | null; error: string | null } {
    if (input.status === 'declined') {
        return {
            consent: { status: 'declined', answeredAt: input.now, version: WHATSAPP_CONSENT_VERSION, source: input.source },
            error: null
        }
    }
    const number = normalizeWhatsAppNumber(input.number)
    if (!number) return { consent: null, error: 'Enter a valid WhatsApp number, for example 082 123 4567.' }
    return {
        consent: { status: 'granted', number, answeredAt: input.now, version: WHATSAPP_CONSENT_VERSION, source: input.source },
        error: null
    }
}

/** The number to send to, or null when the SME has not agreed. */
export function consentedNumber(userDoc: Record<string, any> | null | undefined): string | null {
    const consent = userDoc?.whatsappConsent
    if (consent?.status !== 'granted') return null
    return normalizeWhatsAppNumber(consent.number)
}

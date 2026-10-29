import { needsWhatsAppPrompt } from './whatsappConsent'

export const SNOOZE_KEY = 'lph:whatsappPromptSnoozed'

/** True when this SME should be shown the one-question page at login. */
export function shouldPromptWhatsApp(userDoc: Record<string, any> | null | undefined): boolean {
    try {
        if (sessionStorage.getItem(SNOOZE_KEY) === '1') return false
    } catch {
        // Storage can be unavailable; fall through and ask.
    }
    return needsWhatsAppPrompt(userDoc)
}

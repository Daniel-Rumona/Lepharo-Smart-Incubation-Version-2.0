// Which steps the first-time setup wizard shows, decided in one place.

export type WelcomeRole = 'incubatee' | 'director' | 'system_admin' | 'consultant' | 'operations' | 'unknown' | string

export type WelcomeStepKey =
    | 'welcome'
    | 'password'
    | 'directorProfile'
    | 'popia'
    | 'whatsapp'
    | 'signature'
    | 'consent'

/**
 * Whether this person has to replace a default password. An explicit flag on
 * their profile always wins; with no flag, staff are assumed to need it (they
 * are created with the default password) and SMEs are not.
 */
export function mustChangePasswordFor(flag: unknown, role: WelcomeRole): boolean {
    return typeof flag === 'boolean' ? flag : role !== 'incubatee'
}

/**
 * A person on a default password sees ONLY the password step, whatever their
 * role. The rest of the setup (signature, POPIA, WhatsApp and so on) is not
 * dropped: it appears the next time they sign in, once the password is safe.
 *
 * Everyone signs POPIA, and the signature comes first because signing POPIA
 * places it on the document.
 */
export function welcomeStepKeys(input: {
    role: WelcomeRole
    passwordOnly: boolean
    mustRegisterCompany: boolean
    hideConsent?: boolean
}): WelcomeStepKey[] {
    if (input.passwordOnly) return ['password']

    const consent: WelcomeStepKey[] = input.hideConsent === false ? ['consent'] : []

    if (input.role !== 'incubatee') {
        return [
            'welcome',
            ...(input.role === 'director' && input.mustRegisterCompany ? (['directorProfile'] as const) : []),
            'signature',
            'popia',
            ...consent
        ]
    }
    return ['welcome', 'signature', 'popia', 'whatsapp', ...consent]
}

/**
 * The steps this visit actually asks for: only the ones not done yet, with the
 * welcome screen in front. Someone sent back for one missing item sees just
 * that item. WhatsApp can be put off, so it is only asked on a first visit,
 * never as a reason on its own to come back.
 */
export function pendingWelcomeSteps(
    keys: WelcomeStepKey[],
    done: Partial<Record<WelcomeStepKey, boolean>>,
    firstVisit: boolean
): WelcomeStepKey[] {
    const pending = keys.filter(key => {
        if (key === 'welcome') return false
        if (key === 'whatsapp' && !firstVisit) return false
        return !done[key]
    })
    if (!pending.length) return []
    // A password-only visit has no welcome screen.
    return keys.includes('welcome') ? ['welcome', ...pending] : pending
}

/**
 * Whether signing in should go through the setup wizard before anything else:
 * a default password to replace, an SME's first visit, or no saved signature
 * or POPIA consent (both required of every user).
 */
export function needsWelcomeSetup(input: {
    role: WelcomeRole
    firstLoginDone: boolean
    mustChangePassword: boolean
    hasSignature: boolean
    popiaSigned: boolean
}): boolean {
    if (input.mustChangePassword) return true
    if (input.role === 'incubatee' && !input.firstLoginDone) return true
    return !input.hasSignature || !input.popiaSigned
}

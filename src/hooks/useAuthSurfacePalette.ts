import { useColorMode } from '@/contexts/ThemeContext'

/**
 * Page-level colours shared by the sign-in and registration split screens.
 *
 * Only gradients live here. Every flat colour on those pages (the white card,
 * the #333 / #666 text, the pale panels) is rewritten by the global dark-mode
 * remediation layer in styles/dark-mode.css, which matches serialised inline
 * style values. A gradient's stops are not reachable that way, so these four
 * have to be branched explicitly.
 *
 * The two pages are visual twins, so keeping this in one place stops them
 * drifting apart the next time either is touched.
 */
export const useAuthSurfacePalette = () => {
    const { isDark } = useColorMode()

    return {
        isDark,

        /** The full-viewport wash behind the card. */
        pageWash: isDark
            ? 'linear-gradient(135deg, #0e1117 0%, #141922 100%)'
            : 'linear-gradient(135deg, #f5f7fa 0%, #e4e7eb 100%)',

        /** Blurred decorative blob, top-left. */
        blobCool: isDark
            ? 'radial-gradient(circle, rgba(74,155,255,0.20) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(200,230,255,0.6) 0%, transparent 70%)',

        /** Blurred decorative blob, bottom-right. Carries the brand coral. */
        blobWarm: isDark
            ? 'radial-gradient(circle, rgba(245,83,46,0.18) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(255,220,200,0.5) 0%, transparent 70%)',

        /**
         * The blocking veil shown while signing in. A white veil over a dark
         * page is a flash of light at exactly the wrong moment.
         */
        overlayVeil: isDark ? 'rgba(8, 11, 17, 0.72)' : 'rgba(255,255,255,0.65)',

        /**
         * The caption panel floating over the welding photo, and the type
         * inside it.
         *
         * This one is not a gradient, but it is unreachable for the same
         * reason: the remediation layer matches opaque colours only, so a
         * translucent white scrim slips past it while the dark #1c2541 /
         * #2d3748 text inside is flipped to light. That combination is
         * white-on-white. Branching the surface and the text together is what
         * keeps them in agreement.
         */
        slideScrim: isDark ? 'rgba(10, 14, 22, 0.72)' : 'rgba(255,255,255,0.5)',

        /** Lifts the caption off a bright, busy photograph. */
        slideScrimBlur: isDark ? 'blur(8px) saturate(120%)' : 'none',

        /* A real border, not an inset shadow: rule 4f of the remediation layer
           replaces any inline `box-shadow: rgba(...)` outright, so an inset
           hairline would be thrown away. Inline border colours in white rgba
           are not matched, so this one survives. The panel is set to
           border-box at the call site to absorb the extra pixel. */
        slideScrimBorder: isDark
            ? '1px solid rgba(255,255,255,0.10)'
            : '1px solid transparent',

        slideTitle: isDark ? 'rgba(255,255,255,0.95)' : '#1c2541',
        slideBody: isDark ? 'rgba(255,255,255,0.72)' : '#2d3748',

        /**
         * The "OR" divider between the sign-in button and the Google button.
         *
         * Its #111 was reachable in principle but missed in practice: the
         * remediation layer's dark-text list covers #000, #333 and #262626 but
         * not #111, so the label stayed near-black. The rules either side are a
         * separate problem again — they are a border-colour, and that list maps
         * pale grey borders onto subtle dark ones, which is the wrong direction
         * for a black rule that needs to become visible rather than recede.
         *
         * Muted rather than full white: the divider is a separator, not
         * something to read, and it should sit below the two buttons it splits.
         * The values mirror --app-text-muted and the layer's hairline
         * convention.
         */
        dividerText: isDark ? 'rgba(255,255,255,0.62)' : '#111',
        dividerLine: isDark ? 'rgba(255,255,255,0.16)' : '#111',

        /**
         * The brand red, sampled from the Lepharo wordmark itself (#7c1518 is
         * the mark's body, #e2001a its vivid highlight). The highlight is the
         * one that works as an accent; the body red is too dark to read as a
         * call to action.
         *
         * This also fixes an accessibility problem the old coral had: white on
         * #f5532e is 3.4:1, under the 4.5:1 needed for body text. White on
         * #e2001a is 4.9:1.
         */
        accent: '#e2001a',

        /**
         * Same red as a link rather than a filled button, so contrast is now
         * against the page instead of against white.
         *
         * #e2001a manages only 3.5:1 on the dark card (rgb(23,27,34)), so dark
         * mode uses a lightened tint of the same hue at 4.9:1. Light mode is on
         * white, where the brand red itself is 4.9:1 and needs no help.
         */
        accentLink: isDark ? '#ff3b4d' : '#e2001a',

        /**
         * The swirl medallion above the carousel. The artwork has a white
         * ground, so on a dark card it reads as a lit disc — the brightest
         * thing on the panel, competing with the form. Backing it with the
         * page's own dark and dropping the artwork's opacity lets the whole
         * medallion recede without touching the asset itself.
         */
        discBg: isDark ? '#141922' : '#f0f4f8',
        discBorder: isDark ? '3px solid rgba(255,255,255,0.08)' : '3px solid #fff',
        discImageOpacity: isDark ? 0.5 : 1,

        /* Opacity alone fades the swirl toward the backing as fast as it fades
           the white ground, which costs the medallion the brand red it exists
           to carry. The saturation lift buys that red back at the reduced
           opacity, so what recedes is the ground rather than the mark. */
        discImageFilter: isDark ? 'saturate(1.35)' : 'none',
    }
}

/**
 * The screen shown while the app signs a user out.
 *
 * Deliberately imperative DOM rather than a React component. Signing out
 * re-renders the whole tree with no user, and screens built for a signed-in user
 * flash their error state on the way past -- so this has to be painted *before*
 * that render, from a plain function, and survive React unmounting everything
 * beneath it. A component could not do either.
 *
 * It is also on screen for a real moment: sign-out terminates the Firestore
 * client and clears the on-disk cache before navigating.
 */

const ROOT_ID = 'lph-signout-screen'

/**
 * Animation timings, in milliseconds. Declared here rather than inline in the
 * CSS because the minimum display time below is derived from them -- one source
 * of truth, so retiming the animation cannot silently desync the two.
 */
const TIMING = {
    /** One rotation of the mark. */
    turn: 2600,
    /** Entrance for the copy and the progress track. */
    rise: 460,
    riseDelayCopy: 90,
    riseDelayTrack: 180,
    /** One pass of the progress bar. */
    sweep: 1500,
}

/**
 * How long the screen stays up regardless of how fast the sign-out finishes.
 *
 * Tearing down a session can complete in well under a second, which would cut
 * the animation off mid-sweep and read as a flicker rather than a farewell. The
 * work still happens immediately -- the user is signed out and their cache
 * cleared while this plays -- only the navigation waits.
 *
 * Long enough for the entrance to settle and the progress bar to complete one
 * full pass, so the screen looks finished rather than interrupted.
 */
const MIN_VISIBLE_MS = Math.max(TIMING.riseDelayTrack + TIMING.rise, TIMING.sweep)

/** Nothing is animating, so there is nothing to wait for beyond a readable beat. */
const MIN_VISIBLE_REDUCED_MS = 400

let shownAt: number | null = null

type Palette = {
    ground: string
    title: string
    body: string
    track: string
    accent: string
}

/** Mirrors the layout colours in src/config/antdTheme.ts and the paint in index.html. */
const THEME: Record<'light' | 'dark', Palette> = {
    light: {
        ground: '#ffffff',
        title: '#101828',
        body: '#667085',
        track: '#eceff3',
        accent: '#a6201f',
    },
    dark: {
        ground: '#0e1117',
        title: '#e7eaee',
        body: '#8c9099',
        track: '#222831',
        accent: '#f08a80',
    },
}

const css = (c: Palette) => `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: ${c.ground};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
#${ROOT_ID} .lph-so-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  text-align: center;
}
#${ROOT_ID} .lph-so-mark {
  width: 76px;
  height: 76px;
  animation: lph-so-turn ${TIMING.turn}ms linear infinite;
}
#${ROOT_ID} .lph-so-copy {
  display: flex;
  flex-direction: column;
  gap: 7px;
  /* Staggered behind the mark so the eye lands on the brand first. */
  animation: lph-so-rise ${TIMING.rise}ms cubic-bezier(.22,.61,.36,1) ${TIMING.riseDelayCopy}ms both;
}
#${ROOT_ID} .lph-so-title {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -.015em;
  color: ${c.title};
}
#${ROOT_ID} .lph-so-body {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.55;
  color: ${c.body};
  max-width: 34ch;
}
#${ROOT_ID} .lph-so-track {
  position: relative;
  width: 168px;
  height: 3px;
  border-radius: 999px;
  background: ${c.track};
  overflow: hidden;
  animation: lph-so-rise ${TIMING.rise}ms cubic-bezier(.22,.61,.36,1) ${TIMING.riseDelayTrack}ms both;
}
#${ROOT_ID} .lph-so-bar {
  position: absolute;
  inset-block: 0;
  width: 38%;
  border-radius: 999px;
  background: ${c.accent};
  animation: lph-so-sweep ${TIMING.sweep}ms cubic-bezier(.65,0,.35,1) infinite;
}
@keyframes lph-so-turn { to { transform: rotate(360deg); } }
@keyframes lph-so-rise {
  from { opacity: 0; transform: translateY(9px); }
  to   { opacity: 1; transform: none; }
}
@keyframes lph-so-sweep {
  0%   { transform: translateX(-110%); }
  100% { transform: translateX(370%); }
}
@media (prefers-reduced-motion: reduce) {
  /* Keep the meaning, drop the movement: everything settles into its end state
     and the progress bar becomes a static, centred segment. */
  #${ROOT_ID} .lph-so-mark,
  #${ROOT_ID} .lph-so-copy,
  #${ROOT_ID} .lph-so-track { animation: none; opacity: 1; transform: none; }
  #${ROOT_ID} .lph-so-bar { animation: none; left: 31%; }
}
`

/**
 * Resolves once the screen has been up long enough to finish its animation.
 *
 * Call after the sign-out work is done and await it before navigating away.
 * Resolves immediately if the screen never mounted, or if the wait has already
 * elapsed -- so a slow sign-out is never made slower.
 */
export function signOutScreenSettled(): Promise<void> {
    if (shownAt === null) return Promise.resolve()

    const reduced =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const remaining = (reduced ? MIN_VISIBLE_REDUCED_MS : MIN_VISIBLE_MS) - (Date.now() - shownAt)
    if (remaining <= 0) return Promise.resolve()

    return new Promise(resolve => setTimeout(resolve, remaining))
}

/**
 * Paints the sign-out screen over the app. Safe to call more than once.
 *
 * Never throws: a failure here would strand the user mid-sign-out, and the
 * sign-out itself matters far more than the screen covering it.
 */
export function showSignOutScreen(): void {
    try {
        if (typeof document === 'undefined' || document.getElementById(ROOT_ID)) return

        shownAt = Date.now()

        const colours =
            document.documentElement.getAttribute('data-theme') === 'dark' ? THEME.dark : THEME.light

        const style = document.createElement('style')
        style.textContent = css(colours)

        const root = document.createElement('div')
        root.id = ROOT_ID
        // Announced as a status rather than an alert: it is reassurance, not a problem.
        root.setAttribute('role', 'status')
        root.setAttribute('aria-live', 'polite')

        const inner = document.createElement('div')
        inner.className = 'lph-so-inner'

        // The bare mark on a transparent ground -- the app icons carry an opaque
        // white ground, which reads as a spinning white card on a dark page.
        // Precached by the service worker, so it resolves offline too; if it ever
        // does not, drop it rather than leaving a broken-image box behind.
        const mark = document.createElement('img')
        mark.className = 'lph-so-mark'
        mark.src = '/icons/mark.png'
        mark.alt = ''
        mark.setAttribute('aria-hidden', 'true')
        mark.onerror = () => mark.remove()

        const copy = document.createElement('div')
        copy.className = 'lph-so-copy'

        const title = document.createElement('p')
        title.className = 'lph-so-title'
        title.textContent = 'See you soon'

        const body = document.createElement('p')
        body.className = 'lph-so-body'
        body.textContent = 'Signing you out and clearing your data from this device.'

        const track = document.createElement('div')
        track.className = 'lph-so-track'
        const bar = document.createElement('div')
        bar.className = 'lph-so-bar'
        track.appendChild(bar)

        copy.append(title, body)
        inner.append(mark, copy, track)
        root.append(style, inner)
        document.body.appendChild(root)
    } catch {
        /* the sign-out continues regardless */
    }
}

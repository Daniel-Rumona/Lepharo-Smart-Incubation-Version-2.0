import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'

type Severity = 'info' | 'warn' | 'error' | 'fatal'

type LogUser = {
  uid?: string | null
  email?: string | null
  role?: string | null
   | null
}

type LogOptions = {
  severity?: Severity
  page?: string
  action?: string
  route?: string
  meta?: Record<string, any>
  user?: LogUser

  /**
   * If true, we try to dedupe identical errors (same fingerprint)
   * and increment count instead of spamming many docs.
   */
  dedupe?: boolean
}

const MAX_STACK = 6000
const MAX_MESSAGE = 800

const safeString = (v: any, max = 500) => {
  const s = String(v ?? '')
  return s.length > max ? s.slice(0, max) + '…' : s
}

const toErrorParts = (err: unknown) => {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: safeString(err.message, MAX_MESSAGE),
      stack: safeString(err.stack || '', MAX_STACK)
    }
  }

  // Firestore/Firebase sometimes throws objects
  const anyErr = err as any
  return {
    name: safeString(anyErr?.name || 'UnknownError'),
    message: safeString(anyErr?.message || anyErr?.toString?.() || 'Unknown error', MAX_MESSAGE),
    stack: safeString(anyErr?.stack || '', MAX_STACK),
    code: safeString(anyErr?.code || '')
  }
}

const buildFingerprint = (p: {
  name?: string
  message: string
  route?: string
  action?: string
}) => {
  // Good enough without adding crypto deps
  const base = `${p.name || ''}|${p.message}|${p.route || ''}|${p.action || ''}`
  let hash = 0
  for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0
  return `err_${hash.toString(16)}`
}

/**
 * Log an error into Firestore systemErrors.
 * Safe-by-default (trims strings and keeps meta shallow).
 */
export const logSystemError = async (err: unknown, opts: LogOptions = {}) => {
  try {
    const { name, message, stack, code } = toErrorParts(err)
    const route =
      opts.route ||
      (typeof window !== 'undefined' ? window.location.pathname : undefined)

    const fingerprint = buildFingerprint({ name, message, route, action: opts.action })

    const payload = {
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      env: import.meta?.env?.MODE || process.env.NODE_ENV || 'unknown',
      severity: opts.severity || 'error',

      name,
      message,
      stack,
      code: code || undefined,

      route,
      page: opts.page,
      action: opts.action,
      user: {
        uid: opts.user?.uid || undefined,
        email: opts.user?.email || undefined,
        role: opts.user?.role || undefined
      },

      meta: opts.meta ? sanitizeMeta(opts.meta) : undefined,
      fingerprint,
      count: 1
    }

    if (!opts.dedupe) {
      await addDoc(collection(db, 'systemErrors'), payload)
      return
    }

    // Dedupe mode: store by fingerprint id
    const ref = doc(db, 'systemErrors', fingerprint)
    const snap = await getDoc(ref)

    if (!snap.exists()) {
      await setDoc(ref, payload)
      return
    }

    const prev = snap.data() as any
    await setDoc(
      ref,
      {
        ...payload,
        // keep original createdAt if exists
        createdAt: prev.createdAt || payload.createdAt,
        count: (prev.count || 1) + 1
      },
      { merge: true }
    )
  } catch {
    // Never let logging crash the app.
  }
}

const sanitizeMeta = (meta: Record<string, any>) => {
  // keep it shallow + serializable to avoid huge payloads
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map(x => (typeof x === 'object' ? '[obj]' : x))
    else if (typeof v === 'object') out[k] = '[obj]'
    else out[k] = String(v)
  }
  return out
}

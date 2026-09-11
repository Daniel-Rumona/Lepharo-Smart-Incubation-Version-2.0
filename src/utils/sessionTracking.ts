import { db } from "@/firebase"
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore"

type StartSessionInput = {
  uid: string
  email?: string | null
  role?: string

  provider: "password" | "google"
}

const SS_KEY = "sip_session_id" // sessionStorage (per-tab)

export function getSessionId() {
  return sessionStorage.getItem(SS_KEY)
}

export async function startSession(input: StartSessionInput) {
  const existing = sessionStorage.getItem(SS_KEY)
  if (existing) return existing

  const ref = await addDoc(collection(db, "userSessions"), {
    uid: input.uid,
    email: input.email ?? null,
    role: input.role ?? "unknown",
    provider: input.provider,
    userAgent: navigator.userAgent,
    startedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp()
  })

  sessionStorage.setItem(SS_KEY, ref.id)
  return ref.id
}

export async function pingSession() {
  const sessionId = sessionStorage.getItem(SS_KEY)
  if (!sessionId) return

  await updateDoc(doc(db, "userSessions", sessionId), {
    lastSeenAt: serverTimestamp()
  })
}

export async function endSession(reason: "logout" | "forced" = "logout") {
  const sessionId = sessionStorage.getItem(SS_KEY)
  if (!sessionId) return

  await updateDoc(doc(db, "userSessions", sessionId), {
    endedAt: serverTimestamp(),
    endReason: reason,
    lastSeenAt: serverTimestamp()
  })

  sessionStorage.removeItem(SS_KEY)
}

export function clearLocalSessionId() {
  sessionStorage.removeItem(SS_KEY)
}

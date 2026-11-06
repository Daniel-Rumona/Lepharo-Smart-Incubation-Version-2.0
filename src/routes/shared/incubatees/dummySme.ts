import { message } from 'antd'
import { collection, getDocs, query, where, doc, getDoc, addDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { faker } from '@faker-js/faker/locale/en_ZA'
import { auth, db, functions } from '@/firebase'
import { CREATE_USER_URL, SA_PROVINCES, SA_SECTORS, SmeRow } from './participantsData'

// Dummy SMEs are internal (@quantilytix.co.za) test records added straight under a programme.

export type DummySmeDetails = {
    contactPerson: string
    email: string
    businessName: string
    phone?: string
    province?: string
    town?: string
    sector?: string
    gender?: string
}

export type DummySmeProgramMeta = {
    programId: string
    programName: string | null
    branchId: string | null
    branchName: string | null
}

export const generateRandomSaSme = (): DummySmeDetails => {
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    const contactPerson = `${firstName} ${lastName}`
    const slug = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, '')
    const email = `${slug}+dummy${Date.now().toString(36)}${faker.number.int({ min: 100, max: 999 })}@quantilytix.co.za`
    const businessName = `${faker.company.name()} ${faker.helpers.arrayElement(['(Pty) Ltd', 'CC', 'Enterprises', 'Trading'])}`
    const phone = `0${faker.number.int({ min: 60, max: 84 })}${faker.string.numeric(7)}`
    const province = faker.helpers.arrayElement(SA_PROVINCES)
    const town = faker.location.city()
    const sector = faker.helpers.arrayElement(SA_SECTORS)
    const gender = faker.helpers.arrayElement(['Male', 'Female'])

    return { contactPerson, email, businessName, phone, province, town, sector, gender }
}

export const resolveActiveProgramMeta = async (activeProgramId: string | null | undefined): Promise<DummySmeProgramMeta> => {
    if (!activeProgramId) throw new Error('Select a specific program before adding a dummy SME.')

    const programSnap = await getDoc(doc(db, 'programs', activeProgramId))
    if (!programSnap.exists()) throw new Error('Selected program could not be found.')

    const programData = programSnap.data() as any

    return {
        programId: activeProgramId,
        programName: programData.name || programData.programName || null,
        branchId: programData.assignedBranch?.id || programData.branchId || null,
        branchName: programData.assignedBranch?.name || programData.branchName || null
    }
}

export const createDummySmeRecord = async (details: DummySmeDetails, programMeta: DummySmeProgramMeta) => {
    // Give the dummy SME a real login so it can be used to walk the diagnostic
    // plan/roadmap confirmation flow from the incubatee side, same as a real applicant.
    let authUid: string | null = null
    try {
        const idToken = await auth.currentUser?.getIdToken()
        if (idToken) {
            const resp = await fetch(CREATE_USER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    email: details.email,
                    role: 'incubatee',
                    name: details.contactPerson,
                    phone: details.phone || null,
                    mustRegister: true,
                    allowExisting: true,
                    sendEmail: true,
                    sendResetLink: true
                })
            })

            const data = await resp.json().catch(() => null)
            authUid = data?.uid || data?.user?.uid || null

            if (!resp.ok || !authUid) {
                console.warn('createPlatformUser did not return a uid for dummy SME:', data)
            }
        }
    } catch (err) {
        console.warn('createPlatformUser failed for dummy SME (continuing without login):', err)
    }

    const participantRef = await addDoc(collection(db, 'participants'), {
        participantName: details.contactPerson,
        email: details.email,
        beneficiaryName: details.contactPerson,
        gender: details.gender || null,
        phone: details.phone || null,
        sector: details.sector || null,
        province: details.province || null,
        town: details.town || null,
        city: details.town || null,
        businessAddress: [details.town, details.province].filter(Boolean).join(', ') || null,
        programId: programMeta.programId,
        programName: programMeta.programName,
        branchId: programMeta.branchId,
        branchName: programMeta.branchName,
        uid: authUid,
        setup: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    })

    await addDoc(collection(db, 'applications'), {
        participantId: participantRef.id,
        programId: programMeta.programId,
        programName: programMeta.programName,
        branchId: programMeta.branchId,
        branchName: programMeta.branchName,
        applicationStatus: 'accepted',
        beneficiaryName: details.contactPerson,
        companyName: details.businessName,
        businessName: details.businessName,
        gender: details.gender || null,
        province: details.province || null,
        town: details.town || null,
        email: details.email,
        uid: authUid,
        acceptedAt: serverTimestamp(),
        submittedAt: new Date().toISOString(),
        manuallyCreated: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    })

    return { authUid }
}

/** Removes a dummy SME's login, application, participant, interventions and diagnostic plans. Resolves true on success. */
export const deleteDummySme = async (row: SmeRow): Promise<boolean> => {
    try {
        let authUid: string | null = null
        if (row.participantId) {
            const participantSnap = await getDoc(doc(db, 'participants', row.participantId))
            authUid = participantSnap.exists() ? (participantSnap.data() as any)?.uid || null : null
        }

        if (authUid && row.email) {
            try {
                const deleteUserCascade = httpsCallable(functions, 'deleteUserCascade')
                await deleteUserCascade({ email: row.email, uid: authUid, confirm: true })
            } catch (err) {
                console.warn('deleteUserCascade failed for dummy SME (continuing with doc cleanup):', err)
            }
        }

        const batch = writeBatch(db)
        batch.delete(doc(db, 'applications', row.appId))
        if (row.participantId) batch.delete(doc(db, 'participants', row.participantId))

        if (row.participantId) {
            const interventionsSnap = await getDocs(
                query(collection(db, 'assignedInterventions'), where('participantId', '==', row.participantId))
            )
            interventionsSnap.forEach(interventionDoc => batch.delete(interventionDoc.ref))

            const dpSnap = await getDocs(
                query(collection(db, 'diagnosticPlans'), where('participantId', '==', row.participantId))
            )
            dpSnap.forEach(dpDoc => batch.delete(dpDoc.ref))
        }

        await batch.commit()
        message.success('Dummy SME deleted.')
        return true
    } catch (error) {
        console.error(error)
        message.error('Failed to delete dummy SME.')
        return false
    }
}

// utils/firebaseLogo.ts
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db } from '@/firebase'
import { getStorage } from 'firebase/storage'

export const uploadCompanyLogo = async (file: File, companyCode: string) => {
  const storage = getStorage()
  const path = `logos/${companyCode}/${file.name}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file)
  const downloadUrl = await getDownloadURL(storageRef)
  await setDoc(doc(db, 'logos', companyCode), { logoUrl: downloadUrl }, { merge: true })
  return downloadUrl
}

export const getCompanyLogoUrl = async (companyCode: string): Promise<string | null> => {
  const logoDoc = await getDoc(doc(db, 'logos', companyCode))
  return logoDoc.exists() ? logoDoc.data().logoUrl || null : null
}

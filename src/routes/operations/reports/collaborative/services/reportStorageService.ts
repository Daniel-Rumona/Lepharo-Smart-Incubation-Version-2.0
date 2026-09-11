import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage'
import { REPORT_STORAGE_ROOT } from '../reportConfig'

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-')

export const uploadReportTemplateSource = async (
  storage: FirebaseStorage,
  templateId: string,
  file: File
) => {
  const path = `${REPORT_STORAGE_ROOT}/templates/${templateId}/source/${Date.now()}-${safeName(file.name)}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })
  const url = await getDownloadURL(storageRef)
  return { name: file.name, path, url, size: file.size }
}

export const uploadReportBlockAttachment = async (
  storage: FirebaseStorage,
  reportId: string,
  blockId: string,
  file: File
) => {
  const path = `${REPORT_STORAGE_ROOT}/reports/${reportId}/blocks/${blockId}/${Date.now()}-${safeName(file.name)}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, { contentType: file.type || undefined })
  const url = await getDownloadURL(storageRef)
  return { name: file.name, path, url, size: file.size }
}

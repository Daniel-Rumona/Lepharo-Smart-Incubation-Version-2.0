// src/utils/generateContractPdf.ts
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage'

type GenParams = {
  participantId: string
  slug: string               // e.g. "popia-act"
  title: string              // title shown on PDF
  contentEl: HTMLElement     // the contract body container
  signerName: string
  signatureUrl?: string      // visual signature image (users.signatureURL)
  digitalSignature?: string  // cryptographic signature string (participants.digitalSignature)
}

async function renderPagedContractPDF(contentEl: HTMLElement) {
  const pages = Array.from(
    contentEl.querySelectorAll<HTMLElement>('[data-contract-page]')
  )
  if (!pages.length) return null

  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = pages[index].getAttribute('data-contract-page') || String(index + 1)
    const canvas = await html2canvas(pages[index], {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      windowWidth: 1100,
      onclone: clonedDocument => {
        const clonedPage = clonedDocument.querySelector<HTMLElement>(
          `[data-contract-page="${pageNumber}"]`
        )
        if (clonedPage) {
          clonedPage.style.width = '794px'
          clonedPage.style.maxWidth = 'none'
        }
      }
    })
    if (index > 0) pdf.addPage()
    const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
    const renderedWidth = canvas.width * scale
    const renderedHeight = canvas.height * scale
    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      (pageWidth - renderedWidth) / 2,
      0,
      renderedWidth,
      renderedHeight
    )
  }

  return pdf
}

/** Read a Blob as data URL */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

/** Resolve Firebase Storage URL/path (gs:// or 'path/to.png') to HTTPS URL; pass through data: and https: */
async function resolveToHttpUrl(url?: string): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:')) return url
  const storage = getStorage()

  // gs://bucket/...  -> use ref(storage, url)
  if (url.startsWith('gs://')) {
    try {
      const r = ref(storage, url)
      return await getDownloadURL(r)
    } catch {
      return null
    }
  }

  // Bare storage path like 'signatures/uid.png'
  if (!/^https?:\/\//i.test(url)) {
    try {
      const r = ref(storage, url)
      return await getDownloadURL(r)
    } catch {
      return null
    }
  }

  // Already http(s)
  return url
}

/** Load any image URL (http(s) or data:) and return a PNG data URL suitable for jsPDF.addImage('PNG', ...) */
async function toPngDataUrl(srcUrl: string): Promise<string | null> {
  // If already a data URL:
  if (srcUrl.startsWith('data:')) {
    // If it's PNG, great; if JPEG/WEBP/SVG, render to canvas first
    const isPng = /^data:image\/png/i.test(srcUrl)
    if (isPng) return srcUrl
    try {
      const img = await loadImage(srcUrl)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return canvas.toDataURL('image/png')
    } catch {
      return null
    }
  }

  // Otherwise fetch the resource and normalize to PNG via canvas
  try {
    const res = await fetch(srcUrl, { cache: 'no-store' })
    if (!res.ok) return null
    const blob = await res.blob()
    // Some Storage configs serve as application/octet-stream but are valid images.
    // Create an object URL and render to canvas to ensure it's a real bitmap.
    const objUrl = URL.createObjectURL(blob)
    try {
      const img = await loadImage(objUrl)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return canvas.toDataURL('image/png')
    } finally {
      URL.revokeObjectURL(objUrl)
    }
  } catch {
    return null
  }
}

/** Load an image element (works for http(s) or data: or object URLs) */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Important for cross-origin images drawn to canvas:
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export async function generateAndUploadContractPDF({
  participantId, slug, title, contentEl, signerName, signatureUrl, digitalSignature
}: GenParams) {
  const pagedPdf = await renderPagedContractPDF(contentEl)
  if (pagedPdf) {
    const storage = getStorage()
    const path = `agreements/${participantId}/${slug}_${Date.now()}.pdf`
    const sref = ref(storage, path)
    await uploadString(sref, pagedPdf.output('datauristring'), 'data_url')
    return { url: await getDownloadURL(sref), path }
  }

  // 1) Render contract HTML to canvas
  const canvas = await html2canvas(contentEl, {
    scale: 2,
    useCORS: true,          // try to load cross-origin images
    allowTaint: false       // safer; avoid tainted canvas when possible
  })
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  // Title
  pdf.setFontSize(16)
  pdf.text(title, 14, 16)

  // 2) Contract content across pages
  const imgWidth = pageWidth - 28
  const imgHeight = (canvas.height * imgWidth) / canvas.width
  let remaining = imgHeight
  let srcY = 0
  const pagePxHeight = (canvas.width * (pageHeight - 40)) / imgWidth // px height per page slice
  let firstPage = true

  while (remaining > 0) {
    const sliceHeight = Math.min(pagePxHeight, remaining)
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvas.width
    pageCanvas.height = Math.max(1, Math.floor(sliceHeight)) // avoid fractional heights
    const ctx = pageCanvas.getContext('2d')!
    ctx.drawImage(
      canvas,
      0, Math.floor(srcY), canvas.width, pageCanvas.height,
      0, 0, pageCanvas.width, pageCanvas.height
    )
    const pageImg = pageCanvas.toDataURL('image/png')
    if (!firstPage) pdf.addPage()
    pdf.addImage(
      pageImg,
      'PNG',
      14,
      22,
      imgWidth,
      (pageCanvas.height * imgWidth) / canvas.width
    )
    remaining -= pageCanvas.height
    srcY += pageCanvas.height
    firstPage = false
  }

  // 3) Signature page
  pdf.addPage()
  pdf.setFontSize(14)
  pdf.text('Electronic Signatures', 14, 20)

  pdf.setFontSize(11)
  pdf.text(`Signed by: ${signerName}`, 14, 30)
  pdf.text(`Date: ${new Date().toLocaleString()}`, 14, 38)

  // Try to embed visual signature robustly
  let visualSigAdded = false
  if (signatureUrl) {
    try {
      const httpUrl = await resolveToHttpUrl(signatureUrl)
      if (httpUrl) {
        const sigPng = await toPngDataUrl(httpUrl)
        if (sigPng) {
          pdf.text('Visual Signature:', 14, 46)
          pdf.addImage(sigPng, 'PNG', 14, 50, 60, 20)
          visualSigAdded = true
        }
      }
    } catch {
      // noop – handled below
    }
  }
  if (!visualSigAdded) {
    pdf.text('Visual Signature: (not available)', 14, 46)
  }

  pdf.text('Cryptographic Signature (hash):', 14, 78)
  pdf.setFont('courier', 'normal')
  pdf.text(digitalSignature ? digitalSignature : '(not provided)', 14, 84, { maxWidth: pageWidth - 28 })
  pdf.setFont('helvetica', 'normal')

  pdf.text('This document was electronically accepted by the signer above.', 14, 112)

  // 4) upload to Storage
  const storage = getStorage()
  const path = `agreements/${participantId}/${slug}_${Date.now()}.pdf`
  const sref = ref(storage, path)
  const pdfData = pdf.output('datauristring') // data:application/pdf;base64,...
  await uploadString(sref, pdfData, 'data_url')
  const url = await getDownloadURL(sref)

  return { url, path }
}

export async function downloadContractPDF(
  contentEl: HTMLElement,
  fileName: string
) {
  const pdf = await renderPagedContractPDF(contentEl)
  if (!pdf) throw new Error('No document pages were found to download.')
  pdf.save(fileName)
}

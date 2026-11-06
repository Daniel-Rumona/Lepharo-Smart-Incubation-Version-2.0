import dayjs from 'dayjs'
import { saveAs } from 'file-saver'
import { Packer } from 'docx'
import { buildConsolidatedDoc, buildMovDoc } from '@/docx/movBuilder'
import { programBranding, resolveMovCompletionDate, safeToDate, type Mov, type Pack } from './movData'

const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')
const safeName = (s: unknown) => String(s || '').replace(/[^\w-]+/g, '_').slice(0, 40)

/** One MOV's confirmation sheet as Word, with its programme's funder branding. */
export const downloadMovDoc = async (mov: Mov, activeProgramId?: string | null) => {
    const docx = await buildMovDoc(mov, {
        lepharoUrl: `${origin()}/assets/images/lepharo.png`,
        ...(await programBranding(mov.programId || activeProgramId)),
        headerTop: 'CONFIRMATION SHEET FOR RECEIVING',
        headerSub: String(mov.interventionTitle || '').trim() || '(MOV)',
        officeDept: mov.officeAreaName || 'Department'
    })
    const when = resolveMovCompletionDate(mov) || safeToDate(mov.interventionDate)
    saveAs(await Packer.toBlob(docx), `CONFIRMATION-${safeName(mov.smmeCompanyName || 'SMME')}${when ? `-${dayjs(when).format('YYYYMMDD')}` : ''}.docx`)
}

/** A verified monthly pack as one Word document. */
export const downloadPackDoc = async (pack: Pack, activeProgramId?: string | null) => {
    const docx = await buildConsolidatedDoc(pack, {
        lepharoUrl: `${origin()}/assets/images/lepharo.png`,
        ...(await programBranding(pack.programId || activeProgramId)),
        deptName: pack.department || 'Department'
    })
    saveAs(await Packer.toBlob(docx), `CONSOLIDATED-${safeName(pack.department || 'Dept')}-${pack.month}.docx`)
}

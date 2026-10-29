

export const MOA_KEYWORD_HEADING = /^(ARBITRATION|GENERAL|RELATIONSHIP|WAIVER|AMENDMENTS?|INDULGENCES|CESSION AND DELEGATION|SEVERABILITY|NON-SOLICITATION|FORCE MAJEURE|GOOD FAITH|DUPLICATE ORIGINALS|COOPERATION|LIMITATION OF LIABILITY)\b/i

export const moaRomSignature = (meta: any) =>
    meta?.romSignatureURL || meta?.romSignatureUrl || ''

export const moaParticipantSignature = (meta: any) => {
    const explicit =
        meta?.participantSignatureURL || meta?.participantSignatureUrl ||
        meta?.smmeSignatureURL || meta?.smmeSignatureUrl
    if (explicit) return explicit
    const generic =
        meta?.signatureURL || meta?.signatureUrl || meta?.userSignatureURL ||
        meta?.userSignatureUrl || meta?.signer?.signatureURL || meta?.signer?.signatureUrl
    return generic && generic !== moaRomSignature(meta) ? generic : ''
}

export const renderStyledMoaPage = (page: string, pageIndex: number) => (
    <div className={pageIndex === 0 ? 'moa-preview-cover' : 'moa-preview-copy'}>
        {page.split(/\r?\n/).map((line, lineIndex) => {
            const text = line.trim()
            if (!text) return <div key={lineIndex} className='moa-preview-spacer' />

            if (pageIndex === 0) {
                const emphasized =
                    lineIndex === 0 ||
                    text === 'AND' ||
                    text.startsWith('LEPHARO INCUBATION PROGRAMME') ||
                    /^[A-Z0-9 &().-]{5,}$/.test(text)
                return <p key={lineIndex} className={lineIndex === 0 ? 'moa-preview-cover-title' : undefined}>
                    {emphasized ? <strong>{text}</strong> : text}
                </p>
            }

            const mainClause = /^(\d+)\.?\s+(.*)$/.exec(text)
            if (mainClause) {
                return <p key={lineIndex} className='moa-preview-heading moa-preview-heading--1'>
                    {text}
                </p>
            }

            if (/^\d+(?:\.\d+)+\s+/.test(text)) {
                return <p key={lineIndex} className='moa-preview-paragraph moa-preview-subclause'>{text}</p>
            }

            if (MOA_KEYWORD_HEADING.test(text) || text === 'NOW, THEREFORE THE PARTIES AGREE AS FOLLOWS:') {
                return <p key={lineIndex} className='moa-preview-heading moa-preview-heading--2'>{text}</p>
            }

            const definition = /^(\s*(?:\d+(?:\.\d+){1,4}\s+)?)((?:“|\")[A-Z][A-Z\s/-]+(?:”|\"))(.*)$/.exec(line)
            if (definition) {
                return <p key={lineIndex} className='moa-preview-paragraph'>
                    {definition[1]}<strong>{definition[2]}</strong>{definition[3]}
                </p>
            }

            return <p key={lineIndex} className='moa-preview-paragraph'>{line}</p>
        })}
    </div>
)

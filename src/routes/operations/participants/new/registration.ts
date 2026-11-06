/** CIPC registration helpers: no Firebase, so the Excel importer can use (and test) them anywhere. */

/** CIPC formats: 2017/216465/07, K2017/216465/07, CK2017/…, IT1234/2020. */
export const isValidZARegistration = (raw: string): boolean => {
    const v = (raw || '').toUpperCase().replace(/\s+/g, '')
    return [/^K\d{4}\/\d{6}\/\d{2}$/, /^\d{4}\/\d{6}\/\d{2}$/, /^CK\d{4}\/\d{6}\/\d{2}$/, /^IT\d{4}\/\d{6}$/].some(re => re.test(v))
}

export const normaliseRegistration = (raw: string) => (raw || '').toUpperCase().replace(/\s+/g, '')

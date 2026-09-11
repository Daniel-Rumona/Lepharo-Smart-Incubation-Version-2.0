import dayjs from "dayjs"

export const toDateStr = (d: any): string => {
    if (!d) return ''

    // ✅ Already a Dayjs object
    if (dayjs.isDayjs(d)) return d.format('YYYY-MM-DD')

    // ✅ Firestore Timestamp (has toDate())
    if (typeof d?.toDate === 'function')
      return dayjs(d.toDate()).format('YYYY-MM-DD')

    // ✅ Plain JS Date object
    if (d instanceof Date && !isNaN(d.getTime()))
      return dayjs(d).format('YYYY-MM-DD')

    // ✅ Numeric timestamp (milliseconds or seconds)
    if (typeof d === 'number') {
      const ts = d > 1e12 ? d : d * 1000 // auto-detect seconds vs ms
      return dayjs(ts).format('YYYY-MM-DD')
    }

    // ✅ String (ISO or parseable)
    if (typeof d === 'string') {
      const parsed = dayjs(d)
      return parsed.isValid() ? parsed.format('YYYY-MM-DD') : d
    }

    return 'Invalid Date'
  }

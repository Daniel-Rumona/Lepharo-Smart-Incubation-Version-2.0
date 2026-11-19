import type { TrainingEnrollment } from './trainingStorage'

/** Legacy enrollments may contain one row per person from the same company. */
export const trainingCompanyKey = (enrollment: Pick<TrainingEnrollment, 'id' | 'companyName'>) => {
    const name = String(enrollment.companyName || '').trim().replace(/\s+/g, ' ').toLowerCase()
    return name ? `company:${name}` : `enrollment:${enrollment.id}`
}

export const countTrainingCompanies = (enrollments: Pick<TrainingEnrollment, 'id' | 'companyName'>[]) =>
    new Set(enrollments.map(trainingCompanyKey)).size

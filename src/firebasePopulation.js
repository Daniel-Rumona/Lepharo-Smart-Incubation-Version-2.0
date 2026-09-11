// seedLPH.js using Admin SDK
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { faker } from '@faker-js/faker/locale/en_ZA'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const serviceAccount = require('./serviceAccountKey.json')

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: 'incubation-platform-61610'
  })
}

const db = getFirestore()
const auth = getAuth()

const companyCode = 'LPH'
const program = { id: 'startup-boost-001', name: 'Startup Boost' }
const mainDeptId = 'main-dept-1'
const nonMainDeptId = 'nonmain-dept-2'

const sectors = ['Manufacturing', 'ICT', 'Retail']
const provinces = ['Gauteng', 'Limpopo', 'Eastern Cape']
const hubs = ['Tshwane', 'Ekurhuleni']

const createUserAndSave = async (email, name, role, companyCode = '') => {
  const password = 'Password@1'
  const userRecord = await auth.createUser({ email, password })
  await db.collection('users').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email,
    name,
    role,
    companyCode,
    createdAt: Timestamp.now()
  })
  return { uid: userRecord.uid, email, name, role, companyCode }
}

const seedLPH = async () => {
  console.log('🌱 Seeding LPH departments and kpis')

  //   // Consultants
  //   for (let i = 0; i < 2; i++) {
  //     const name = faker.person.fullName()
  //     const email = faker.internet.email({
  //       firstName: name.split(' ')[0],
  //       lastName: name.split(' ')[1],
  //       provider: 'lph.co.za'
  //     })
  //     const user = await createUserAndSave(email, name, 'consultant', companyCode)

  //     await db.collection('consultants').add({
  //       name,
  //       email,
  //       rate: 400,
  //       expertise: ['Marketing'],
  //       assignmentsCount: 0,
  //       rating: 0,
  //       active: true,
  //       companyCode,
  //       authUid: user.uid
  //     })
  //   }

  //   // Operations Staff
  //   const opsRoles = ['M&E Lead', 'Operations Officer']
  //   const deptIDs = [mainDeptId, nonMainDeptId]
  //   for (let i = 0; i < 2; i++) {
  //     const name = faker.person.fullName()
  //     const email = faker.internet.email({
  //       firstName: name.split(' ')[0],
  //       lastName: name.split(' ')[1],
  //       provider: 'lph.co.za'
  //     })
  //     const user = await createUserAndSave(email, name, 'operations', companyCode)

  //     await db.collection('operationsStaff').add({
  //       name,
  //       email,
  //       phone: faker.phone.number('082#######'),
  //       gender: i % 2 === 0 ? 'Female' : 'Male',
  //       role: opsRoles[i],
  //       departmentID: deptIDs[i],
  //       companyCode,
  //       createdAt: Timestamp.now()
  //     })
  //   }

  //   // Participants & Applications
  //   for (let i = 0; i < 5; i++) {
  //     const name = faker.person.fullName()
  //     const email = faker.internet.email({
  //       firstName: name.split(' ')[0],
  //       lastName: name.split(' ')[1],
  //       provider: 'lphsme.co.za'
  //     })
  //     const user = await createUserAndSave(
  //       email,
  //       name,
  //       'participant',
  //       companyCode
  //     )

  //     await db.collection('participants').add({
  //       ownerName: name,
  //       email,
  //       companyCode,
  //       beneficiaryName: `Lepharo SME ${faker.company.name()}`,
  //       sector: faker.helpers.arrayElement(sectors),
  //       province: faker.helpers.arrayElement(provinces),
  //       stage: 'Startup',
  //       yearsOfTrading: faker.number.int({ min: 1, max: 3 }),
  //       location: 'Urban',
  //       city: faker.location.city(),
  //       hub: faker.helpers.arrayElement(hubs),
  //       blackOwnedPercent: 100,
  //       beeLevel: faker.number.int({ min: 1, max: 4 }),
  //       registrationNumber: `REG-LPH-${i + 1}`,
  //       dateOfRegistration: Timestamp.now(),
  //       revenueHistory: {
  //         lastThreeMonths: faker.number.int({ min: 50000, max: 150000 }),
  //         lastTwoYears: faker.number.int({ min: 300000, max: 1500000 })
  //       },
  //       employeeHistory: {
  //         lastThreeMonths: faker.number.int({ min: 1, max: 10 }),
  //         lastTwoYears: faker.number.int({ min: 2, max: 30 })
  //       },
  //       interventions: { required: [], assigned: [], completed: [] }
  //     })

  //     await db.collection('applications').add({
  //       participantId: user.uid,
  //       programName: program.name,
  //       programId: program.id,
  //       companyCode,
  //       applicationStatus: 'pending',
  //       submittedAt: Timestamp.now(),
  //       beneficiaryName: `Lepharo SME ${faker.company.name()}`,
  //       gender: i % 2 === 0 ? 'Male' : 'Female',
  //       ageGroup: 'Adult',
  //       stage: 'Startup',
  //       province: faker.helpers.arrayElement(provinces),
  //       email,
  //       complianceScore: faker.number.int({ min: 50, max: 100 }),
  //       interventions: { required: [], assigned: [], completed: [] },
  //       aiEvaluation: {
  //         'Recommended Interventions': 'Financial Literacy, Branding Support',
  //         'AI Score': faker.number.int({ min: 55, max: 95 }),
  //         'AI Recommendation': 'Eligible',
  //         Justification: 'Meets program minimums'
  //       },
  //       growthPlanDocUrl: ''
  //     })
  //   }

  //   const departments = [
  //     {
  //       id: 'main-dept-1',
  //       name: 'Operations Department',
  //       isMain: true,
  //       companyCode,
  //       createdAt: Timestamp.now()
  //     },
  //     {
  //       id: 'nonmain-dept-2',
  //       name: 'Legal Advisory Services',
  //       isMain: false,
  //       companyCode,
  //       createdAt: Timestamp.now()
  //     }
  //   ]

  //   const kpiDefinitions = [
  //     {
  //       id: 'kpi-legal-1',
  //       department: 'Legal Advisory Services',
  //       kpiLabel: 'Legal Consultations Held',
  //       unit: 'count',
  //       target: 20,
  //       manualTags: ['compliance', 'Q1'],
  //       createdAt: Timestamp.now(),
  //       active: true
  //     },
  //     {
  //       id: 'kpi-legal-2',
  //       department: 'Legal Advisory Services',
  //       kpiLabel: 'Compliance Workshops Facilitated',
  //       unit: 'count',
  //       target: 5,
  //       manualTags: ['training', 'Q2'],
  //       createdAt: Timestamp.now(),
  //       active: true
  //     },
  //     {
  //       id: 'kpi-ops-1',
  //       department: 'Operations Department',
  //       kpiLabel: 'Applications Processed',
  //       unit: 'count',
  //       target: 100,
  //       manualTags: ['M&E', 'admin'],
  //       createdAt: Timestamp.now(),
  //       active: true
  //     },
  //     {
  //       id: 'kpi-ops-2',
  //       department: 'Operations Department',
  //       kpiLabel: 'Reports Submitted on Time',
  //       unit: 'percent',
  //       target: 95,
  //       manualTags: ['efficiency', 'timeliness'],
  //       createdAt: Timestamp.now(),
  //       active: true
  //     }
  //   ]

  //   // Add Departments
  //   for (const dept of departments) {
  //     const ref = db.collection('departments').doc(dept.id)
  //     await ref.set(dept)
  //     console.log(`🏢 Department added: ${dept.name}`)
  //   }

  //   // Add KPI Definitions
  //   for (const kpi of kpiDefinitions) {
  //     const ref = db.collection('kpiDefinitions').doc(kpi.id)
  //     await ref.set(kpi)
  //     console.log(`📊 KPI added: ${kpi.kpiLabel}`)
  //   }

  //   const reportMonths = ['2024-07', '2024-08', '2024-09']
  const userId = 'system' // or use an actual UID if preferred

  //   const kpiEntryTemplates = [
  //     {
  //       kpiId: 'kpi-legal-1',
  //       department: 'Legal Advisory Services',
  //       kpiLabel: 'Legal Consultations Held',
  //       unit: 'count',
  //       target: 20
  //     },
  //     {
  //       kpiId: 'kpi-legal-2',
  //       department: 'Legal Advisory Services',
  //       kpiLabel: 'Compliance Workshops Facilitated',
  //       unit: 'count',
  //       target: 5
  //     },
  //     {
  //       kpiId: 'kpi-ops-1',
  //       department: 'Operations Department',
  //       kpiLabel: 'Applications Processed',
  //       unit: 'count',
  //       target: 100
  //     },
  //     {
  //       kpiId: 'kpi-ops-2',
  //       department: 'Operations Department',
  //       kpiLabel: 'Reports Submitted on Time',
  //       unit: 'percent',
  //       target: 95
  //     }
  //   ]

  //   for (const template of kpiEntryTemplates) {
  //     for (const month of reportMonths) {
  //       const value =
  //         template.unit === 'percent'
  //           ? faker.number.int({ min: 70, max: 100 })
  //           : faker.number.int({
  //               min: template.target - 5,
  //               max: template.target + 10
  //             })

  //       await db.collection('kpiEntries').add({
  //         kpiId: template.kpiId,
  //         department: template.department,
  //         reportMonth: month,
  //         value,
  //         unit: template.unit,
  //         kpiLabel: template.kpiLabel,
  //         tags: ['seeded'],
  //         createdAt: Timestamp.now(),
  //         submittedBy: userId
  //       })

  //       console.log(`📈 Seeded KPI entry for ${template.kpiLabel} (${month})`)
  //     }
  //   }

  //   console.log('✅ LPH Seeding Complete')
  // }
  // Define department-specific interventions

  const interventionsList = [
    {
      title: 'Company Registration Support',
      description: 'Assist with formal registration and CIPC filing.',
      department: 'Legal Advisory Services'
    },
    {
      title: 'Contract Drafting Training',
      description: 'Teach basic contract terms and risk awareness.',
      department: 'Legal Advisory Services'
    },
    {
      title: 'SME Application Review',
      description: 'Help review and process startup applications.',
      department: 'Operations Department'
    },
    {
      title: 'Report Writing Bootcamp',
      description: 'Workshop on effective operational reporting.',
      department: 'Operations Department'
    }
  ]

  // Add interventions
  const interventionIds = {
    'Legal Advisory Services': [],
    'Operations Department': []
  }

  for (const intervention of interventionsList) {
    const ref = await db.collection('interventions').add({
      ...intervention,
      tags: ['seeded'],
      active: true,
      createdAt: Timestamp.now(),
      createdBy: userId,
      companyCode
    })
    interventionIds[intervention.department].push(ref.id)
    console.log(`🛠️ Intervention added: ${intervention.title}`)
  }

  // Assign relevant interventions to participants based on department
  const participantsSnap = await db
    .collection('participants')
    .where('companyCode', '==', companyCode)
    .get()

  const half = Math.ceil(participantsSnap.docs.length / 2)
  const legalInterventions = interventionIds['Legal Advisory Services']
  const opsInterventions = interventionIds['Operations Department']

  for (let i = 0; i < participantsSnap.docs.length; i++) {
    const doc = participantsSnap.docs[i]
    const isLegal = i >= half // Half go to Legal, half to Ops
    const department = isLegal
      ? 'Legal Advisory Services'
      : 'Operations Department'
    const required = isLegal ? legalInterventions : opsInterventions

    await doc.ref.update({
      department,
      interventions: {
        required,
        assigned: [],
        completed: []
      }
    })

    console.log(
      `👤 Participant ${doc.id} assigned to ${department} with interventions:`,
      required
    )
  }
}

seedLPH().catch(console.error)

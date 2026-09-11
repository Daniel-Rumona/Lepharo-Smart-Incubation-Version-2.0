// src/contracts/moa.pages.ts
import dayjs from "dayjs";
import {
    AlignmentType,
    BorderStyle,
    Document,
    Header,
    Footer,
    HeightRule,
    ImageRun,
    Packer,
    Paragraph,
    Table as DTable,
    TableCell as DCell,
    TableLayoutType,
    TableRow as DRow,
    TextRun,
    WidthType,
    HeadingLevel,
    TableOfContents,
    VerticalAlign,
    PageNumber,
  } from "docx";

import { saveAs } from "file-saver";

/** ────────────────────────────────────────────────────────────────────────────
 *  Types
 *  ──────────────────────────────────────────────────────────────────────────── */
export type MoaVars = {
  // Incubatee (company)
  beneficiaryName: string;
  registrationNumber: string;

  // Representative / participant
  participantName: string;
  idNumber: string;

  // Address used in clause 1.8.2
  businessAddress: string;
  contactNumber: string;
  email: string;

  // Dates (from program collection)
  effectiveDate: string;     // program.startDate
  graduationDate: string;    // program.endDate
  postGraduationEndDate?: string; // default = grad + 2y
};

export type HeaderMeta = {
  centerTitle?: string;  // default: "INCUBATION MEMORANDUM OF AGREEMENT"
  formNo?: string;       // e.g. "LEP QMS 074.1 F"
  revisionNo?: string;   // e.g. "0"
  effectiveDate?: string; // e.g. "01 October 2020"
};

const F = (s: string) => s;

/** ────────────────────────────────────────────────────────────────────────────
 *  Contract text for UI (continuous page in Word; no TOC page in UI)
 *  ──────────────────────────────────────────────────────────────────────────── */
export const MOA_PAGES_1_TO_6: string[] = [
  /* 1 */ F(`INCUBATION MEMORANDUM OF AGREEMENT

Entered into by and between:

LEPHARO INCUBATION PROGRAMME NPC
(REG. NO: 2006/028126/08)
[Hereinafter referred to as the INCUBATOR]

AND

{{beneficiaryName}}
(REG. NO: {{registrationNumber}})
[Hereinafter referred to as the INCUBATEE]

Individually referred to as a Party or collectively as Parties
`),

  /* 2 */ F(`{{beneficiaryName}} to formalise their relationship and therefore wish to reduce their intention to finalise their Incubation agreement, in writing in the form of an Incubation Agreement entered into between the two parties
a. WHEREAS the INCUBATOR runs an incubation program to afford training, access, Equipment, enterprise development, machinery, and opportunity to approve to acquire skills in the Base Metals Manufacturing Industry.
b. The INCUBATOR and facilitates access to various markets for products in order for entrepreneurs to become self-sustainable and independent.
c. THEREFORE the INCUBATEE has applied for enrolment and the INCUBATOR has approved and agreed to enrol the INCUBATEE into the incubation program subject to the fulfilment of the terms and conditions of this agreement.
d. The parties hereto wish to record the terms and conditions of their agreement.

NOW, THEREFORE THE PARTIES AGREE AS FOLLOWS:

1.  INTERPRETATION AND DEFINITIONS
1.1 The headings of the clauses in this agreement are for convenience and reference only and shall not be used in the interpretation of, nor modify, nor amplify the terms of this agreement nor any clause hereof.
1.2 Words importing:
     1.2.1 Any gender includes the other gender;
     1.2.2 The singular includes the plural and vice versa;
     1.2.3 Natural persons include created entities [corporate or incorporate] and vice versa.
1.3 Any reference to an enactment is to that enactment as at the Effective Date hereof and as amended or re-enacted from time to time.
1.4 If any provision in a definition is a substantive provision conferring rights or imposing obligations on any party, notwithstanding that it is only in the definition clause, effect shall be given to it as if it were a substantive provision in the body of the agreement.
1.5 When any number of days is prescribed in this agreement, the same shall be reckoned exclusively of the first and inclusive of the last day unless otherwise, that last day falls on a Saturday, Sunday, or Public holiday, in which case the last day shall be the next working day.
1.6 Where figures are referred to in this agreement in numerals and in words, if there is any conflict between the two, the words shall prevail.`),

  /* 3 */ F(`1.7 Schedules or annexures to this agreement shall be deemed to be incorporated in and form part of this agreement.
1.8 The following words and/or phrases shall have the following meanings when used in this agreement and cognate words or phrases shall have corresponding meanings:
     1.8.1 "AGREEMENT" means this incubation agreement, its schedules, annexures, and its Amendments or additions;
     1.8.2 "INCUBATEE" means {{beneficiaryName}} (REG NO: {{registrationNumber}}) carrying on business at LEPHARO INCUBATION PROGRAMME NPC herein presented by {{participantName}} ID Number: {{idNumber}} a director/ member duly authorized to and whose business address is: {{businessAddress}}. Contact number: {{contactNumber}} , Email: {{email}}
     1.8.3 "INCUBATOR" means LEPHARO INCUBATION PROGRAMME NPC , SECTION 21, Registration number: 2006/028126/08, an association incorporated not for gain, incorporated in terms of the laws of the Republic of South Africa with a principal place of business at No: 37 BENONI STREET, RUSTENBURG NORTH, RUSTENBURG, 0299. Contact numbers: Tel: (014) 008 5065 Email address: info@lepharo.co.za.
     1.8.4 "PARTIES" mean the parties to this agreement, the INCUBATOR, and the INCUBATEE and its surety.
     1.8.5 "INCUBATION PERIOD" shall be for 03 (Three) years;
            1.8.5.1 "POST GRADUATION" shall be for 02 (Two) years;
     1.8.6 "PREMISES" means the entire campus of the INCUBATOR, its Reginal offices and in reference to the Terms of Lease, means the cubicle allocated to the incubatee in terms of the lease to be concluded where applicable and such other area over which the INCUBATEE has the right of use in terms of this agreement and/or the lease;
     1.8.7 "VAT" means value-added tax as levied in terms of the Value Added Tax Act, 1991 (as amended) in this Agreement:
     1.8.8 clause and paragraph headings are for the purposes of reference only and shall not be used in the interpretation of this Agreement;
     1.8.9 words and phrases defined in this Agreement shall also apply in the interpretation of the same words and phrases in annexures or schedules to this Agreement save where specifically indicated to the contrary in such annexures or schedules;
     1.8.10 unless the context otherwise requires:
     1.8.11 the singular shall import and include the plural and vice versa;
     1.8.12 a word importing a gender shall import and include the other gender;
     1.8.13 words importing persons include natural persons, created entities, and juristic persons;
     1.8.14 the rule of construction that a contract be interpreted against the party responsible for the drafting or preparation of the contract, shall not apply;
     1.8.15 where any number of days is prescribed, those days shall be reckoned exclusively of the first and inclusively of the last day unless otherwise the last day falls on a day which is not a Business Day, in which event the last day shall be the next succeeding Business Day.
     1.8.16 Terms other than those defined within this Agreement will be given their plain English meaning, and those terms, acronyms, and phrases known in the information technology industry will be interpreted in accordance with their generally accepted meanings.
     1.8.17 Defined terms appearing in this Agreement in title case shall be given their meaning as defined, while the same terms appearing in the lower case shall be interpreted in accordance with their ordinary meaning as qualified by clause 2.3 and shall, unless the context otherwise indicates, include the term as defined.
1.9 "SERVICE PROVIDER" means all services providers contracted by Lepharo to provide services to you. They shall be introduced to you during the induction period and/or on-boarding process.`),

  /* 4 */ F(`2.  INCUBATION AND DURATION OF AGREEMENT
Notwithstanding the date of signature hereof, the INCUBATOR hereby agrees to enrol the INCUBATEE into the incubation program with effect from {{effectiveDate}} ("the Effective Date") until {{graduationDate}} ("the Graduation Date"). The post-graduation period will start as from {{graduationDate}} until {{postGraduationEndDate}}.
This agreement shall continue to subsist until termination on the Graduation Date or such earlier date as may be terminated in terms of the provisions of Clause 6 of this agreement ("the Termination Date"). The INCUBATOR shall in its sole discretion have the right to terminate and/or extend the incubation period for a further twelve months if it deems it necessary and upon request for an extension by the INCUBATEE made not less than six (6) months before the Graduation date.`),

  /* 5 */ F(`3.  OBLIGATIONS OF THE INCUBATOR
3.1 As of the Effective Date, for the duration of the incubation program and until the Termination Date, the INCUBATOR shall provide general enterprise assistance and development to the INCUBATEE which includes but not limited to and without limiting the generality thereof:
3.2 Where applicable, provide operating facilities to the INCUBATEE at the INCUBATOR'S premises and subject to the Terms of Lease to be concluded where applicable between Lepharo and the Incubatee for the operation of the INCUBATEE'S business;
3.3 Where applicable and at its sole discretion, provide access to and avail for use by the INCUBATEE to the INCUBATOR'S central /allocated workshop and machines.
     3.3.1 It is specifically recorded that the INCUBATOR shall charge for use and access to all facilities at the rates determined by the INCUBATOR and as they may be amended from time to time;
     3.3.2 A job card and timesheet system will be used in the calculation of the amount payable for use of the central/allocated workshop;
     3.3.3 All amounts payable for use of the central/allocated workshop by the INCUBATEE shall be payable not later than the 4th of every month succeeding the month of which the INCUBATEE used the central/allocated workshop.
3.4 Lepharo shall avail Professional Advisor and/or Consultant the INCUBATEE who shall only provide professional services and an Advisory role to the INCUBATEE for the duration of the incubation period. It is specifically recorded that the Professional Advisor and/or Consultant fees and disbursements shall be paid by the Incubatees.
3.5 Assist the INCUBATEE with developing general business skills which include but are not limited to marketing skills for their products.
3.6 Upon assessment of the Incubatee training needs, and where there are any cost involved. The training cost shall be discussed and agreed upon with the Incubatee. The terms and conditions of the training as highlighted in the Pre-Training agreement shall fully apply and be legally binding. The Incubatee shall be required to sign the Pre-Training agreement.
3.7 To assist the INCUBATEE to submit competitive tenders by providing the following service whenever possible:
     3.7.1 To identify certain work and tender opportunities
     3.7.2 To facilitate performance guarantees
     3.7.3 To facilitate credit (working in conditions that the client has received an order)
3.8 At the sole discretion of Lepharo, Lepharo will provide limited use of the fax, telephone internet, and photocopying machine per month at a charge agreed between the INCUBATOR and INCUBATEE, which charge may be received from time to time.
3.09 Furniture and fittings will be provided by INCUBATOR, which furniture and fittings will remain the property of INCUBATOR.`),
];

// src/components/modals/Contracts/moa.pages — export 7..28
export const MOA_PAGES_7_TO_28: string[] = [
    /* 7 */ `4.  OBLIGATIONS AND RESPONSIBILITIES OF THE INCUBATEE
  4.1 The INCUBATEE shall as from the Effective Date, use his skill, best endeavours, and time for the sole and exclusive purpose of furthering the enterprise under incubation.
  4.2 It is specifically recorded that the INCUBATEE is engaged in the design, manufacturing, processing, marketing, sale, and supply of products manufactured from Base Metals and that the above activities are the only activities the INCUBATEE shall engage in for the incubation program and for which he/she shall use the premises leased in terms of the lease, if applicable.
  4.3 The INCUBATEE warrants that the enterprise is the only commercial undertaking it is engaged in and that should he/she, without the written consent of the INCUBATOR engage in any other activity, whether part-time, as a Consultant, Advisor, Associate or joint venture partner, he/she shall be in breach of the material terms of this agreement and the INCUBATOR shall be entitled to invoke the termination provisions including the recovery of any damages the INCUBATOR may have suffered.
  4.4 The INCUBATEE shall ensure that he/she complies with the rules and obligation of the INCUBATOR for the attainment of the objectives thereof.
  4.5 At all times the INCUBATEE shall comply with all the provisions of the Terms of Lease as concluded between the parties and shall vacate the premises so leased on the Termination Date.
  4.6 The INCUBATEE shall keep proper records of all financial and operational information of his/her business and shall, every month from the Effective Date, submit to the INCUBATOR, a report on its turnover, bank statements for that period, proof of income and tax invoices rendered by suppliers and to clients.
  4.7 After graduating from the incubation program, the INCUBATEE shall for 2 years from such graduation date be obliged to continue to furnish the INCUBATOR with quarterly turnover reports, certified by his/ her Accounting Officer or Auditor as being true and correct together with any other business or financial information regarding the INCUBATEE.
  4.9 All business opportunities procured through Lepharo facilities will result in the SMME paying Lepharo 5% of the invoice value/ gross. The Members/ Directors of the company commit and accept to pay this amount as soon as payment has been made by clients.
  4.10 The Post-Graduation incubation participation professional fees shall not be discounted and/or subsidised by Lepharo, accounts shall be solely of the SMME in full.
  4.11 The INCUBATEE shall after the Graduation Date continues to supply the INCUBATOR with quarterly employment statistics and a report on contracts of employment of the people it has engaged in its activities for the period of 02 years.`,

    /* 8 */ `4.12 The INCUBATEE acknowledges that should this agreement be terminated before the Graduation Date due to the INCUBATEE abandoning the incubation program or as a result of the INCUBATEE’S breach, then the INCUBATOR shall be entitled to recover from the INCUBATEE, regardless of the time of termination or abandonment, such damages as it may have suffered.
  4.13 The INCUBATEE warrants that he/she has complied with the relevant provisions of institutions of authority established according to the laws of the Republic of South Africa including but not limited to, paying all amounts due to South Africa Receiver of Revenue, the Unemployment Insurance Funds, Compensation Fund and that if any arrangements have been made concerning any matters of these institutions, such have been recorded in writing and proof thereof kept and shall be furnished to the INCUBATOR upon request.
  4.14 The INCUBATEE acknowledges that the nature of his/her relationship with the INCUBATOR is not that of employer/employee, agency, consultancy and unless specifically provided, not that of partnership, joint venture nor association and that as such he/ she shall not give rise to any of the rights and obligations that are incidental or natural to such relationship despite the fact that some of the provisions of this agreement may contain provisions ordinarily associated with such relationship.
  4.15 The Members/Owners/Directors of the INCUBATEE hereby commit themselves in good faith to the performance of the INCUBATEE’S obligations in terms of this agreement and bind themselves as personal surety and co-debtor with the INCUBATEE for the performance of his/her obligations in terms hereof.
  4.16 The INCUBATEE hereby indemnifies the INCUBATOR against any claims for damages, loss, injury, or death suffered by the INCUBATEE, his/ her goods, or employees, subcontractors, clients, or visitors as a result of his/ her operations.
  4.17 To follow without deviation the program, the Code of Conduct, policies, and procedures as stipulated by INCUBATOR.
  4.18 The INCUBATEE is responsible to take his/her own all risk short term insurance cover.
  4.19 At all times to promote and protect the interest of the INCUBATOR.
  4.20 Bring notice to the INCUBATOR any changes of partnership, members, or shareholding irrespective of whether such change is as the result of the retirement or resignation of any of the partners or the taking of a new partner or for any reason whatsoever.
  4.21 The INCUBATEE is obliged and I turn undertakes to attend and participate in all workshops and functions hosted by INCUBATOR unless prearranged with the INCUBATOR. This shall include but not be limited to the Bi-Weekly Engagement Session, weekly mentoring, and assessment meetings with the Centre Manager, the business skills classes, and Technical skills classes.
  4.22 The INCUBATEE shall at all times undertake to fully and effectively make use of the Intern allocated to them.
  4.23 Whilst in the Incubation program with Lepharo, the Incubatee shall have access to Professional Service Providers on the following to mention but few Legal, Health and Safety, and Financial management.
       4.23.1 Save the proviso in clause 4.10, the fees for services referred to in para 4.21 shall be agreed between the Parties i.e, the Incubatees and the Services Provider independently at the discounted rates
       4.23.2 The Incubatees shall be solely and directly be responsible for the account.
       4.23.3 The discounted rates principle and or financial benefit shall automatically cease to be applicable upon initial incubation graduation by the Incubate.`,

    /* 9 */ `4.24 As an Incubatee it is your responsibility to submit all required including but not limited to documents and information by any contracted Service Provider timeously and/or within their respective stipulated time frame. Failure to do so shall be deemed as defeating the purpose of this agreement, non-compliance to the terms of enrolling with the Incubation program, and will lead to a breach of the Incubation Memorandum of Understanding. Lepharo reserves all its rights in this regard.

  5.  CODE OF ETHICS AND CONDUCT
  5.1 LEPHARO has a statutory obligation to be a good employer, partner, incubator, and organizationally recognizes the importance of treating staff and its incubates fairly and properly in all aspects of their employment and/or involvement in the incubation program.
  5.2 In return, LEPHARO expects a high standard of behaviour and Conduct from the employees, partners, and Incubates. All staff and Incubates are expected to identify with and have a commitment to the philosophy and values of LEPHARO, and to demonstrate that commitment in the performance of their duties and/or their business in Lepharo premises, and the Incubator undertake to sign and abide by the code of ethics and conduct.`,

    /* 10 */ `6.  BREACH AND TERMINATION OF AGREEMENT
  6.1 Should any of the parties breach any of the terms of this agreement and despite written notice of no less than seven (7) days to remedy such breach. The wronged party shall be entitled to, but without prejudice to any of its rights it may have in law against the party in the breach:
       6.1.1 Claim specific performance; and/or
       6.1.2 In the case of the INCUBATEE being in breach, suspend access and use of the premises and/or all facilities; and/or
       6.1.3 Cancel the agreement and evict the INCUBATEE from the premises; and/or
       6.1.4 Claim damages; and/or
       6.1.5 Claim legal costs on the scale as between attorney and client.
  6.2 Notwithstanding anything contained anywhere else in this agreement, after the effective date, any party hereto shall be entitled to terminate this agreement by giving written notice to the other parties of no less than thirty (30) days.
  6.3 The parties hereto consent to the non-exclusive jurisdiction of the Magistrates Court for the enforcement of any of the provisions of this agreement and/or to seek relief arising out of or as a consequence of this agreement. The costs of such proceedings shall be paid by the party in breach on the scale as between attorney and client.
  6.4 INCUBATOR shall be entitled to terminate this agreement forthwith by written notice to the incubatee if the INCUBATEE:-
       6.4.1 Is declared insolvent/liquidated;
       6.4.2 Commits a fraudulent or dishonest act;
       6.4.3 In the event of the INCUBATEE failing to abide by the code of conduct to be provided to INCUBATEE by end of December and should he/she be found guilty at any subsequent disciplinary hearing.
  6.5 The INCUBATEE shall be liable to pay the rental equivalent of three months of the six-month ‘grace’ period should the INCUBATEE leave before the expiry of the first twelve months.
  6.6 INCUBATOR reserves all its rights to terminate this agreement if it’s of the opinion that the continuation of this agreement holds no business case and there is no merit to continue.
  6.7 In the event that the Incubation agreement is terminated, the Incubatee shall never be allowed to participate in Lepharo Incubation.
  6.8 The INCUBATOR shall be entitled to terminate and/or cancel this agreement if amongst the others the INCUBATEE fails to discharge its obligation/s and/or responsibilities.`,

    /* 11 */ `7.  ACCESS TO LEASED PREMISES
  Where applicable the Parties shall conclude and enter into a lease agreement. The INCUBATEE shall be granted access to the leased premises.

  8.  DOMICILIA AND NOTICES
  8.1 For all purposes under this agreement or any amendments hereof or with regard to any matter arising here from or in connection therewith, each of the parties respectively chooses the address set out in Clause 1.8 as its domiciliumcitandieteexecutandi.
  8.2 Any notice given to any of the parties under this agreement shall be in writing and shall be reputably presumed to have been received by that party:
       8.2.1 on the tenth [10th] day after the day on which it is posted if posted by prepaid registered post; or
       8.2.2 on the first business day after the date of delivery if delivered by hand or transmission thereof by telefax.
  8.3 Any party may from time to time, change its applicable address to another physical address in the Republic of South Africa, which is not a post office box or poste restante, by delivering written notice to that effect to the other parties at the address given above.`,

    /* 12 */ `9.  GENERAL
  9.1 The parties agree that this agreement together with its Schedules and/or addendums represents the entire agreement between them and that any and all prior negotiation, undertakings, or agreements have been substituted and are represented herein and that no alteration or amendment shall be of any force or effect unless agreed upon and reduced to writing by the parties.
  9.2 Should any part of or clause in this agreement is found to be unenforceable or without effect, the remainder of the agreement shall remain effective with the exclusion of such clause.
  9.3 Failure to exercise timeously or at all by any party its rights in terms hereof shall not be construed as a waiver by such party of any of its remedies it has in terms of this agreement or it may have in law.
  9.4 The parties agree and undertake that for as long as they are parties to this agreement, they will not, through their agents, employees, or through the representation of any other person, disclose to any third party, any confidential information of the other acquired by such party, both prior to and during the term of this agreement nor use, exploit, assist any third party in using or exploiting, the discloser’s information commercially or otherwise and in any manner whatsoever and for any purpose other than that expressly provided for herein, without the prior and express written consent of the discloser. It is specifically recorded that the confidentiality provisions of this agreement shall survive the termination of this agreement regardless of the manner of termination.
  9.5 All payments excluding for the services rendered as the agreement between the INCUBATEE and the Service Provider, shall be paid directly into the INCUBATOR’S bank account and proof thereof handed in at the office of the INCUBATOR. The INCUBATOR’S banking details are as follows:
  ACCOUNT NAME: LEPHARO INCUBATION PROGRAMME NPC
  BANK: NEDBANK  BRANCH NAME: Eastern Gauteng
  BRANCH CODE: 190742
  CHEQUE ACCOUNT NUMBER: 1288 118651
  9.6 The costs of this agreement shall be paid by the INCUBATOR.`,

    /* 13 */ `10. RELATIONSHIP
  This Agreement does not constitute any of the parties as an agent or legal representative of any other party for any purpose whatsoever and none of the parties will be entitled to act on behalf of, or to represent any other, unless duly authorized thereto in writing.

  11. ARBITRATION
  11.1 Any dispute that arises regarding this Agreement, or out of or pursuant to this agreement (other than where an interdict or urgent relief is sought from a court of competent jurisdiction), shall be resolved by arbitration in Johannesburg conducted in the English language.
  11.2 The arbitration will be subjected to the arbitration legislation for the time being in force in South Africa and the rules of AFSA, and the arbitration shall be appointed by AFSA, unless otherwise agreed by the parties.
  11.3 The arbitration shall have the power to give default Judgement if any party fails to make a submission on the relevant due or fails to appear at the arbitration.
  11.4 Any party shall be entitled to have the award made an order of a court of competent jurisdiction in South Africa.
  11.5 The provisions of this Clause are severable from the rest of this Agreement and shall remain in effect even if this Agreement is terminated.`,

    /* 14 */ `12. ENTIRE AGREEMENT
  This Agreement contains the entire agreement of the parties with respect to the subject matter of this Agreement and supersedes all prior agreement between the parties, whether written or oral, with respect to the subject matter of this Agreement.

  13. NO INDUCEMENT
  Each of the parties acknowledges that it has not been induced to enter into this Agreement by any representations, warranty, or undertaking not expressly incorporated into this Agreement.

  14. VARIATION, CANCELLATION, AND WAIVER
  No contract varying, adding to, deleting from or cancelling this Agreement, and no waiver of any right under this Agreement, shall be effective unless reduced to writing and signed by or on behalf of both parties..

  15  AMENDMENTS
  No amendment, interpretation, or waiver of any of the provisions of this Agreement shall be effective unless reduced to writing and signed by all the parties. In the event that Lepharo Memorandum of Agreement for Incubation is amended, the amendments shall apply all also to existing Incubatees.`,

    /* 15 */ `16  INDULGENCES
  16.1 The grant of any indulgence, extension of any time, or relaxation of any provision by a Party under this Agreement (or under any other agreement or document issued or executed pursuant to this Agreement) shall not constitute a waiver of any right by the grantor or prevent or adversely affect the exercise by the grantor of any existing or future right of the grantor. Accordingly, if a Party at any time breaches any of that Party’s obligations under this Agreement, the aggrieved Party:
  16.2 May at any time exercise any right that became exercisable directly or indirectly as a result of the breach unless the aggrieved Party expressly elects in writing not to exercise that right or to relinquish that right, or the aggrieved Party by its clear and unambiguous conduct (amounting to more than mere delay) elects not to exercise that right;
  16.2.1 may accept the late performance of the Party in breach, which acceptance shall be provisional only and shall not prevent the aggrieved Party from exercising at any time the aggrieved Party’s rights arising out of that breach; and
  16.2.2 shall not be prevented (estopped) from exercising the aggrieved Party’s rights arising out of that breach, despite the fact that the aggrieved Party may have elected.`,

    /* 16 */ `17  CESSION AND DELEGATION
  A Party may not cede any or all of that Party’s rights or delegate any or all of that Party’s obligations under this Agreement, without the prior written consent of the other Party.

  18  SURVIVAL OF RIGHTS, DUTIES, AND OBLIGATIONS
  Termination of this agreement for any cause whatsoever shall not release a party from any liability which at the time of termination has already accrued to another party or which thereafter may accrue in respect of any act or omission prior to such termination.

  19  SEVERABILITY
  If any of the items, conditions, or provisions of this Agreement are determined by any competent authority to be invalid, unlawful, or unenforceable to any extent, such term, conditions or provision will to that extent be severed from the remaining terms, conditions, and provisions of this Agreement.

  20  NON-SOLICITATION
  20.1 Neither party will during the existence of this agreement and for a period of 1 (one) year after the termination date, either for itself or as the agent of anyone else, persuade, induce, solicit, encourage or procure any employee of the other party.
       20.1.1 become employed by or interested in any manner whatever in any business, firm, undertaking, company, close corporation or other entity or association of persons (all of which are hereinafter referred to as "any concern"), who are directly or indirectly in competition with the business carried on by the other party.
       20.1.2 Furnish any information or advice acquired by any one of the parties as a result of its association with the other party, to anyone else which might result in any employee of such party becoming employed by, or directly or indirectly interested in any manner, in any concern.`,

    /* 17 */ `21  FORCE MAJURE
  Neither Party shall be liable for any default or delay in the performance of its obligations under this Agreement if and to the extent that it is caused by an Event of Force Majeure which could not have been prevented by reasonable precautions or which cannot reasonably be circumvented by the non-performing Party through the use of alternate sources, workaround plans or other means.

  22  WAIVER
  The failure or neglect to enforce any of the provisions of this Agreement will not be construed nor will it be deemed to be a waiver of any party’s rights in terms of this Agreement.

  23  INDEPENDENT ADVICE
  Each of the Parties hereby respectively agrees and acknowledges that:
       23.1.1 It has been free to secure independent legal advice as to the nature and effect of each provision of this Agreement and that it has either taken such independent legal advice or has dispensed with the necessity of doing so; and 23.1.2  Each of the provisions of this Agreement is fair and reasonable in all the circumstances and is part of the overall intention of the Parties in connection with this Agreement.

  24  GOOD FAITH
  The Parties shall at all times act in good faith towards each other and shall not bring any of the other Parties into disrepute.`,

    /* 18 */ `25  DUPLICATE ORIGINALS
  This Agreement may be executed in one or more identical copies, each of which when executed shall constitute an original and all of which shall together constitute one and the same agreement, provided that this Agreement will be binding on all parties as if they had all signed one document, only if it has been executed by all parties.

  26  COOPERATION
  Each of the Parties undertakes at all times to do all such things, perform all such acts and take all such steps, and to procure the doing of all such things, within its own power and control, as may be open to it and necessary for and incidental to the putting into effect or maintenance of the terms, conditions, and import of this Agreement.`,

    /* 19 */ `27  NEUTRAL CONSTRUCTION, EXCLUSION OF THE CONTRA PROFERENTEM RULE
  The Parties hereby acknowledge that this Agreement was negotiated fairly between them at arm’s length and that the final terms thereof are the product of the Parties’ negotiations and accordingly the provisions of this Agreement shall not be construed against a Party on the grounds that such Party drafted or was responsible for drafting any of the majority of the provisions

  28  LIMITATION OF LIABILITY
  Neither Party shall be liable to the other Party for indirect, special or consequential losses, claims, damages or liabilities, whether in contract or delict or otherwise, based on this Agreement, or any obligation performed or undertaken in terms of or in connection with this Agreement. The claim of the Party not in default under this Agreement shall be limited to the recovery of the actual cost of labour and materials expended by such Party in performing its obligations under this Agreement up to the date of the breach.`,
  ];


export const MOA_PAGES = [...MOA_PAGES_1_TO_6, ...MOA_PAGES_7_TO_28];

/** ────────────────────────────────────────────────────────────────────────────
 *  Token replacement (UI + .docx)
 *  ──────────────────────────────────────────────────────────────────────────── */
const TOKEN_MAP = [
  "beneficiaryName",
  "registrationNumber",
  "participantName",
  "idNumber",
  "businessAddress",
  "contactNumber",
  "email",
  "effectiveDate",
  "graduationDate",
  "postGraduationEndDate",
] as const;

const fallback = (v?: string) => (v && String(v).trim().length ? v : "________");

export function renderMoaPages(vars: MoaVars): string[] {
  const computed = {
    ...vars,
    postGraduationEndDate:
      vars.postGraduationEndDate ||
      dayjs(vars.graduationDate, "D MMMM YYYY").add(2, "year").format("DD MMMM YYYY"),
  };
  return MOA_PAGES.map((page) =>
    TOKEN_MAP.reduce((acc, key) => {
      const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      // @ts-ignore
      return acc.replace(re, fallback(computed[key]));
    }, page)
  );
}

/** ────────────────────────────────────────────────────────────────────────────
 *  Header (fixed dimensions + borders + logo) — repeats on every page
 *  ──────────────────────────────────────────────────────────────────────────── */
const INCH = (n: number) => Math.round(n * 1440);

// A4 Portrait
const A4_W_P = 11906, A4_H_P = 16838;
const A4_W = A4_W_P;              // ← portrait width
const A4_H = A4_H_P;              // ← portrait height
const MARGIN = INCH(1.00);
const CONTENT_W = A4_W - 2 * MARGIN;
const HEADER_GAP = INCH(0.50);
const HEADER_BODY_GAP = INCH(0.20); // ≈0.2" extra whitespace after header


// Header table width: keep safely within content width (≈10")
const HEADER_TABLE_WIDTH = Math.min(CONTENT_W, INCH(10.0));

// Match the approved form: logo, title, then a wide metadata column.
const LEFT_R = 0.24, CENTER_R = 0.39, RIGHT_R = 0.37;
const LEFT_W = Math.round(HEADER_TABLE_WIDTH * LEFT_R);
const CENTER_W = Math.round(HEADER_TABLE_WIDTH * CENTER_R);
const RIGHT_W = HEADER_TABLE_WIDTH - LEFT_W - CENTER_W;

// Row height
const HEADER_ROW_HEIGHT = INCH(1.0);


async function fetchArrayBuffer(url: string): Promise<ArrayBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }

  function makeHeader(logoBuf: ArrayBuffer | null, headerMeta?: HeaderMeta) {
    const cellPad = { top: 70, bottom: 70, left: 120, right: 120 };

    return new Header({
      children: [
        new DTable({
          layout: TableLayoutType.FIXED,
          width: { size: HEADER_TABLE_WIDTH, type: WidthType.DXA }, // exact width in DXA
          columnWidths: [LEFT_W, CENTER_W, RIGHT_W],                // sum === table width
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4 },
            bottom: { style: BorderStyle.SINGLE, size: 4 },
            left: { style: BorderStyle.SINGLE, size: 4 },
            right: { style: BorderStyle.SINGLE, size: 4 },
            insideH: { style: BorderStyle.SINGLE, size: 4 },
            insideV: { style: BorderStyle.SINGLE, size: 4 },
          },
          rows: [
            new DRow({
              height: { value: HEADER_ROW_HEIGHT, rule: HeightRule.EXACT },
              children: [
                // LEFT — logo
                new DCell({
                  width: { size: LEFT_W, type: WidthType.DXA },
                  margins: cellPad,
                  children: [
                    logoBuf
                      ? new Paragraph({
                          alignment: AlignmentType.LEFT,
                          children: [
                            new ImageRun({
                              data: logoBuf,
                              transformation: { width: 200, height: 52 }, // readable in portrait
                            }),
                          ],
                        })
                      : new Paragraph({ children: [new TextRun({ text: "" })] }),
                  ],
                }),

                // CENTER — title
                new DCell({
                  width: { size: CENTER_W, type: WidthType.DXA },
                  margins: cellPad,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: headerMeta?.centerTitle || "INCUBATION MEMORANDUM OF AGREEMENT",
                          bold: true,
                          size: 28, // ≈14pt (readable but compact)
                          font: "Arial",
                        }),
                      ],
                    }),
                  ],
                }),

                // RIGHT — meta
                new DCell({
                  width: { size: RIGHT_W, type: WidthType.DXA },
                  margins: cellPad,
                  children: [
                    new Paragraph({
                      spacing: { after: 30 },
                      children: [
                        new TextRun({ text: "Form No: ", bold: true }),
                        new TextRun({ text: headerMeta?.formNo || "—" }),
                      ],
                    }),
                    new Paragraph({
                      spacing: { after: 30 },
                      children: [
                        new TextRun({ text: "Revision No: ", bold: true }),
                        new TextRun({ text: headerMeta?.revisionNo || "—" }),
                      ],
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Effective date: ", bold: true }),
                        new TextRun({ text: headerMeta?.effectiveDate || "—" }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }



  // Standard footer: [Ref No] | [-page-] | [signature image]
  function makeFooter(refNo: string, sigBuf: ArrayBuffer | null) {
    const tableWidth = Math.min(CONTENT_W, INCH(10));
    const colW = [Math.round(tableWidth * 0.35), Math.round(tableWidth * 0.30), tableWidth - Math.round(tableWidth * 0.35) - Math.round(tableWidth * 0.30)];

    return new Footer({
      children: [
        new DTable({
          layout: TableLayoutType.FIXED,
          width: { size: tableWidth, type: WidthType.DXA },
          columnWidths: colW,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
            bottom: { style: BorderStyle.NONE, size: 0 },
            left: { style: BorderStyle.NONE, size: 0 },
            right: { style: BorderStyle.NONE, size: 0 },
            insideH: { style: BorderStyle.NONE, size: 0 },
            insideV: { style: BorderStyle.NONE, size: 0 },
          },
          rows: [
            new DRow({
              children: [
                // Left: Ref No
                new DCell({
                  width: { size: colW[0], type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.LEFT,
                      children: [new TextRun({ text: refNo, size: 20 })],
                    }),
                  ],
                }),
                // Center: -page-
                new DCell({
                  width: { size: colW[1], type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({ text: "-", size: 20 }),
                        PageNumber.CURRENT,
                        new TextRun({ text: "-", size: 20 }),
                      ],
                    }),
                  ],
                }),
                // Right: Signature image
                new DCell({
                  width: { size: colW[2], type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: sigBuf
                        ? [new ImageRun({ data: sigBuf, transformation: { width: 140, height: 45 } })]
                        : [new TextRun({ text: "" })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  function buildCoverSection(coverText: string) {
    const lines = coverText.split(/\r?\n/);

    const paras = lines.map((ln) =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 }, // gentle vertical rhythm
        children: [new TextRun({ text: ln })],
      })
    );

    // A full-height row so the single cell can vertically center its content
    const rowHeight = A4_H - 2 * MARGIN; // safe; header distance is 0 on this section
    const tableWidth = Math.min(CONTENT_W, INCH(10));

    const table = new DTable({
      layout: TableLayoutType.FIXED,
      width: { size: tableWidth, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE, size: 0 },
        bottom: { style: BorderStyle.NONE, size: 0 },
        left: { style: BorderStyle.NONE, size: 0 },
        right: { style: BorderStyle.NONE, size: 0 },
        insideH: { style: BorderStyle.NONE, size: 0 },
        insideV: { style: BorderStyle.NONE, size: 0 },
      },
      rows: [
        new DRow({
          height: { value: rowHeight, rule: HeightRule.ATLEAST },
          children: [
            new DCell({
              verticalAlign: VerticalAlign.CENTER,
              children: paras,
            }),
          ],
        }),
      ],
    });

    return table;
  }





/** ────────────────────────────────────────────────────────────────────────────
 *  Paragraph shaping (reduced spacing; continuous flow)
 *  ──────────────────────────────────────────────────────────────────────────── */
function paragraphFromLine(line: string): Paragraph {
    const t = line.trim();

    // H1 (main title)
    if (/^INCUBATION MEMORANDUM OF AGREEMENT$/i.test(t)) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 120, after: 120 },
        children: [new TextRun({ text: t, italics: false })],
      });
    }

    // Only whole-number clauses are headings in the approved MOA.
    if (/^\d+\.?\s+/.test(t)) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 120, after: 60 },
        children: [new TextRun({ text: t, bold: true, italics: false, font: "Arial", size: 22 })],
      });
    }

    // Numbered subclauses remain regular body copy with a hanging number gutter.
    if (/^\d+(?:\.\d+)+\s+/.test(t)) {
      return new Paragraph({
        spacing: { before: 0, after: 60, line: 300, lineRule: "auto" },
        indent: { left: INCH(0.45), hanging: INCH(0.45) },
        children: [new TextRun({ text: t, italics: false, font: "Arial", size: 22 })],
      });
    }

    // Uppercase keyword blocks → sub-heading (no italics)
    if (/^(ARBITRATION|GENERAL|RELATIONSHIP|WAIVER|AMENDMENTS?|INDULGENCES|CESSION AND DELEGATION|SEVERABILITY|NON-SOLICITATION|FORCE MAJURE|GOOD FAITH|DUPLICATE ORIGINALS|COOPERATION|LIMITATION OF LIABILITY)\b/i.test(t)) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 100, after: 40 },
        children: [new TextRun({ text: t, italics: false })],
      });
    }

    // Body text (no italics)
    return new Paragraph({
      spacing: { before: 0, after: 60, line: 300, lineRule: "auto" },
      children: [new TextRun({ text: line, italics: false, font: "Arial", size: 22 })],
    });
  }

  // --- signatures types you can pass from your UI / "agreements" doc ---
type SignatureBlock = {
    name?: string;              // e.g. "Tebogo Mosifo"
    positionOrTitle?: string;   // e.g. "Director" or "CENTRE COORDINATOR"
    place?: string;             // e.g. "Rustenburg"
    day?: string;               // e.g. "02"
    month?: string;             // e.g. "December"
    year?: string;              // e.g. "2024"
    signatureUrl?: string;      // image URL
    witnessName?: string;
    witnessSignatureUrl?: string;
  };

  type SignaturesOptions = {
    incubatee: SignatureBlock;
    incubator: SignatureBlock; // ROM/centre coordinator on your side
  };

  const LINE = (n = 22) => " ".repeat(n); // creates an underline area via borders

  function underlinedText(text: string) {
    return new TextRun({ text, underline: { type: "single" } });
  }

  function label(text: string, bold = false) {
    return new TextRun({ text, bold });
  }

  function spacer(h = 120) {
    return new Paragraph({ spacing: { before: h, after: h }, children: [new TextRun(" ")] });
  }

  async function imageRunOrBlank(url?: string, w = 200, h = 60) {
    if (!url) return null;
    try {
      const buf = await fetchArrayBuffer(url);
      if (!buf) return null;
      return new ImageRun({ data: buf, transformation: { width: w, height: h } });
    } catch {
      return null;
    }
  }

  // Build a two-column “label : value(underlined)” row quicky
  function lineRow(labelText: string, valueText = "", underlineLen = 24) {
    return new Paragraph({
      spacing: { before: 60, after: 20 },
      children: [
        label(labelText, true),
        new TextRun(" "),
        underlinedText(valueText || LINE(underlineLen)),
      ],
    });
  }

  // Full “29 SIGNATURES” page
  async function buildSignaturesSection(opts: SignaturesOptions): Promise<(Paragraph | DTable)[]> {
    const inc = opts.incubatee || {};
    const rom = opts.incubator || {};

    const incSig = await imageRunOrBlank(inc.signatureUrl, 220, 70);
    const romSig = await imageRunOrBlank(rom.signatureUrl, 220, 70);
    const w1Sig = await imageRunOrBlank(inc.witnessSignatureUrl, 180, 50);
    const w2Sig = await imageRunOrBlank(rom.witnessSignatureUrl, 180, 50);

    const H2 = new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("29  SIGNATURES")],
      spacing: { before: 120, after: 160 },
    });

    // --- Incubatee block ---
    const INC_TITLE = new Paragraph({
      children: [new TextRun({ text: "The Incubatee or SMME", bold: true })],
      spacing: { after: 90 },
    });

    const INC_SIGNED_AT = new Paragraph({
      spacing: { before: 40, after: 20 },
      children: [
        label("SIGNED AT "),
        underlinedText(inc.place || LINE(18)),
        new TextRun(" on this "),
        underlinedText(inc.day || LINE(4)),
        new TextRun(" day of "),
        underlinedText(inc.month || LINE(10)),
        new TextRun(" "),
        underlinedText(inc.year || LINE(6)),
        new TextRun("."),
      ],
    });

    const INC_NAME_POS = new Paragraph({
      spacing: { before: 60, after: 40 },
      children: [
        label("Name & Surname: "),
        underlinedText(inc.name || LINE(24)),
        new TextRun("   "),
        label("Position in the Company: "),
        underlinedText(inc.positionOrTitle || LINE(16)),
      ],
    });

    const INC_FOR_BEHALF = new Paragraph({
      spacing: { before: 30, after: 10 },
      children: [new TextRun("[For and on behalf of the INCUBATEE, duly authorized]")],
    });

    const INC_SIGNATURE = new Paragraph({
      spacing: { before: 10, after: 20 },
      children: [
        label("Signature: "),
        ...(incSig ? [incSig] : [underlinedText(LINE(18))]),
      ],
    });

    const INC_WITNESS = new Paragraph({
      spacing: { before: 80, after: 10 },
      children: [label("Witness:"), new TextRun("  "), ...(w1Sig ? [w1Sig] : [])],
    });

    const INC_WITNESS_NAME = new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 10, after: 40 },
      children: [underlinedText(inc.witnessName || LINE(22)), new TextRun("  "), label("Signature")],
    });

    // --- Incubator block (ROM) ---
    const ROM_TITLE = new Paragraph({
      spacing: { before: 100, after: 90 },
      children: [new TextRun({ text: "The Incubator", bold: true })],
    });

    const ROM_SIGNED_AT = new Paragraph({
      spacing: { before: 40, after: 20 },
      children: [
        label("SIGNED AT "),
        underlinedText(rom.place || LINE(18)),
        new TextRun(" on this "),
        underlinedText(rom.day || LINE(4)),
        new TextRun(" day of "),
        underlinedText(rom.month || LINE(10)),
        new TextRun(" "),
        underlinedText(rom.year || LINE(6)),
        new TextRun("."),
      ],
    });

    const ROM_NAME_TITLE = new Paragraph({
      spacing: { before: 60, after: 20 },
      children: [
        underlinedText(rom.name || LINE(24)),
        new TextRun("\n"),
        new TextRun(rom.positionOrTitle || "CENTRE COORDINATOR"),
      ],
    });

    const ROM_FOR_BEHALF = new Paragraph({
      spacing: { before: 30, after: 10 },
      children: [new TextRun("[For and on behalf of the INCUBATOR, duly authorized]")],
    });

    const ROM_SIGNATURE = new Paragraph({
      spacing: { before: 10, after: 20 },
      children: [label("Signature: "), ...(romSig ? [romSig] : [underlinedText(LINE(18))])],
    });

    const ROM_WITNESS = new Paragraph({
      spacing: { before: 80, after: 10 },
      children: [label("Witness:"), new TextRun("  "), ...(w2Sig ? [w2Sig] : [])],
    });

    const ROM_WITNESS_NAME = new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 10, after: 20 },
      children: [underlinedText(rom.witnessName || LINE(22)), new TextRun("  "), label("Signature")],
    });

    return [
      H2,
      INC_TITLE,
      INC_SIGNED_AT,
      INC_NAME_POS,
      INC_FOR_BEHALF,
      INC_SIGNATURE,
      INC_WITNESS,
      INC_WITNESS_NAME,
      ROM_TITLE,
      ROM_SIGNED_AT,
      ROM_NAME_TITLE,
      ROM_FOR_BEHALF,
      ROM_SIGNATURE,
      ROM_WITNESS,
      ROM_WITNESS_NAME,
    ];
  }




/** ────────────────────────────────────────────────────────────────────────────
 *  Build a .docx with:
 *  - repeating header (logo + meta)
 *  - clickable TOC
 *  - continuous content (no per-page breaks)
 *  ──────────────────────────────────────────────────────────────────────────── */
export async function buildMoaDocx(
    vars: MoaVars,
    headerMeta?: HeaderMeta,
    opts?: {
        refNo?: string;
        // signatures are optional — pass what you have from Firestore
        signatures?: {
          incubatee?: SignatureBlock;
          incubator?: SignatureBlock; // ROM side
        };
      }
  ): Promise<Blob> {
    const pages = renderMoaPages(vars);
    const coverText = pages[0];
    const bodyPages = pages.slice(1);
    const sigInc = opts?.signatures?.incubatee ?? {};
    const sigRom = opts?.signatures?.incubator ?? {};

    // Flatten the rest of the pages into paragraphs
    const content: Paragraph[] = [];
    bodyPages.forEach((page) => {
      page.split(/\r?\n/).forEach((ln) => content.push(paragraphFromLine(ln)));
    });

    // Load assets
    const logoBuf = await fetchArrayBuffer("/assets/images/lepharo.png");

    // Header (shown on every page)
    const header = makeHeader(logoBuf, {
      centerTitle: headerMeta?.centerTitle || "INCUBATION MEMORANDUM OF AGREEMENT",
      formNo: headerMeta?.formNo || "LEP QMS 074.1 F",
      revisionNo: headerMeta?.revisionNo || "0",
      effectiveDate: headerMeta?.effectiveDate || "01 October 2020",
    });

    // Footer (Ref No + Page Numbers + Signature)
    const refNo = opts?.refNo || "Ref No: 24LEP-THA: MOAQ3 – 02";
    const footer = makeFooter(opts?.refNo || "Ref No: 24LEP-THA: MOAQ3 – 02",
    await fetchArrayBuffer(sigInc.signatureUrl || ""));

    // Build cover table (centered content)
    const cover = buildCoverSection(coverText);

    // Document with ONE section (header + footer everywhere)
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: "Arial", size: 22 },
            paragraph: { spacing: { line: 300, lineRule: "auto" } },
          },
        },
        paragraphStyles: [
          { id: "Heading1", name: "heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { italics: false } },
          { id: "Heading2", name: "heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { italics: false } },
          { id: "Heading3", name: "heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { italics: false } },
          { id: "Heading4", name: "heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { italics: false } },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              width: A4_W,
              height: A4_H,
              margin: {
                top: MARGIN + HEADER_BODY_GAP,
                right: MARGIN,
                bottom: MARGIN,
                left: MARGIN,
                header: HEADER_GAP,
                footer: INCH(0.35),
              },
            },
          },
          headers: { default: header },
          footers: { default: footer },
          children: [
            // Cover page
            cover,

            // Force next page break
            new Paragraph({ text: "", pageBreakBefore: true }),


            // --- Table of Contents ---
new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 200 },
    children: [
      new TextRun({
        text: "TABLE OF CONTENTS",
        bold: true,
        allCaps: true,
        underline: { type: "single" },
      }),
    ],
  }),

  // Only top-level headings
  new TableOfContents("", {
    hyperlink: false,            // plain entries (like the image)
    headingStyleRange: "2-2",    // ONLY level 2
    rightTabStop: 9350,          // aligns page numbers to the right
  }),

  // Force a new page after the TOC
  new Paragraph({ text: "", pageBreakBefore: true }),


            // Body content

...content,

// new page for signatures
new Paragraph({ text: "", pageBreakBefore: true }),
...(await buildSignaturesSection({
  incubatee: {
    name: sigInc.name || vars.participantName,
    positionOrTitle: sigInc.positionOrTitle || "Director",
    place: sigInc.place || "Rustenburg",
    day: sigInc.day || dayjs(vars.effectiveDate, "D MMMM YYYY").format("DD"),
    month: sigInc.month || dayjs(vars.effectiveDate, "D MMMM YYYY").format("MMMM"),
    year: sigInc.year || dayjs(vars.effectiveDate, "D MMMM YYYY").format("YYYY"),
    signatureUrl: sigInc.signatureUrl,
    witnessName: sigInc.witnessName || "",
    witnessSignatureUrl: sigInc.witnessSignatureUrl,
  },
  incubator: {
    name: sigRom.name || "",
    positionOrTitle: sigRom.positionOrTitle || "CENTRE COORDINATOR",
    place: sigRom.place || "Rustenburg",
    day: sigRom.day || dayjs(vars.effectiveDate, "D MMMM YYYY").format("DD"),
    month: sigRom.month || dayjs(vars.effectiveDate, "D MMMM YYYY").format("MMMM"),
    year: sigRom.year || dayjs(vars.effectiveDate, "D MMMM YYYY").format("YYYY"),
    signatureUrl: sigRom.signatureUrl,
    witnessName: sigRom.witnessName || "",
    witnessSignatureUrl: sigRom.witnessSignatureUrl,
  },
})),

          ],
        },
      ],
    });

    return Packer.toBlob(doc);
  }



/** Convenience saver */
export async function saveMoaDocx(
    vars: MoaVars,
    fileName?: string,
    headerMeta?: HeaderMeta,
    signatures?: { incubatee?: SignatureBlock; incubator?: SignatureBlock }
  ) {
    const blob = await buildMoaDocx(vars, headerMeta, {
      refNo: "Ref No: 24LEP-THA: MOAQ3 – 02",
      signatures,
    });
    const safeName = fileName || `MOA_${vars.beneficiaryName.replace(/[^a-z0-9]+/gi, "_")}.docx`;
    saveAs(blob, safeName);
  }

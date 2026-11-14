// Realistic coverage notes for seeded (synthetic) sessions, so the session prep brief
// has history to show: a summary, agreed actions and the next session's focus. Used
// by dataset.cjs when generating and by one-off patches of an existing seed.
// Order-agnostic on purpose: any note can be any session of the intervention.

const BANK = {
  "Contract Management": [
    {
      summary: "Reviewed the two supplier contracts the owner brought in. Flagged the auto-renewal clause and the 60-day payment terms as risks, and walked through how to negotiate shorter terms.",
      actions: ["Owner to ask the main supplier for 30-day payment terms", "Coordinator to share the contract checklist template"],
      nextFocus: "Draft a standard customer agreement for repeat clients.",
    },
    {
      summary: "Built a simple contract register together with renewal dates and notice periods. The owner now knows which three contracts come up for renewal this quarter.",
      actions: ["Owner to add the remaining customer contracts to the register by Friday"],
      nextFocus: "Prepare for the renewal discussion with the largest client.",
    },
    {
      summary: "Went through the draft customer agreement line by line. Agreed on clearer scope, a deposit requirement and a late-payment clause before it goes to clients.",
      actions: ["Owner to send the revised agreement to two trusted clients for feedback"],
      nextFocus: "Finalise the agreement and agree when to start using it.",
    },
    {
      summary: "Practised the renewal conversation using the register. The owner is confident about asking for the price increase and has a fallback position ready.",
      actions: ["Owner to book the renewal meeting with the client", "Coordinator to check in after the meeting"],
      nextFocus: "Review how the renewal went and update the register.",
    },
  ],
  "Cash Flow Planning": [
    {
      summary: "Mapped money in and out for the last three months from the bank statements. Found that two large customers pay after 45 days, which explains the month-end shortfalls.",
      actions: ["Owner to send three months of bank statements", "Coordinator to share the cash flow template"],
      nextFocus: "Build a 13-week cash flow forecast.",
    },
    {
      summary: "Set up the 13-week cash flow forecast in the template. The owner can now see the tight weeks coming and has started moving the supplier payment dates.",
      actions: ["Owner to update the forecast every Monday"],
      nextFocus: "Agree how to handle the shortfall forecast for next month.",
    },
    {
      summary: "Reviewed the first four weeks of actuals against the forecast. Collections are improving after the owner started invoicing on delivery instead of month-end.",
      actions: ["Owner to follow up the two overdue invoices this week"],
      nextFocus: "Set a minimum cash buffer and a plan to build it.",
    },
    {
      summary: "Agreed a minimum cash buffer of one month of fixed costs and a weekly saving amount to reach it. The owner separated tax money into its own account.",
      actions: ["Owner to open a separate savings account for the buffer"],
      nextFocus: "Check progress on the buffer and the forecast accuracy.",
    },
  ],
  "Customer Pipeline Development": [
    {
      summary: "Listed current customers and where new ones come from. Most work comes from word of mouth, with no follow-up on quotes that were not accepted.",
      actions: ["Owner to list every quote sent in the last two months"],
      nextFocus: "Set up a simple pipeline tracker for quotes and follow-ups.",
    },
    {
      summary: "Set up a pipeline tracker with stages from enquiry to paid. Eleven open quotes were found, and the owner chose five to follow up this week.",
      actions: ["Owner to follow up the five priority quotes by Thursday"],
      nextFocus: "Review the follow-up results and write a short follow-up script.",
    },
    {
      summary: "Two of the five follow-ups turned into orders. We wrote a short follow-up message and agreed to follow up every quote within three days.",
      actions: ["Owner to use the follow-up message for all new quotes"],
      nextFocus: "Find two new channels to reach customers in the area.",
    },
    {
      summary: "Explored new channels: a local business WhatsApp group and two property managers who need regular work. The owner will approach both with a simple offer.",
      actions: ["Owner to contact both property managers", "Coordinator to share an example service flyer"],
      nextFocus: "Review responses and update the pipeline.",
    },
  ],
  "Business Record Keeping": [
    {
      summary: "Looked at how sales and expenses are recorded today. Receipts are kept in a box and sales only in the bank account, so monthly totals are guesswork.",
      actions: ["Owner to collect this month's receipts in one folder"],
      nextFocus: "Set up a simple income and expense book.",
    },
    {
      summary: "Set up an income and expense book and captured the month together. The owner now knows last month's real profit for the first time.",
      actions: ["Owner to capture every sale and expense daily"],
      nextFocus: "Reconcile the book with the bank statement.",
    },
    {
      summary: "Reconciled the book with the bank statement. Found two missing expenses and one sale recorded twice, and agreed a weekly ten-minute check.",
      actions: ["Owner to do the weekly bank check every Friday"],
      nextFocus: "Produce the first monthly summary for the owner and the funder report.",
    },
    {
      summary: "Produced the monthly summary of sales, costs and profit from the book. The owner will use it to report revenue to the programme each month.",
      actions: ["Owner to submit the monthly figures by the 5th"],
      nextFocus: "Review three months of summaries to spot trends.",
    },
  ],
};

const GENERIC = [
  {
    summary: "Reviewed progress since the last session and the records the owner brought. Agreed the most important next step and what support is needed.",
    actions: ["Owner to complete the agreed next step before the next session"],
    nextFocus: "Review the outcome of the agreed next step.",
  },
];

// Small, stable hash so a session always gets the same note.
const hash = (text) => {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};

/** A note for one seeded session of the named intervention. */
function sessionNote(interventionTitle, key) {
  const bank = BANK[String(interventionTitle || "").replace(/ session$/i, "").trim()] || GENERIC;
  return bank[hash(key) % bank.length];
}

module.exports = { sessionNote, BANK };

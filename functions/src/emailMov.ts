import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  getCCRecipients,
  getMERecipients,
  getHODRecipients,
  sendStatusChangeNotification,
  buildPackReminderEmail,
  APP_BASE_URL,
} from "./emailShared";

/**
 * One daily scheduler replaces the former HOD, CC and M&E scheduler resources.
 * HOD reminders run daily, with CC and M&E reminders added on the 4th and 7th.
 */
export const movReminderCron = onSchedule(
  { region: "us-central1", schedule: "0 8 * * *", timeZone: "Africa/Johannesburg" },
  async () => {
    const dayOfMonth = Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Johannesburg",
        day: "2-digit",
      }).format(new Date())
    );

    const jobs: Array<{
      type: string;
      recipients: () => Promise<string[]>;
      message: string;
      url: string;
    }> = [
      {
        type: "HOD",
        recipients: () => getHODRecipients(),
        message: "Please submit the previous month’s MOV pack as soon as possible. This reminder runs daily through the month.",
        url: `${APP_BASE_URL.replace(/\/$/, "")}/operations`,
      },
    ];

    if (dayOfMonth === 4) {
      jobs.push({
        type: "CC",
        recipients: () => getCCRecipients(),
        message: "Please review any MOV packs submitted by HODs for the previous month and progress them accordingly.",
        url: `${APP_BASE_URL.replace(/\/$/, "")}/project-admin`,
      });
    }
    if (dayOfMonth === 7) {
      jobs.push({
        type: "M&E",
        recipients: () => getMERecipients(),
        message: "Please verify MOVs that have been signed by CCs and complete the M&E review process.",
        url: `${APP_BASE_URL.replace(/\/$/, "")}/operations`,
      });
    }

    for (const job of jobs) {
      const recipients = await job.recipients();
      if (!recipients.length) continue;
      const content = buildPackReminderEmail(job.type, job.message, job.url);
      await sendStatusChangeNotification(recipients, content.subject, content.html, content.text);
      logger.info("movReminderCron.sent", {
        reminderType: job.type,
        count: recipients.length,
        dayOfMonth,
      });
    }
  }
);

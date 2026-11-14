import React from "react";
import { Empty, Tag } from "antd";
import { EnvironmentOutlined, ExportOutlined, FileTextOutlined, MailOutlined, PhoneOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { ContactList, ContactRow, OwnershipCards, contactActions } from "@/components/workspace";
import { type Training, type TrainingEnrollment, enrollmentDocuments, missingDocuments } from "./trainingStorage";

/*
 * Detail sections for a training SME, laid out like the Participants
 * workspace (ws-detail-body / ws-facts / ContactList). Shared by the Training
 * Academy's SMEs page and the Training SMEs view on Participants.
 */

export const ENROLLMENT_STATUS_META = {
  unassigned: { color: "gold", label: "Awaiting training" },
  enrolled: { color: "green", label: "Enrolled" },
  discontinued: { color: "red", label: "Discontinued" },
} as const;

export const statusMetaOf = (e: TrainingEnrollment) => ENROLLMENT_STATUS_META[e.status] || ENROLLMENT_STATUS_META.unassigned;

/** The company when there is one, otherwise the person. */
export const companyOf = (e: TrainingEnrollment) => e.companyName || e.name;

const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
const percent = (v?: string) => (isBlank(v) ? null : Number(v));
const date = (iso?: string) => (iso ? dayjs(iso).format("DD MMM YYYY") : "");

const fact = (label: string, value?: React.ReactNode) => (
  <div key={label}>
    <dt>{label}</dt>
    <dd>{isBlank(value) ? <span className="ws-muted">—</span> : value}</dd>
  </div>
);

/** Profile facts, contact details and ownership, from the enrollment and its collected details. */
export function TrainingSmeProfile({ enrollment: e, training }: { enrollment: TrainingEnrollment; training?: Training }) {
  const d = e.details || {};
  const address = [d.businessAddress, d.town, d.province].filter((v) => !isBlank(v)).join(", ");
  const hasOwnership = [d.blackOwnedPercent, d.femaleOwnedPercent, d.youthOwnedPercent].some((v) => !isBlank(v));
  return (
    <div className="ws-detail-body">
      <section>
        <h4 className="ws-section-title">Profile</h4>
        <dl className="ws-facts">
          {fact("Contact person", e.name)}
          {fact("Training", training?.name)}
          {fact("Registration number", d.registrationNumber)}
          {fact("ID number", d.idNumber)}
          {fact("Sector", d.sector)}
          {fact("Gender", d.gender)}
          {fact("B-BBEE level", d.beeLevel)}
          {fact("Added", date(e.createdAt))}
          {fact("Enrolled", date(e.enrolledAt))}
          {e.status === "discontinued" && fact("Discontinued because", e.discontinuedReason)}
        </dl>
      </section>
      <section>
        <h4 className="ws-section-title">Contact</h4>
        <ContactList>
          <ContactRow icon={<MailOutlined />} label="Email" value={e.email} empty="No email on file" action={contactActions.email(e.email, <SendOutlined />)} half />
          <ContactRow
            icon={<PhoneOutlined />}
            label="Phone"
            value={d.phone}
            empty="No phone number on file"
            copyLabel="Phone number"
            action={contactActions.phone(d.phone, <PhoneOutlined />)}
            half
          />
          <ContactRow icon={<EnvironmentOutlined />} label="Address" value={address} empty="No address on file" action={contactActions.map(address, <ExportOutlined />)} />
        </ContactList>
      </section>
      {hasOwnership && (
        <section>
          <h4 className="ws-section-title">Ownership</h4>
          <OwnershipCards
            items={[
              { label: "Black owned", value: percent(d.blackOwnedPercent) },
              { label: "Women owned", value: percent(d.femaleOwnedPercent) },
              { label: "Youth owned", value: percent(d.youthOwnedPercent) },
            ]}
          />
        </section>
      )}
    </div>
  );
}

/** Documents on file (each opens in a new tab) and any the training still needs. */
export function TrainingSmeDocuments({ enrollment, training }: { enrollment: TrainingEnrollment; training?: Training }) {
  const documents = enrollmentDocuments(enrollment);
  const missing = missingDocuments(enrollment, training);
  return (
    <div className="ws-detail-body">
      <section>
        <h4 className="ws-section-title">On file</h4>
        {documents.length ? (
          <ContactList>
            {documents.map((doc) => (
              <ContactRow
                key={doc.label}
                icon={<FileTextOutlined />}
                label={doc.label}
                value={doc.name}
                action={{ href: doc.url, icon: <ExportOutlined />, label: `Open ${doc.label}`, external: true }}
              />
            ))}
          </ContactList>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No documents on file" />
        )}
      </section>
      {!!missing.length && (
        <section>
          <h4 className="ws-section-title">Still needed</h4>
          <div className="ws-detail-tags">
            {missing.map((label) => (
              <Tag key={label} color="orange">
                {label}
              </Tag>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

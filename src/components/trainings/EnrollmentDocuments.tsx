import React from "react";
import { Space, Tag, Tooltip, Typography } from "antd";
import { enrollmentDocuments, missingDocuments, type Training, type TrainingEnrollment } from "./trainingStorage";

/** Links to every document on file, plus a tag when the SME's training still needs some. */
export function EnrollmentDocumentsCell({ enrollment, training }: { enrollment: TrainingEnrollment; training?: Training }) {
  const documents = enrollmentDocuments(enrollment);
  const missing = missingDocuments(enrollment, training);
  return (
    <Space direction="vertical" size={0}>
      {documents.map((d) => (
        <a key={d.label} href={d.url} target="_blank" rel="noreferrer">
          {d.label}
        </a>
      ))}
      {!documents.length && !missing.length && <Typography.Text type="secondary">—</Typography.Text>}
      {!!missing.length && (
        <Tooltip title={`Missing: ${missing.join(", ")}`}>
          <Tag color="orange" style={{ marginTop: 4 }}>
            {missing.length} missing
          </Tag>
        </Tooltip>
      )}
    </Space>
  );
}

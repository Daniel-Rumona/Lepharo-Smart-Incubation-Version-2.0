import React, { useEffect, useState } from "react";
import { Alert, App, Button, Form, InputNumber, Modal, Radio, Select, Skeleton, Space, Switch, Typography } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useFormChanged } from "@/lib/useFormChanged";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { Training } from "./trainingStorage";
import { type CertificateTemplate, type CertificationSettings, effectiveCertification } from "./certification";
import { loadCertificationDefaults, saveCertificationDefaults, saveTrainingCertification } from "./certificationStorage";
import { listCertificateTemplates } from "./certificateStorage";
import { planSessionLabel } from "./trainingPlan";

type Values = {
  useDefaults: boolean;
  enabled: boolean;
  awardTo: CertificationSettings["awardTo"];
  templateId?: string | null;
  minAttendancePercent?: number | null;
  perCategoryMinSessions?: number | null;
  requiredPlanSessionIds: string[];
  requiredCourseIds: string[];
  minAverageScore?: number | null;
  requiredDocuments: boolean;
};

const toValues = (s: CertificationSettings, useDefaults: boolean): Values => ({
  useDefaults,
  enabled: s.enabled,
  awardTo: s.awardTo,
  templateId: s.templateId,
  minAttendancePercent: s.rules.minAttendancePercent ?? null,
  perCategoryMinSessions: s.rules.perCategoryMinSessions ?? null,
  requiredPlanSessionIds: s.rules.requiredPlanSessionIds || [],
  requiredCourseIds: s.rules.requiredCourseIds || [],
  minAverageScore: s.rules.minAverageScore ?? null,
  requiredDocuments: !!s.rules.requiredDocuments,
});

/**
 * When an SME's people (or the SME) can be awarded a certificate. Without a
 * training it edits the Academy-wide defaults; with one, that training either
 * follows the defaults or sets its own rules. The progress function
 * re-evaluates everyone affected as soon as this is saved.
 */
export function CertificationSettingsModal({
  open,
  training,
  courseTitles,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null: the Academy-wide defaults. */
  training: Training | null;
  courseTitles: Map<string, string>;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const [form] = Form.useForm<Values>();
  // Two screens: the certificate itself, then what earns it. No step bar; Next / Back move between them.
  const [step, setStep] = useState<"certificate" | "requirements">("certificate");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  // The form appears only once these are loaded, so they go in as its initial values.
  const [loaded, setLoaded] = useState<Values>();
  const useDefaults = Form.useWatch("useDefaults", form);
  const enabled = Form.useWatch("enabled", form);
  const changed = useFormChanged(form, undefined, training?.id ?? "defaults");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep("certificate");
    setLoading(true);
    setLoaded(undefined);
    listCertificateTemplates()
      .then((list) => !cancelled && setTemplates(list))
      .catch(() => undefined);
    loadCertificationDefaults()
      .then((defaults) => {
        if (cancelled) return;
        const own = training?.certification;
        setLoaded(toValues(effectiveCertification(defaults, training ? own : null), !!training && !own));
      })
      .catch((e) => message.error(e instanceof Error ? e.message : "Could not load the certification settings."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, training, form, message]);

  const save = async () => {
    const v = await form.validateFields();
    const settings: CertificationSettings = {
      enabled: v.enabled,
      awardTo: v.awardTo,
      templateId: v.templateId || null,
      signatories: [{ key: "academy_head", title: "Head of Training Academy", departmentRole: "training" }],
      rules: {
        minAttendancePercent: v.minAttendancePercent || null,
        perCategoryMinSessions: v.perCategoryMinSessions || null,
        minAverageScore: v.minAverageScore || null,
        requiredDocuments: v.requiredDocuments,
        ...(training ? { requiredPlanSessionIds: v.requiredPlanSessionIds || [], requiredCourseIds: v.requiredCourseIds || [] } : {}),
      },
    };
    setSaving(true);
    try {
      if (training) await saveTrainingCertification(training.id, v.useDefaults ? null : settings);
      else await saveCertificationDefaults(settings);
      message.success("Saved. Eligibility is being re-evaluated.");
      onSaved?.();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not save the certification settings.");
    } finally {
      setSaving(false);
    }
  };

  // A repeating session is required as a whole: attending any occurrence counts.
  const planOptions = (() => {
    const seen = new Set<string>();
    return (training?.plan || []).flatMap((p) => {
      const value = p.series?.id || p.id;
      if (seen.has(value)) return [];
      seen.add(value);
      return [{ value, label: p.series ? `${p.title} (any occurrence)` : planSessionLabel(p) }];
    });
  })();
  const locked = !!training && useDefaults;
  // Always two screens. Following the defaults, or with certificates off, the requirements show read-only.
  const onRequirements = step === "requirements";
  // Side by side on wide screens; stacked on phones.
  const pair: React.CSSProperties = { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", columnGap: 12 };

  const saveButton = (
    <Button type="primary" block size="large" disabled={loading || !changed} loading={saving} onClick={() => void save()}>
      Save
    </Button>
  );
  const footer = onRequirements ? (
    <div style={{ display: "flex", gap: 12 }}>
      {/* Wrapped so mobile-sheet's "hide the Cancel beside the primary" rule doesn't take Back too. */}
      <span style={{ flex: "1 1 0", minWidth: 0 }}>
        <Button block size="large" icon={<ArrowLeftOutlined />} onClick={() => setStep("certificate")}>
          Back
        </Button>
      </span>
      <span style={{ flex: "1 1 0", minWidth: 0 }}>{saveButton}</span>
    </div>
  ) : (
    <Button type="primary" block size="large" disabled={loading} onClick={() => setStep("requirements")}>
      Next: requirements <ArrowRightOutlined />
    </Button>
  );

  return (
    <Modal
      wrapClassName="mobile-sheet"
      centered
      title={
        <Space>
          <SafetyCertificateOutlined />
          {training ? `Certification · ${training.name}` : "Certification defaults"}
        </Space>
      }
      open={open}
      onCancel={onClose}
      // One action per screen; × cancels. Save is enabled once a setting differs from what was loaded.
      footer={footer}
      destroyOnClose
      width={620}
    >
      {loading || !loaded ? (
        <Skeleton active />
      ) : (
        // Both screens stay mounted (one hidden) so values on the other screen are kept and validated.
        <Form form={form} layout="vertical" preserve={false} initialValues={loaded}>
          <div style={{ display: onRequirements ? "none" : "block" }}>
          {training ? (
            <Form.Item name="useDefaults" valuePropName="checked" style={{ marginBottom: 12 }}>
              <Switch checkedChildren="Academy defaults" unCheckedChildren="Own rules" />
            </Form.Item>
          ) : (
            <Typography.Paragraph type="secondary">
              Every training follows these unless it sets its own rules. Required sessions and courses are chosen per training.
            </Typography.Paragraph>
          )}
          {locked && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="This training follows the Academy defaults shown below. Switch to Own rules to change them for this training only." />}
          <Form.Item name="enabled" label="Award certificates" valuePropName="checked">
            <Switch disabled={locked} />
          </Form.Item>
          <Form.Item name="awardTo" label="Who is certified">
            <Radio.Group disabled={locked || !enabled}>
              <Space direction="vertical">
                <Radio value="attendee">Each person who attends</Radio>
                <Radio value="company">The company: one certificate saying it completed the training</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="templateId" label="Certificate template" extra="Manage templates from Certificate templates on the trainings page.">
            <Select
              allowClear
              placeholder="Choose before certificates can be prepared"
              disabled={locked || !enabled}
              options={templates
                .filter((t) => t.active || t.id === form.getFieldValue("templateId"))
                .map((t) => ({ value: t.id, label: `${t.name} (v${t.version})` }))}
            />
          </Form.Item>
          <Typography.Text type="secondary">Certificates are signed by the Head of Training Academy.</Typography.Text>
          </div>

          <div style={{ display: onRequirements ? "block" : "none" }}>
          {locked ? (
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="These are the Academy defaults. Go back and switch to Own rules to change them for this training only." />
          ) : !enabled ? (
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Certificates are off. Go back and turn on Award certificates to set what earns one." />
          ) : (
            <Typography.Paragraph type="secondary">What someone must have done to be certified. Leave a field empty for no requirement.</Typography.Paragraph>
          )}
          <div style={pair}>
            <Form.Item name="minAttendancePercent" label="Minimum attendance (%)" extra="Of held sessions they were invited to. Empty: no minimum.">
              <InputNumber min={1} max={100} style={{ width: "100%" }} disabled={locked || !enabled} />
            </Form.Item>
            <Form.Item name="perCategoryMinSessions" label="Sessions per category" extra="Attended in each of their categories. Empty: none.">
              <InputNumber min={1} max={100} style={{ width: "100%" }} disabled={locked || !enabled} />
            </Form.Item>
          </div>
          {training && (
            <Form.Item name="requiredPlanSessionIds" label="Sessions that must be attended" extra="Only counts for people invited to them.">
              <Select mode="multiple" allowClear options={planOptions} disabled={locked || !enabled} placeholder="None" />
            </Form.Item>
          )}
          {training && (
            <Form.Item name="requiredCourseIds" label="Courses that must be completed" extra="Courses are taken by the director for now.">
              <Select
                mode="multiple"
                allowClear
                disabled={locked || !enabled}
                placeholder="None"
                options={(training.courseIds || []).map((id) => ({ value: id, label: courseTitles.get(id) || "Unavailable course" }))}
              />
            </Form.Item>
          )}
          <div style={pair}>
            <Form.Item name="minAverageScore" label="Minimum average score (%)" extra="Across course assessments. Empty: none.">
              <InputNumber min={1} max={100} style={{ width: "100%" }} disabled={locked || !enabled} />
            </Form.Item>
            <Form.Item name="requiredDocuments" label="Documents on file" valuePropName="checked" extra="Company documents, plus each person's ID number and ID copy.">
              <Switch disabled={locked || !enabled} />
            </Form.Item>
          </div>
          </div>
        </Form>
      )}
    </Modal>
  );
}

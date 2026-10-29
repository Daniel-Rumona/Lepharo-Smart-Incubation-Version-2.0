import React, { useEffect, useState } from "react";
import { Alert, Button, Card, Descriptions, Input, Result, Space, Typography } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";
import { type VerifyResult, verifyCertificateCode } from "./certificateStorage";

/**
 * /verify-certificate?c=CODE — public, no sign-in. The QR on a certificate
 * opens this page; anyone can also type the printed code. The server checks
 * the code against its own HMAC of the certificate's details, so a made-up or
 * edited code never verifies.
 */
export default function VerifyCertificatePage() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get("c") || "");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async (value: string) => {
    if (!value.trim()) return;
    setChecking(true);
    setResult(null);
    try {
      setResult(await verifyCertificateCode(value.trim()));
      setParams({ c: value.trim() }, { replace: true });
    } catch {
      setResult({ ok: false, error: "unreachable" });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    const initial = params.get("c");
    if (initial) void check(initial);
    // Only the code the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failure = (error: string) =>
    error === "not_found"
      ? "No certificate matches this code. Check it was typed exactly as printed."
      : error === "invalid_code"
        ? "A code has 16 letters and numbers, e.g. 7KQ2-M9XD-4HPA-W3RT."
        : error === "too_many_requests"
          ? "Too many checks from here. Wait a minute and try again."
          : "The check couldn't be completed. Try again shortly.";

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "48px 16px" }}>
      <Card style={{ width: "100%", maxWidth: 560 }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space>
            <SafetyCertificateOutlined style={{ fontSize: 24 }} />
            <Typography.Title level={4} style={{ margin: 0 }}>
              Verify a Lepharo training certificate
            </Typography.Title>
          </Space>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onPressEnter={() => void check(code)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              aria-label="Verification code"
            />
            <Button type="primary" loading={checking} onClick={() => void check(code)}>
              Check
            </Button>
          </Space.Compact>

          {result?.ok && (
            <Result
              status={result.status === "valid" ? "success" : "warning"}
              title={result.status === "valid" ? "This certificate is genuine" : "This certificate has been revoked"}
              subTitle={result.status === "revoked" && result.revokedAt ? `Revoked on ${dayjs(result.revokedAt).format("D MMMM YYYY")}.` : undefined}
              style={{ padding: 0 }}
            >
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Awarded to">{result.recipientName}</Descriptions.Item>
                {result.companyName && <Descriptions.Item label="Company">{result.companyName}</Descriptions.Item>}
                <Descriptions.Item label="Training">{result.trainingName}</Descriptions.Item>
                <Descriptions.Item label="Certificate number">{result.certificateNumber}</Descriptions.Item>
                <Descriptions.Item label="Issued">{dayjs(result.issuedAt).format("D MMMM YYYY")}</Descriptions.Item>
                <Descriptions.Item label="File fingerprint (SHA-256)">
                  <Typography.Text style={{ fontSize: 11, wordBreak: "break-all" }}>{result.sha256}</Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            </Result>
          )}
          {result && !result.ok && <Alert type="error" showIcon message={failure(result.error)} />}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Holding the PDF? Its SHA-256 fingerprint should match the one shown above; if it doesn't, the file was changed after it was issued.
          </Typography.Text>
        </Space>
      </Card>
    </div>
  );
}

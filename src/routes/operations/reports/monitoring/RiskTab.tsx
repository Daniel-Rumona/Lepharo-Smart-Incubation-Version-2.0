import React from "react";
import { Col, Empty, Row } from "antd";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { RiskAnalyticsContent } from "./SMERiskRegister/components/AnalyticsModal";
import { useSMERiskRegisterData } from "./SMERiskRegister/useSMERiskRegisterData";

/**
 * Risk for the M&E report: the register's analytics only. Working through
 * individual SMEs happens on the Risk page (Incubatees > Risk).
 */
export default function RiskTab({ programId }: { programId?: string }) {
    const { loading, rows, isDepartmentScopedView } = useSMERiskRegisterData(programId);

    if (loading) {
        return (
            <Row gutter={[12, 12]}>
                <Col xs={24} xl={8}>
                    <MotionCard loading skeletonRows={8} />
                </Col>
                <Col xs={24} xl={16}>
                    <MotionCard loading skeletonRows={8} />
                </Col>
            </Row>
        );
    }

    if (!rows.length) {
        return (
            <MotionCard>
                <Empty description="No SMEs to assess for this programme." />
            </MotionCard>
        );
    }

    return <RiskAnalyticsContent rows={rows} isDepartmentScopedView={isDepartmentScopedView} />;
}

import React from "react";
import { Helmet } from "react-helmet";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { DashboardHeaderCard } from "@/components/dashboards/metrics/Header";
import MilestoneJourney from "@/components/milestone-journey/MilestoneJourney";

const OperationsMilestoneJourney: React.FC = () => {
  const { user } = useFullIdentity();
  const { activeProgramId, isAllPrograms } = useActiveProgramId();
  return (
    <div style={{ minHeight: "100vh", padding: 24 }}>
      <Helmet>
        <title>Department Milestone Journey | Smart Incubation Platform</title>
      </Helmet>
      <DashboardHeaderCard
        title="Department Milestone Journey"
        subtitle="Review how verified appointments and interventions unfolded over time."
      />
      <div style={{ marginTop: 20 }}>
        <MilestoneJourney
          scope="operations"
          departmentId={(user as any)?.departmentId}
          programId={isAllPrograms ? null : activeProgramId}
        />
      </div>
    </div>
  );
};

export default OperationsMilestoneJourney;

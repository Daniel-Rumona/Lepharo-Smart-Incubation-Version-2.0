import React from "react";
import { Alert, Grid, Skeleton } from "antd";
import { Navigate } from "react-router-dom";
import { TrainingPeopleDrawer } from "./TrainingPeopleDrawer";
import { useMyEnrollment } from "./useMyEnrollment";

/** /training/people — the director adds the employees they send and withdraws anyone who leaves. Employees go home. */
export default function SmePeople() {
  const { role, enrollment, training, loading, error } = useMyEnrollment();
  const padding = Grid.useBreakpoint().md ? 24 : 16;
  if (loading) return <Skeleton active style={{ padding }} />;
  if (role !== "director") return <Navigate to="/training" replace />;
  if (error || !enrollment) return <Alert type="warning" showIcon style={{ margin: padding }} message={error || "No training is linked to your account yet."} />;
  return (
    <div style={{ padding }}>
      <TrainingPeopleDrawer variant="page" asDirector enrollment={enrollment} training={training || undefined} />
    </div>
  );
}

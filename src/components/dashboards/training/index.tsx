import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Spin, theme } from "antd";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ArrowRightOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import InterventionsDashboard from "../shared/InterventionsDashboard";
import "./department-filters.css";

type Department = { id: string; name: string; parentDepartmentId?: string };
const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export default function TrainingDashboard() {
  const { token } = theme.useToken();
  const { user } = useFullIdentity();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selected, setSelected] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getDocs(collection(db, "departments"))
      .then((snapshot) => {
        if (cancelled) return;
        const all = snapshot.docs.map(
          (doc) => ({ ...doc.data(), id: doc.id } as Department)
        );
        setDepartments(
          user?.departmentId
            ? all.filter(
                (row) =>
                  row.id === user.departmentId ||
                  row.parentDepartmentId === user.departmentId
              )
            : all
        );
        setSelected("all");
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.departmentId, retry]);
  const scope = useMemo(
    () =>
      selected === "all"
        ? departments
        : departments.filter((row) => row.id === selected),
    [departments, selected]
  );
  const departmentIds = useMemo(() => scope.map((row) => row.id), [scope]);
  const matchesDepartment = useCallback(
    (entry: Record<string, any>) => {
      if (entry.departmentId)
        return departmentIds.includes(String(entry.departmentId));
      const name = normalize(
        entry.areaOfSupport || entry.area || entry.departmentName
      );
      return !!name && scope.some((row) => normalize(row.name) === name);
    },
    [scope, departmentIds]
  );
  if (loading)
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin />
      </div>
    );
  if (error)
    return (
      <Alert
        type="error"
        message="Unable to load department scope"
        action={
          <Button onClick={() => setRetry((value) => value + 1)}>Retry</Button>
        }
      />
    );
  if (!departmentIds.length)
    return (
      <Alert
        type="info"
        message="No departments are available for this dashboard."
      />
    );
  return (
    <InterventionsDashboard
      title="Training Academy"
      matchesDepartment={matchesDepartment}
      departmentIds={departmentIds}
      scopeControl={
        departments.length > 1 ? (
          <div
            role="group"
            aria-label="Filter by department"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              width: "100%",
              marginTop: 16,
            }}
          >
            {[{ id: "all", name: "All" }, ...departments].map((department) => {
              const active = selected === department.id;
              return (
                <Button
                  key={department.id}
                  className="training-department-filter"
                  aria-pressed={active}
                  onClick={() => setSelected(department.id)}
                  style={
                    {
                      "--filter-primary": token.colorPrimary,
                      "--filter-selected": token.colorPrimaryBg,
                      "--filter-surface": token.colorBgContainer,
                      "--filter-border": token.colorBorder,
                      "--filter-text": token.colorText,
                    } as React.CSSProperties
                  }
                >
                  <span className="training-department-filter-icon">
                    {department.id === "all" ? (
                      <AppstoreOutlined />
                    ) : (
                      <ApartmentOutlined />
                    )}
                  </span>
                  <span className="training-department-filter-label">
                    {department.name}
                  </span>
                  <span className="training-department-filter-action">
                    {active ? (
                      <>
                        <CheckOutlined /> Selected
                      </>
                    ) : (
                      <>
                        View <ArrowRightOutlined />
                      </>
                    )}
                  </span>
                </Button>
              );
            })}
          </div>
        ) : undefined
      }
    />
  );
}

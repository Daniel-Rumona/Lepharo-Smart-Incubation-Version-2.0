import React from "react";
import { Alert } from "antd";
import { useParams } from "react-router-dom";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import CourseBuilder from "./builder/CourseBuilder";
import CourseStart from "./builder/CourseStart";
import "./styles.css";
import "./builder/builder.css";

/**
 * /training/courses/builder      → create a course (describe, documents or blank)
 * /training/courses/builder/:id  → the guided two-pane builder
 */
export default function CourseBuilderRoute() {
  const { id } = useParams();
  const { user } = useFullIdentity();
  if (!user?.uid) return <Alert style={{ margin: 24 }} type="info" showIcon message="Sign in to build courses." />;
  return id ? <CourseBuilder key={id} id={id} /> : <CourseStart />;
}

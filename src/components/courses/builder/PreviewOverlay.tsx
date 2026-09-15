import React, { useEffect, useRef, useState } from "react";
import { Button, Segmented, Tooltip } from "antd";
import { ArrowLeftOutlined, DesktopOutlined, EditOutlined, MobileOutlined } from "@ant-design/icons";
import { CoursePlayer } from "../CoursePlayer";
import type { SavedCourse } from "../courseStorage";
import { useBuilderVars } from "./kinds";
import { Crumbs, TopBar } from "./parts";

/** Full-screen learner preview. Progress is simulated and never saved. */
export default function PreviewOverlay({
  course,
  itemId,
  onClose,
  onEdit,
}: {
  course: SavedCourse;
  itemId?: string;
  onClose: () => void;
  onEdit: (itemId: string) => void;
}) {
  const vars = useBuilderVars();
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [run, setRun] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const current = useRef(itemId);
  const [startAt, setStartAt] = useState(itemId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="cb-preview" style={vars} role="dialog" aria-modal="true" aria-label="Learner preview">
      <TopBar>
        <Button type="text" shape="round" icon={<ArrowLeftOutlined />} aria-label="Back to builder" onClick={onClose} />
        <Crumbs trail={[course.title]} current="Learner preview" meta={<span className="cb-hide-sm">Progress here is simulated</span>} />
        <Segmented
          className="cb-hide-md"
          value={device}
          onChange={(value) => setDevice(value as "desktop" | "phone")}
          options={[
            { value: "desktop", icon: <DesktopOutlined />, title: "Desktop" },
            { value: "phone", icon: <MobileOutlined />, title: "Phone" },
          ]}
        />
        <Button
          type="text"
          shape="round"
          className="cb-hide-md"
          onClick={() => {
            setStartAt(undefined);
            setUnlocked(false);
            setRun(run + 1);
          }}
        >
          Reset progress
        </Button>
        <Tooltip title="Open any item without completing the ones before it">
          <Button
            type={unlocked ? "default" : "text"}
            shape="round"
            className="cb-hide-md"
            onClick={() => {
              setStartAt(current.current);
              setUnlocked(!unlocked);
              setRun(run + 1);
            }}
          >
            {unlocked ? "Lock again" : "Unlock all"}
          </Button>
        </Tooltip>
        <Button shape="round" icon={<EditOutlined />} onClick={() => current.current && onEdit(current.current)}>
          <span className="cb-hide-xs">Edit this item</span>
        </Button>
      </TopBar>
      <div className={`cb-preview-stage is-${device}`}>
        <div className="cb-preview-frame">
          <CoursePlayer
            key={run}
            course={course}
            preview
            unlockAll={unlocked}
            initialItemId={startAt}
            onItemChange={(id) => {
              current.current = id;
            }}
          />
        </div>
      </div>
    </div>
  );
}

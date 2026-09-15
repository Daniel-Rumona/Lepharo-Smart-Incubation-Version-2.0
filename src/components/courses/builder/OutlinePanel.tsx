import React from "react";
import { Button, Dropdown, Input, Tooltip } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  MoreOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { Item, SavedCourse } from "../courseStorage";
import { KindIcon, kindOf } from "./kinds";
import { AiMark } from "./parts";
import type { ItemState } from "./readiness";

const formatMinutes = (total: number) =>
  total >= 60 ? `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m` : `${total} min`;

export default function OutlinePanel({
  course,
  states,
  selected,
  suggesting,
  onSelect,
  onRenameModule,
  onMoveModule,
  onRemoveModule,
  onMoveItem,
  onAddItem,
  onAddModule,
  onSuggest,
}: {
  course: SavedCourse;
  states: Record<string, ItemState>;
  selected?: string;
  suggesting: boolean;
  onSelect: (id: string) => void;
  onRenameModule: (id: string, title: string) => void;
  onMoveModule: (index: number, direction: number) => void;
  onRemoveModule: (id: string) => void;
  onMoveItem: (item: Item, direction: number) => void;
  onAddItem: (moduleId?: string) => void;
  onAddModule: () => void;
  onSuggest: () => void;
}) {
  const modules = course.modules || [];
  const total = course.items.reduce((sum, item) => sum + (item.minutes || 0), 0);
  return (
    <nav className="cb-panel cb-outline" aria-label="Course outline">
      <div className="cb-outline-head">
        <strong>Outline</strong>
        <span className="cb-muted cb-tnum">
          {course.items.length} items · {formatMinutes(total)}
        </span>
      </div>
      <div className="cb-outline-body">
        {modules.map((module, index) => {
          const rows = course.items.filter((item) => item.moduleId === module.id);
          return (
            <section key={module.id} className="cb-bmodule">
              <div className="cb-bmodule-head">
                <Input
                  id={`module-title-${module.id}`}
                  aria-label={`Module ${index + 1} title`}
                  variant="borderless"
                  className="cb-bmodule-title"
                  value={module.title}
                  placeholder="Module title"
                  onChange={(e) => onRenameModule(module.id, e.target.value)}
                />
                <span className="cb-bmodule-count cb-tnum">{rows.length}</span>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      { key: "add", icon: <PlusOutlined />, label: "Add item here" },
                      { key: "up", icon: <ArrowUpOutlined />, label: "Move module up", disabled: index === 0 },
                      { key: "down", icon: <ArrowDownOutlined />, label: "Move module down", disabled: index === modules.length - 1 },
                      { type: "divider" },
                      { key: "remove", icon: <DeleteOutlined />, label: "Remove module", danger: true, disabled: modules.length === 1 },
                    ],
                    onClick: ({ key }) => {
                      if (key === "add") onAddItem(module.id);
                      if (key === "up") onMoveModule(index, -1);
                      if (key === "down") onMoveModule(index, 1);
                      if (key === "remove") onRemoveModule(module.id);
                    },
                  }}
                >
                  <Button type="text" size="small" shape="round" icon={<MoreOutlined />} aria-label={`Module ${index + 1} actions`} />
                </Dropdown>
              </div>
              {rows.map((row, n) => {
                const state = states[row.id];
                return (
                  <div key={row.id} className={`cb-bitem ${row.id === selected ? "is-current" : ""}`}>
                    <button
                      type="button"
                      className="cb-bitem-select"
                      aria-current={row.id === selected ? "true" : undefined}
                      onClick={() => onSelect(row.id)}
                    >
                      <KindIcon kind={row.kind} />
                      <span className="cb-bitem-text">
                        <strong>{row.title || "Untitled item"}</strong>
                        <small className={`is-${state?.status}`}>
                          {state?.status === "ready" || !state
                            ? `${kindOf(row.kind).label} · ${row.minutes} min${row.required ? "" : " · Optional"}`
                            : state.note}
                        </small>
                      </span>
                      <Tooltip title={state?.status === "ready" ? "Ready" : state?.note}>
                        <span className={`cb-dot is-${state?.status || "ready"}`} />
                      </Tooltip>
                    </button>
                    <span className="cb-bitem-move">
                      <Button type="text" size="small" shape="round" aria-label="Move item up" disabled={n === 0} icon={<ArrowUpOutlined />} onClick={() => onMoveItem(row, -1)} />
                      <Button type="text" size="small" shape="round" aria-label="Move item down" disabled={n === rows.length - 1} icon={<ArrowDownOutlined />} onClick={() => onMoveItem(row, 1)} />
                    </span>
                  </div>
                );
              })}
              {!rows.length && (
                <button type="button" className="cb-empty-module" onClick={() => onAddItem(module.id)}>
                  <PlusOutlined /> Add the first item
                </button>
              )}
            </section>
          );
        })}
      </div>
      <div className="cb-outline-foot">
        <Button size="small" shape="round" icon={<PlusOutlined />} onClick={() => onAddItem()}>
          Add item
        </Button>
        <Button size="small" shape="round" onClick={onAddModule}>
          Add module
        </Button>
        <Button size="small" shape="round" className="cb-btn-ai" icon={<AiMark />} loading={suggesting} onClick={onSuggest}>
          Suggest what's missing
        </Button>
      </div>
    </nav>
  );
}

import React from "react";
import {
  Button,
  Input,
  Modal,
  Space,
  Tooltip,
  Typography,
  Upload,
  App,
} from "antd";
import {
  AudioOutlined,
  DeleteOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { Material } from "./courseStorage";

const kinds = [
  {
    kind: "document" as const,
    label: "Document",
    hint: "Supporting document — PDF, Word, presentation or text",
    icon: <FileTextOutlined />,
    color: "#1677ff",
    accept: ".pdf,.doc,.docx,.ppt,.pptx,.txt",
  },
  {
    kind: "image" as const,
    label: "Image",
    hint: "Illustrate a concept — PNG, JPEG, WebP or GIF",
    icon: <PictureOutlined />,
    color: "#389e0d",
    accept: "image/png,image/jpeg,image/webp,image/gif",
  },
  {
    kind: "video" as const,
    label: "Video link",
    hint: "Link a video or recorded lesson by URL",
    icon: <PlayCircleOutlined />,
    color: "#722ed1",
    accept: "",
  },
  {
    kind: "audio" as const,
    label: "Audio",
    hint: "Audio explanation — upload a voice note or recording",
    icon: <AudioOutlined />,
    color: "#d46b08",
    accept: "audio/*",
  },
];
export function MaterialPreview({ materials }: { materials: Material[] }) {
  return (
    <div className="course-material-preview">
      {materials.map((material) => (
        <div key={material.id}>
          {material.kind === "image" ? (
            <img
              src={material.url}
              alt={material.name}
              style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10 }}
            />
          ) : material.kind === "audio" ? (
            <>
              <Typography.Paragraph>{material.name}</Typography.Paragraph>
              <audio controls src={material.url} style={{ width: "100%" }} />
            </>
          ) : (
            <a
              href={material.url}
              target="_blank"
              rel="noopener noreferrer"
              download={
                material.kind === "document" ? material.name : undefined
              }
            >
              {material.kind === "video" ? (
                <PlayCircleOutlined />
              ) : (
                <FileTextOutlined />
              )}{" "}
              {material.name}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
export default function Materials({
  materials,
  onAdd,
  onRemove,
}: {
  materials: Material[];
  onAdd: (material: Material) => void;
  onRemove: (id: string) => void;
}) {
  const { message } = App.useApp();
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const upload = async (file: File, kind: Material["kind"]) => {
    const valid =
      kind === "document"
        ? /\.(pdf|docx?|pptx?|txt)$/i.test(file.name)
        : kind === "image"
        ? /^image\/(png|jpeg|webp|gif)$/.test(file.type)
        : kind === "audio" && file.type.startsWith("audio/");
    if (!valid) {
      message.error("Choose a supported file for this material type.");
      return false;
    }
    if (file.size > 25 * 1024 * 1024) {
      message.error("Choose a file smaller than 25 MB.");
      return false;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      onAdd({ id: crypto.randomUUID(), kind, name: file.name, url: data });
    } catch {
      message.error("Could not read this file. Please try again.");
    }
    return false;
  };
  return (
    <>
      <div className="course-section-label">
        <Typography.Text strong>Learning materials</Typography.Text>
        <Tooltip title="Up to 25 MB per file. Save the draft to keep attached materials.">
          <InfoCircleOutlined className="course-info" />
        </Tooltip>
        {materials.length > 0 && (
          <Typography.Text type="secondary">
            · {materials.length} attached
          </Typography.Text>
        )}
      </div>
      <div className="course-material-grid">
        {kinds.map((type) => {
          const card = (
            <button
              type="button"
              className="course-material-card"
              style={{ "--material-color": type.color } as React.CSSProperties}
              onClick={
                type.kind === "video" ? () => setVideoOpen(true) : undefined
              }
            >
              <span className="course-material-icon">{type.icon}</span>
              <span className="course-material-label">{type.label}</span>
              <Tooltip title={type.hint}>
                <InfoCircleOutlined
                  className="course-info"
                  onClick={(e) => e.stopPropagation()}
                />
              </Tooltip>
              <PlusOutlined className="course-material-add" />
            </button>
          );
          return type.kind === "video" ? (
            <React.Fragment key={type.kind}>{card}</React.Fragment>
          ) : (
            <Upload
              key={type.kind}
              accept={type.accept}
              showUploadList={false}
              beforeUpload={(file) => upload(file, type.kind)}
            >
              {card}
            </Upload>
          );
        })}
      </div>
      {materials.map((material) => (
        <div className="course-material-row" key={material.id}>
          <Space>
            <span
              style={{
                color: kinds.find((type) => type.kind === material.kind)?.color,
              }}
            >
              {kinds.find((type) => type.kind === material.kind)?.icon}
            </span>
            <Typography.Text ellipsis>{material.name}</Typography.Text>
          </Space>
          <Button
            shape="circle"
            size="small"
            type="text"
            aria-label={`Remove ${material.name}`}
            icon={<DeleteOutlined />}
            danger
            onClick={() => onRemove(material.id)}
          />
        </div>
      ))}
      <Modal
        className="academy-modal"
        title="Add video URL"
        open={videoOpen}
        onCancel={() => setVideoOpen(false)}
        okText="Add video"
        onOk={() => {
          try {
            const parsed = new URL(url);
            if (!["http:", "https:"].includes(parsed.protocol))
              throw new Error();
            onAdd({
              id: crypto.randomUUID(),
              kind: "video",
              name: title.trim() || parsed.hostname,
              url: parsed.href,
            });
            setVideoOpen(false);
            setUrl("");
            setTitle("");
          } catch {
            message.error("Enter a valid http or https video URL.");
          }
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            aria-label="Video title"
            placeholder="Video title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            aria-label="Video URL"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Space>
      </Modal>
    </>
  );
}

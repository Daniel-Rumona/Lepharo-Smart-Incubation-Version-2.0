import { Badge, Button, Divider, Empty, List, Popover, Space, Tooltip, Typography } from "antd";
import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useNotificationCenter, type NotificationRecord } from "@/hooks/useNotificationCenter";

dayjs.extend(relativeTime);

const { Text } = Typography;

const ACTION_BUTTON_TYPE: Record<string, "primary" | "default" | "dashed"> = {
  primary: "primary",
  danger: "primary",
  default: "default",
};

function NotificationItem({
  notif,
  onOpen,
  onAction,
}: {
  notif: NotificationRecord;
  onOpen: (notif: NotificationRecord) => void;
  onAction: (notif: NotificationRecord, actionId: string) => void;
}) {
  const isUnread = !notif.readBy || Object.keys(notif.readBy).length === 0;
  const description = resolveDescription(notif);
  const when = notif.createdAt?.toDate ? dayjs(notif.createdAt.toDate()) : null;

  return (
    <List.Item
      style={{ cursor: notif.link ? "pointer" : "default", alignItems: "flex-start" }}
      onClick={() => onOpen(notif)}
    >
      <List.Item.Meta
        avatar={isUnread ? <Badge status="processing" /> : <span style={{ display: "inline-block", width: 8 }} />}
        title={
          <Space size={6}>
            <Text strong={isUnread}>{notif.type ? String(notif.type).replace(/[_-]+/g, " ") : "Notification"}</Text>
            {when && <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>{when.fromNow()}</Text>}
          </Space>
        }
        description={<Text type="secondary">{description}</Text>}
      />
      {!!notif.actions?.length && !!notif.actionTarget && (
        <Space onClick={(e) => e.stopPropagation()}>
          {notif.actions.map((action) => (
            <Button
              key={action.actionId}
              size="small"
              type={ACTION_BUTTON_TYPE[action.style || "default"]}
              danger={action.style === "danger"}
              onClick={() => onAction(notif, action.actionId)}
            >
              {action.label}
            </Button>
          ))}
        </Space>
      )}
    </List.Item>
  );
}

function resolveDescription(notif: NotificationRecord): string {
  if (typeof notif.message === "string" && notif.message) return notif.message;
  if (notif.message && typeof notif.message === "object") {
    const first = Object.values(notif.message).find(Boolean);
    if (first) return String(first);
  }
  return "";
}

export const NotificationBell = () => {
  const { permission, registering, requestPermission } = usePushNotifications();
  const { notifications, unreadCount, markAsRead, applyAction } = useNotificationCenter();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleOpenNotif = (notif: NotificationRecord) => {
    markAsRead(notif.id);
    if (notif.link) {
      setOpen(false);
      navigate(notif.link);
    }
  };

  const handleAction = (notif: NotificationRecord, actionId: string) => {
    applyAction(notif, actionId);
  };

  const markAllRead = () => {
    notifications.forEach((n) => {
      if (!n.readBy || Object.keys(n.readBy).length === 0) markAsRead(n.id);
    });
  };

  const content = (
    <div style={{ width: 360 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text strong>Notifications</Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" icon={<CheckOutlined />} onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {notifications.length === 0 ? (
          <Empty description="No notifications yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            dataSource={notifications}
            renderItem={(notif) => (
              <NotificationItem notif={notif} onOpen={handleOpenNotif} onAction={handleAction} />
            )}
          />
        )}
      </div>
      {permission !== "unsupported" && permission !== "granted" && (
        <>
          <Divider style={{ margin: "8px 0" }} />
          <Button
            type="text"
            size="small"
            block
            loading={registering}
            disabled={permission === "denied"}
            onClick={requestPermission}
          >
            {permission === "denied" ? "Push notifications blocked in browser settings" : "Enable push notifications"}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      arrow={false}
    >
      <Tooltip title="Notifications">
        <Badge count={unreadCount} size="small" offset={[-2, 2]}>
          <Button type="text" shape="circle" icon={<BellOutlined />} />
        </Badge>
      </Tooltip>
    </Popover>
  );
};

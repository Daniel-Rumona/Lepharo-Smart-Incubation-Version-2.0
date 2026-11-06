import { Badge, Button, Dropdown, Tooltip } from "antd";
import {
  AlertOutlined,
  AuditOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckOutlined,
  CheckSquareOutlined,
  FileProtectOutlined,
  FlagOutlined,
  InboxOutlined,
  MessageOutlined,
  NotificationOutlined,
  RightOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useState, type ReactNode } from "react";
import { useWindowSize } from "react-use";
import { useNavigate } from "react-router-dom";

import { usePushNotifications } from "@/hooks/usePushNotifications";
import { notificationLink, useNotificationCenter, type NotificationRecord } from "@/hooks/useNotificationCenter";
import "./notification-panel.css";

dayjs.extend(relativeTime);

type Filter = "all" | "unread";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
];

/** First keyword match wins, so the more specific words come first. */
const TYPE_ICONS: Array<[RegExp, ReactNode]> = [
  [/overdue|escalat|expir|reject|declin/, <AlertOutlined />],
  [/appointment|meeting|governance|leave/, <CalendarOutlined />],
  [/task|kpi/, <CheckSquareOutlined />],
  [/compliance|moa|mov|invoice/, <FileProtectOutlined />],
  [/inquir|query/, <MessageOutlined />],
  [/application|request/, <SolutionOutlined />],
  [/intervention|plan|roadmap|group|challenge|outcome/, <FlagOutlined />],
  [/system/, <NotificationOutlined />],
  [/report|audit/, <AuditOutlined />],
];

function iconFor(type?: string): ReactNode {
  const key = String(type || "").toLowerCase();
  return TYPE_ICONS.find(([pattern]) => pattern.test(key))?.[1] ?? <BellOutlined />;
}

function titleFor(type?: string): string {
  const text = String(type || "").replace(/[_-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Notification";
}

function NotificationRow({
  notif,
  isUnread,
  description,
  onOpen,
  onAction,
}: {
  notif: NotificationRecord;
  isUnread: boolean;
  description: string;
  onOpen: (notif: NotificationRecord) => void;
  onAction: (notif: NotificationRecord, actionId: string) => void;
}) {
  const when = notif.createdAt?.toDate ? dayjs(notif.createdAt.toDate()) : null;
  const hasLink = !!notificationLink(notif);
  const hasActions = !!notif.actions?.length && !!notif.actionTarget;

  return (
    <div className={isUnread ? "notif-panel-item is-unread" : "notif-panel-item"}>
      <button type="button" className="notif-panel-row" onClick={() => onOpen(notif)}>
        <span className="notif-panel-icon">{iconFor(notif.type)}</span>
        <span className="notif-panel-label">
          <span className="notif-panel-title">
            <strong>{titleFor(notif.type)}</strong>
            {when && <time title={when.format("D MMM YYYY, HH:mm")}>{when.fromNow(true)}</time>}
          </span>
          {description && <small>{description}</small>}
        </span>
        {isUnread ? <span className="notif-panel-dot" aria-label="Unread" /> : hasLink && <RightOutlined className="notif-panel-chevron" />}
      </button>
      {hasActions && (
        <div className="notif-panel-row-actions">
          {notif.actions!.map((action) => (
            <Button
              key={action.actionId}
              size="small"
              type={action.style === "default" || !action.style ? "default" : "primary"}
              danger={action.style === "danger"}
              onClick={() => onAction(notif, action.actionId)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The bell and its notification panel, built from the same pieces as the
 * account panel (current-user/account-menu.css): accent-wash header, icon-tile
 * rows and the pill strip, so the two top-bar menus read as one system.
 */
export const NotificationBell = () => {
  const { permission, registering, requestPermission } = usePushNotifications();
  const { notifications, unreadCount, isUnread, markAsRead, markAllAsRead, applyAction, resolveMessage } =
    useNotificationCenter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const navigate = useNavigate();
  // A tooltip behind the panel steals the first tap on touch screens.
  const { width } = useWindowSize();
  const isMobile = width < 768;

  const visible = filter === "unread" ? notifications.filter(isUnread) : notifications;

  const handleOpenNotif = (notif: NotificationRecord) => {
    markAsRead(notif.id);
    const link = notificationLink(notif);
    if (link) {
      setOpen(false);
      navigate(link);
    }
  };

  const canEnablePush = permission !== "unsupported" && permission !== "granted";

  const panel = (
    <div className="notif-panel" role="dialog" aria-label="Notifications">
      <div className="notif-panel-head">
        <span className="notif-panel-head-icon">
          <BellOutlined />
        </span>
        <div className="notif-panel-head-id">
          <strong>Notifications</strong>
          <span className="notif-panel-count">
            {unreadCount ? `${unreadCount} unread` : "All caught up"}
          </span>
        </div>
        {unreadCount > 0 && (
          <button type="button" className="notif-panel-markall" onClick={markAllAsRead}>
            <CheckOutlined /> Mark all read
          </button>
        )}
      </div>

      <div className="notif-panel-filters" role="radiogroup" aria-label="Show">
        {FILTERS.map((option) => {
          const active = filter === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? "notif-panel-filter is-active" : "notif-panel-filter"}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
              {option.key === "unread" && unreadCount > 0 && <span className="notif-panel-filter-count">{unreadCount}</span>}
            </button>
          );
        })}
      </div>

      <div className="notif-panel-list">
        {visible.length === 0 ? (
          <div className="notif-panel-empty">
            <span className="notif-panel-icon">
              <InboxOutlined />
            </span>
            <strong>{filter === "unread" ? "No unread notifications" : "No notifications yet"}</strong>
            <small>Updates about your work will show up here.</small>
          </div>
        ) : (
          visible.map((notif) => (
            <NotificationRow
              key={notif.id}
              notif={notif}
              isUnread={isUnread(notif)}
              description={resolveMessage(notif)}
              onOpen={handleOpenNotif}
              onAction={applyAction}
            />
          ))
        )}
      </div>

      {canEnablePush && (
        <button
          type="button"
          className="notif-panel-row notif-panel-push"
          disabled={permission === "denied" || registering}
          title={permission === "denied" ? "Allow notifications for this site in your browser settings" : undefined}
          onClick={requestPermission}
        >
          <span className="notif-panel-icon">
            <NotificationOutlined />
          </span>
          <span className="notif-panel-label">
            <strong>{registering ? "Enabling…" : "Push notifications"}</strong>
            <small>
              {permission === "denied"
                ? "Blocked in your browser settings"
                : "Get alerts even when this tab is closed"}
            </small>
          </span>
          <RightOutlined className="notif-panel-chevron" />
        </button>
      )}
    </div>
  );

  const trigger = (
    <Badge count={unreadCount} size="small" offset={[-2, 2]}>
      <Button
        type="text"
        shape="circle"
        className="workspace-notification-button"
        icon={<BellOutlined />}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
      />
    </Badge>
  );

  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      dropdownRender={() => panel}
    >
      {isMobile || open ? trigger : <Tooltip title="Notifications">{trigger}</Tooltip>}
    </Dropdown>
  );
};

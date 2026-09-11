import { Button, Tooltip } from "antd";
import { BellOutlined } from "@ant-design/icons";

import { usePushNotifications } from "@/hooks/usePushNotifications";

export const NotificationBell = () => {
  const { permission, registering, requestPermission } = usePushNotifications();

  if (permission === "unsupported") return null;

  if (permission === "granted") {
    return (
      <Tooltip title="Push notifications are on">
        <Button type="text" shape="circle" icon={<BellOutlined style={{ color: "#52c41a" }} />} />
      </Tooltip>
    );
  }

  return (
    <Tooltip
      title={
        permission === "denied"
          ? "Notifications are blocked in your browser settings"
          : "Enable push notifications"
      }
    >
      <Button
        type="text"
        shape="circle"
        icon={<BellOutlined />}
        loading={registering}
        disabled={permission === "denied"}
        onClick={requestPermission}
      />
    </Tooltip>
  );
};

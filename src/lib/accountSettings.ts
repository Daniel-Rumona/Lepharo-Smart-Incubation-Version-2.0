export const ACCOUNT_SETTINGS_SIGNAL = 'ui:open-account-settings';

export function requestOpenAccountSettings() {
  window.dispatchEvent(new CustomEvent(ACCOUNT_SETTINGS_SIGNAL));
}

export function onRequestOpenAccountSettings(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(ACCOUNT_SETTINGS_SIGNAL, handler);
  return () => window.removeEventListener(ACCOUNT_SETTINGS_SIGNAL, handler);
}

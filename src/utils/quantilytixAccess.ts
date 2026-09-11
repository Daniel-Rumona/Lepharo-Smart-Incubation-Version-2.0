export const QUANTILYTIX_DOMAIN = '@quantilytix.co.za';

export const isQuantilytixDomain = (email?: string | null): boolean =>
  !!email && email.trim().toLowerCase().endsWith(QUANTILYTIX_DOMAIN);

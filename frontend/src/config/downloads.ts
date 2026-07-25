const publicAppOrigin =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ? window.location.origin
    : 'https://mnemosyne-one.web.app';

export const MOBILE_APP_DOWNLOAD_URL =
  import.meta.env.VITE_MOBILE_APP_DOWNLOAD_URL ||
  `${publicAppOrigin}/downloads/mnemosyne-android.apk`;

export const DESKTOP_APP_DOWNLOAD_URL =
  import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL ||
  `${publicAppOrigin}/downloads/mnemosyne-desktop.exe`;

export const openExternalDownload = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

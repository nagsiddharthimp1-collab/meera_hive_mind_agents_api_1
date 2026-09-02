export type BrowserContext = {
  isEmbedded: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  reason: string | null;
  userAgent: string;
};

const IN_APP_TOKENS = [
  'fban',
  'fbav',
  'instagram',
  'line/',
  'micromessenger',
  'snapchat',
  'tiktok',
  'musical_ly',
  'linkedinapp',
  'kakaotalk',
  'pinterest',
  'telegram',
  'whatsapp',
  'messenger',
  'reddit',
  'discord',
  'gsa/',
];

const IOS_ALT_BROWSERS = ['crios', 'fxios', 'edgios', 'opios'];

const getUA = (): string => (typeof navigator === 'undefined' ? '' : (navigator.userAgent || '').toLowerCase());

const isIOSDevice = (ua: string): boolean => {
  const iosClassic = /iphone|ipad|ipod/.test(ua);
  const iPadDesktopMode = ua.includes('macintosh') && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  return iosClassic || iPadDesktopMode;
};

const isStandaloneMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
};

export const getBrowserContext = (): BrowserContext => {
  const userAgent = getUA();
  const isIOS = isIOSDevice(userAgent);
  const isAndroid = userAgent.includes('android');
  const isStandalone = isStandaloneMode();

  if (!userAgent || isStandalone) {
    return { isEmbedded: false, isStandalone, isIOS, isAndroid, reason: null, userAgent };
  }

  if (IN_APP_TOKENS.some((token) => userAgent.includes(token))) {
    return { isEmbedded: true, isStandalone, isIOS, isAndroid, reason: 'in_app_token', userAgent };
  }

  if (isAndroid && (userAgent.includes('; wv') || userAgent.includes(' wv)'))) {
    return { isEmbedded: true, isStandalone, isIOS, isAndroid, reason: 'android_webview', userAgent };
  }

  if (isIOS) {
    const hasAppleWebKit = userAgent.includes('applewebkit');
    const hasSafari = userAgent.includes('safari');
    const hasVersion = userAgent.includes('version/');
    const hasKnownIOSBrowser = IOS_ALT_BROWSERS.some((token) => userAgent.includes(token));
    if (hasAppleWebKit && hasSafari && !hasVersion && !hasKnownIOSBrowser) {
      return { isEmbedded: true, isStandalone, isIOS, isAndroid, reason: 'ios_webview_signature', userAgent };
    }
  }

  return { isEmbedded: false, isStandalone, isIOS, isAndroid, reason: null, userAgent };
};

export const isEmbeddedInAppBrowser = (): boolean => getBrowserContext().isEmbedded;

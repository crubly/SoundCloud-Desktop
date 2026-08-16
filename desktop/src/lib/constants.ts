// Единые сетевые точки приложения.
//
// SoundCloud-only build: никаких запросов к scnative.* больше нет. Каталог,
// стриминг и скачивание идут напрямую в SoundCloud (api-v2.soundcloud.com)
// через локальный Rust-сервер (`scapi`), который монтируется на proxy_port.
// Все поля ниже — живые биндинги: setServerPorts() выставляется в bootstrap
// до первого запроса (см. main.tsx).

export let API_BASE = '';
/**
 * Резервный «star»-хост больше не существует (премиум-инфраструктура удалена).
 * Оставляем имя для обратной совместимости импортов — значение то же, что у
 * API_BASE, реальных запросов к отдельному хосту нет.
 */
export let API_STAR_BASE = '';
export let STREAMING_BASE = '';
export let STREAMING_PREMIUM_BASE = '';
export let STORAGE_BASE = '';
export let STORAGE_PREMIUM_BASE = '';
/** Upstream для прокси картинок: 'direct' = локальный прокси качает сам
 *  (SoundCloud-CDN), минуя их CDN. */
export let IMAGES_BASE = 'direct';
export let PAY_BASE = '';

export const GITHUB_OWNER = 'zxcloli666';
export const GITHUB_REPO = 'SoundCloud-Desktop';
export const APP_VERSION = __APP_VERSION__;

export const SHOW_NEWS = true;
export const CHECK_UPDATES = false;

export interface NewsItem {
  id: string;
  image?: string;
  titleKey: string;
  descriptionKey: string;
  bodyKey: string;
  accent?: string;
}

export const NEWS: NewsItem[] = [];

let _staticPort: number | null = null;
let _proxyPort: number | null = null;

export function setServerPorts(staticP: number, proxy: number) {
  _staticPort = staticP;
  _proxyPort = proxy;
  const api = `http://127.0.0.1:${proxy}`;
  API_BASE = api;
  API_STAR_BASE = api;
  STREAMING_BASE = api;
  STREAMING_PREMIUM_BASE = api;
  STORAGE_BASE = api;
  STORAGE_PREMIUM_BASE = api;
  PAY_BASE = api;
}

export function getStaticPort(): number | null {
  return _staticPort;
}

export function getProxyPort(): number | null {
  return _proxyPort;
}
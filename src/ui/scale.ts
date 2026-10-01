import { isTauri } from '../platform/tauri';

export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 1.6;

let cssZoom = 1;
let defaultScale = 1;

/** The scale used until the player picks one (the web page starts larger than the desktop app). */
export const defaultUiScale = () => defaultScale;
export function setDefaultUiScale(s: number) {
  defaultScale = s;
}

/**
 * The CSS zoom in effect (1 in the desktop app, which zooms natively). Pointer maths inside zoomed content
 * divides by this so drag-and-drop and box selection stay lined up.
 */
export const uiZoom = () => cssZoom;

/** Scales the whole interface: native webview zoom in the desktop app, CSS zoom in a browser. */
export async function applyUiScale(scale: number) {
  const s = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Number.isFinite(scale) ? scale : 1));
  if (isTauri()) {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(s);
      cssZoom = 1;
      document.documentElement.style.removeProperty('zoom');
      return;
    } catch {
      /* fall back to CSS zoom */
    }
  }
  cssZoom = s;
  if (s === 1) document.documentElement.style.removeProperty('zoom');
  else document.documentElement.style.setProperty('zoom', String(s));
}

/** The saved scale, read before the app's store exists (so the start screen is scaled too). */
export function savedUiScale(): number {
  try {
    return Number(JSON.parse(localStorage.getItem('hlb-settings') ?? localStorage.getItem('hv-settings') ?? '{}').uiScale) || defaultScale;
  } catch {
    return defaultScale;
  }
}

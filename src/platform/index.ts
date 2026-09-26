import { browserPlatform, browserSupported } from './browser';
import { createDemoPlatform } from './demo';
import { isTauri, tauriPlatform } from './tauri';
import type { Platform } from './types';

export type { Platform, SaveFileEntry, UpdateInfo } from './types';

export function availablePlatforms(): Platform[] {
  if (isTauri()) return [tauriPlatform];
  const list: Platform[] = [];
  if (browserSupported()) list.push(browserPlatform);
  list.push(createDemoPlatform());
  return list;
}

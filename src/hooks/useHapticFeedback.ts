/**
 * useHapticFeedback — Native Haptic Feedback Hook
 *
 * Abstraktionsschicht über @capacitor/haptics.
 * Auf iOS: Core Haptics (UIImpactFeedbackGenerator, UINotificationFeedbackGenerator).
 * Auf Android: VibrationEffect API (API 26+), Fallback auf legacy vibrate().
 * Im Browser: Web Vibration API als Fallback.
 *
 * Alle Patterns sind für 120Hz-Displays optimiert (kurze, präzise Impulse).
 */

import { useCallback, useRef } from 'react';
import type { HapticPattern } from '../types';

// Capacitor Haptics — wird zur Laufzeit dynamisch importiert,
// damit der Code auch im Web-Build ohne native Plugins kompiliert.
type HapticsPlugin = {
  impact: (opts: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }) => Promise<void>;
  notification: (opts: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }) => Promise<void>;
  selectionStart: () => Promise<void>;
  selectionChanged: () => Promise<void>;
  selectionEnd: () => Promise<void>;
  vibrate: (opts: { duration: number }) => Promise<void>;
};

// Vibrations-Sequenzen für Web-Fallback (ms: an, aus, an, ...)
const WEB_VIBRATION_PATTERNS: Record<HapticPattern, number | number[]> = {
  light:          10,
  medium:         20,
  heavy:          40,
  success:        [10, 50, 10],
  warning:        [30, 40, 30],
  error:          [50, 30, 50, 30, 50],
  selection:      8,
  win:            [20, 30, 20, 30, 60],
  lose:           [60, 40, 60],
  draw:           [20, 20, 20],
  skill_activate: [15, 20, 30],
};

async function getHapticsPlugin(): Promise<HapticsPlugin | null> {
  try {
    // Dynamischer Import — schlägt im reinen Browser-Build fehl
    const { Haptics } = await import('@capacitor/haptics');
    return Haptics as unknown as HapticsPlugin;
  } catch {
    return null;
  }
}

function webVibrate(pattern: HapticPattern): void {
  if (!('vibrate' in navigator)) return;
  const p = WEB_VIBRATION_PATTERNS[pattern];
  navigator.vibrate(p);
}

// ----------------------------------------------------------------

export interface UseHapticFeedbackReturn {
  /** Einzelner Impuls (Zug setzen, Button-Tap) */
  impact: (style?: 'light' | 'medium' | 'heavy') => void;
  /** Systembenachrichtigung (Sieg, Fehler, Warnung) */
  notify: (type: 'success' | 'warning' | 'error') => void;
  /** Semantisches Pattern nach Spielereignis */
  trigger: (pattern: HapticPattern) => void;
  /** Selection-Feedback für Scroll/Picker */
  selectionChanged: () => void;
  /** Haptik global deaktivieren */
  setEnabled: (enabled: boolean) => void;
  enabled: boolean;
}

export function useHapticFeedback(): UseHapticFeedbackReturn {
  const enabledRef = useRef<boolean>(true);
  const pluginRef = useRef<HapticsPlugin | null | 'loading'>('loading');

  // Lazy-load des Plugins beim ersten Aufruf
  const ensurePlugin = useCallback(async (): Promise<HapticsPlugin | null> => {
    if (pluginRef.current !== 'loading') return pluginRef.current;
    const plugin = await getHapticsPlugin();
    pluginRef.current = plugin;
    return plugin;
  }, []);

  const impact = useCallback(
    (style: 'light' | 'medium' | 'heavy' = 'medium') => {
      if (!enabledRef.current) return;
      const styleMap = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' } as const;
      ensurePlugin().then((plugin) => {
        if (plugin) {
          plugin.impact({ style: styleMap[style] }).catch(() => webVibrate(style));
        } else {
          webVibrate(style);
        }
      });
    },
    [ensurePlugin],
  );

  const notify = useCallback(
    (type: 'success' | 'warning' | 'error') => {
      if (!enabledRef.current) return;
      const typeMap = {
        success: 'SUCCESS',
        warning: 'WARNING',
        error: 'ERROR',
      } as const;
      ensurePlugin().then((plugin) => {
        if (plugin) {
          plugin.notification({ type: typeMap[type] }).catch(() => webVibrate(type));
        } else {
          webVibrate(type);
        }
      });
    },
    [ensurePlugin],
  );

  const trigger = useCallback(
    (pattern: HapticPattern) => {
      if (!enabledRef.current) return;
      ensurePlugin().then((plugin) => {
        if (!plugin) {
          webVibrate(pattern);
          return;
        }
        // Mapping semantischer Patterns auf native APIs
        switch (pattern) {
          case 'win':
            plugin.notification({ type: 'SUCCESS' }).catch(() => webVibrate(pattern));
            break;
          case 'lose':
            plugin.notification({ type: 'ERROR' }).catch(() => webVibrate(pattern));
            break;
          case 'draw':
            plugin.notification({ type: 'WARNING' }).catch(() => webVibrate(pattern));
            break;
          case 'skill_activate':
            plugin.impact({ style: 'MEDIUM' })
              .then(() => new Promise<void>((r) => setTimeout(r, 80)))
              .then(() => plugin.impact({ style: 'LIGHT' }))
              .catch(() => webVibrate(pattern));
            break;
          case 'selection':
            plugin.selectionChanged().catch(() => webVibrate(pattern));
            break;
          case 'light':
            plugin.impact({ style: 'LIGHT' }).catch(() => webVibrate(pattern));
            break;
          case 'medium':
            plugin.impact({ style: 'MEDIUM' }).catch(() => webVibrate(pattern));
            break;
          case 'heavy':
            plugin.impact({ style: 'HEAVY' }).catch(() => webVibrate(pattern));
            break;
          default:
            webVibrate(pattern);
        }
      });
    },
    [ensurePlugin],
  );

  const selectionChanged = useCallback(() => {
    if (!enabledRef.current) return;
    ensurePlugin().then((plugin) => {
      if (plugin) {
        plugin.selectionChanged().catch(() => webVibrate('selection'));
      } else {
        webVibrate('selection');
      }
    });
  }, [ensurePlugin]);

  const setEnabled = useCallback((val: boolean) => {
    enabledRef.current = val;
  }, []);

  return {
    impact,
    notify,
    trigger,
    selectionChanged,
    setEnabled,
    get enabled() {
      return enabledRef.current;
    },
  };
}

/**
 * Capacitor Configuration
 * Targets: iOS (.ipa), Android (.apk/.aab), Electron/Windows (.exe)
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.tacnexus.app',
  appName: 'TAC·NEXUS',
  webDir: 'dist',

  // ---- iOS ----
  ios: {
    // Minimale iOS-Version: 15.0 (Core Haptics, Multipeer Connectivity)
    // Info.plist-Einträge werden über Capacitor-Hooks gesetzt
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: false,
    // 120Hz ProMotion Display: CADisplayLink mit preferredFrameRateRange
    // wird automatisch vom WKWebView genutzt
    backgroundColor: '#0a0a0f',
  },

  // ---- Android ----
  android: {
    // Minimale Android-Version: API 26 (VibrationEffect, BLE Advertiser)
    backgroundColor: '#0a0a0f',
    allowMixedContent: false,
    captureInput: true,
    // Hardware-beschleunigtes Rendering für 120Hz
    webContentsDebuggingEnabled: false,
  },

  // ---- Plugins ----
  plugins: {
    // Live Updates via Capgo
    CapacitorUpdater: {
      autoUpdate: true,
      stats: true,
      resetWhenUpdateFailed: true
    },

    // Haptics
    Haptics: {},

    // Persistenter Key-Value-Store (ersetzt localStorage)
    Preferences: {
      group: 'de.tacnexus.prefs',
    },

    // Status-Bar (vollbild, kein weißer Rand)
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0f',
      overlaysWebView: true,
    },

    // Splash-Screen
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0a0a0f',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },

    // App-Lifecycle
    App: {
      // Verhindert Schließen bei Back-Button (Android)
    },

    // Keyboard (verhindert Layout-Shift)
    Keyboard: {
      resize: 'body',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
  },

  // ---- Server (nur für Dev) ----
  server: {
    // Im Production-Build wird kein Server verwendet
    androidScheme: 'https',
    iosScheme: 'ionic',
    // cleartext: false — kein HTTP, nur HTTPS/lokale Dateien
  },
};

export default config;

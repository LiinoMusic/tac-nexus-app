/**
 * Capacitor After-Sync Hook: iOS Berechtigungen
 *
 * Wird ausgeführt nach `npx cap sync ios`.
 * Fügt notwendige Info.plist-Einträge für native APIs hinzu.
 *
 * Verwendung in capacitor.config.ts:
 *   hooks: { afterSync: ['node capacitor-hooks/ios-permissions.js'] }
 *
 * Oder manuell in ios/App/App/Info.plist einfügen.
 */

const fs = require('fs');
const path = require('path');

const PLIST_PATH = path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist');

const PERMISSIONS = `
  <!-- Bluetooth LE (BLE P2P) -->
  <key>NSBluetoothAlwaysUsageDescription</key>
  <string>TAC·NEXUS nutzt Bluetooth für lokalen Multiplayer ohne Internet.</string>
  <key>NSBluetoothPeripheralUsageDescription</key>
  <string>TAC·NEXUS nutzt Bluetooth für lokalen Multiplayer ohne Internet.</string>

  <!-- Multipeer Connectivity (Wi-Fi P2P auf iOS) -->
  <key>NSLocalNetworkUsageDescription</key>
  <string>TAC·NEXUS nutzt das lokale Netzwerk für Multiplayer ohne Internet.</string>
  <key>NSBonjourServices</key>
  <array>
    <string>_tacnexus._tcp</string>
    <string>_tacnexus._udp</string>
  </array>

  <!-- Vollbild-Modus -->
  <key>UIStatusBarHidden</key>
  <false/>
  <key>UIStatusBarStyle</key>
  <string>UIStatusBarStyleDarkContent</string>
  <key>UIViewControllerBasedStatusBarAppearance</key>
  <true/>

  <!-- Landscape + Portrait -->
  <key>UISupportedInterfaceOrientations</key>
  <array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
  </array>

  <!-- 120Hz ProMotion -->
  <key>CADisableMinimumFrameDurationOnPhone</key>
  <true/>
`;

if (fs.existsSync(PLIST_PATH)) {
  let content = fs.readFileSync(PLIST_PATH, 'utf8');
  if (!content.includes('NSBluetoothAlwaysUsageDescription')) {
    content = content.replace('</dict>\n</plist>', PERMISSIONS + '</dict>\n</plist>');
    fs.writeFileSync(PLIST_PATH, content);
    console.log('[Hook] iOS Info.plist aktualisiert.');
  } else {
    console.log('[Hook] iOS Info.plist bereits konfiguriert.');
  }
} else {
  console.warn('[Hook] Info.plist nicht gefunden. Bitte manuell einfügen.');
  console.log(PERMISSIONS);
}

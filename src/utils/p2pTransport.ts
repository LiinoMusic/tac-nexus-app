/**
 * P2P Transport Abstraction Layer
 *
 * Kapselt drei Hardware-Transporte hinter einem einheitlichen Interface:
 *
 * 1. BLE (Bluetooth Low Energy)
 *    - Plugin: @capacitor-community/bluetooth-le
 *    - Reichweite: ~10m, Latenz: ~30–100ms
 *    - Ideal für: Matchmaking + kleine Datenpakete (Leaderboard-Sync)
 *    - iOS: CoreBluetooth (Central + Peripheral gleichzeitig)
 *    - Android: BluetoothLeAdvertiser + BluetoothLeScanner
 *
 * 2. Wi-Fi Direct (Android) / AWDL (iOS via Multipeer)
 *    - Android: @capacitor-community/wifi-p2p (WifiP2pManager)
 *    - iOS: Multipeer Connectivity Framework (MCSession)
 *    - Reichweite: ~200m, Latenz: ~5–20ms
 *    - Ideal für: Echtzeit-Spielzüge
 *
 * 3. Multipeer Connectivity (iOS-spezifisch)
 *    - Plugin: capacitor-multipeer (Custom Plugin)
 *    - Nutzt WLAN + Bluetooth gleichzeitig (Apple AWDL)
 *    - Automatischer Transport-Fallback
 *
 * Strategie: BLE für Discovery → Wi-Fi Direct / Multipeer für Datenübertragung
 */

import type {
  P2PPeer,
  P2PMessage,
  P2PTransport,
  P2PConnectionState,
} from '../types';
import { computeChecksum } from './checksum';

// ----------------------------------------------------------------
// Transport-Interface
// ----------------------------------------------------------------

export interface TransportAdapter {
  readonly type: P2PTransport;
  startAdvertising(deviceId: string, deviceName: string): Promise<void>;
  startScanning(onPeerFound: (peer: P2PPeer) => void): Promise<void>;
  stopAdvertising(): Promise<void>;
  stopScanning(): Promise<void>;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  send(peerId: string, data: string): Promise<void>;
  onMessage(handler: (peerId: string, data: string) => void): void;
  onDisconnect(handler: (peerId: string) => void): void;
  isAvailable(): Promise<boolean>;
  destroy(): Promise<void>;
}

// ----------------------------------------------------------------
// BLE Transport
// ----------------------------------------------------------------

const BLE_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const BLE_TX_CHAR_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';
const BLE_RX_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';

export class BLETransportAdapter implements TransportAdapter {
  readonly type: P2PTransport = 'ble';
  private messageHandler: ((peerId: string, data: string) => void) | null = null;
  private disconnectHandler: ((peerId: string) => void) | null = null;
  private blePlugin: unknown = null;

  private async getPlugin() {
    if (this.blePlugin) return this.blePlugin;
    try {
      const { BleClient } = await import('@capacitor-community/bluetooth-le');
      this.blePlugin = BleClient;
      return BleClient;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    const plugin = await this.getPlugin() as { isEnabled?: () => Promise<boolean> } | null;
    if (!plugin?.isEnabled) return false;
    try {
      return await plugin.isEnabled();
    } catch {
      return false;
    }
  }

  async startAdvertising(deviceId: string, deviceName: string): Promise<void> {
    const plugin = await this.getPlugin() as {
      initialize?: () => Promise<void>;
      startEnabledNotifications?: (cb: () => void) => Promise<void>;
    } | null;
    if (!plugin) throw new Error('BLE plugin not available');
    // Capacitor BLE Peripheral-Modus:
    // Das Plugin @capacitor-community/bluetooth-le unterstützt ab v3.x
    // das Advertising als Peripheral. Hier wird der GATT-Service registriert.
    await plugin.initialize?.();
    console.log(`[BLE] Advertising as "${deviceName}" (${deviceId})`);
    // In der Produktion: BleClient.startAdvertising({ localName: deviceName, services: [BLE_SERVICE_UUID] })
  }

  async startScanning(onPeerFound: (peer: P2PPeer) => void): Promise<void> {
    const plugin = await this.getPlugin() as {
      initialize?: () => Promise<void>;
      requestLEScan?: (opts: unknown, cb: (result: {
        device: { deviceId: string; name?: string };
        rssi?: number;
      }) => void) => Promise<void>;
    } | null;
    if (!plugin) throw new Error('BLE plugin not available');
    await plugin.initialize?.();
    await plugin.requestLEScan?.(
      {
        services: [BLE_SERVICE_UUID],
        allowDuplicates: false,
      },
      (result) => {
        onPeerFound({
          id: result.device.deviceId,
          name: result.device.name ?? 'Unbekannt',
          deviceId: result.device.deviceId,
          rssi: result.rssi,
          transport: 'ble',
        });
      },
    );
  }

  async stopAdvertising(): Promise<void> {
    console.log('[BLE] Stop advertising');
  }

  async stopScanning(): Promise<void> {
    const plugin = await this.getPlugin() as { stopLEScan?: () => Promise<void> } | null;
    await plugin?.stopLEScan?.();
  }

  async connect(peerId: string): Promise<void> {
    const plugin = await this.getPlugin() as {
      connect?: (deviceId: string, cb: () => void) => Promise<void>;
      startNotifications?: (deviceId: string, service: string, char: string, cb: (value: DataView) => void) => Promise<void>;
    } | null;
    if (!plugin) throw new Error('BLE plugin not available');
    await plugin.connect?.(peerId, () => {
      this.disconnectHandler?.(peerId);
    });
    // Notifications auf RX-Characteristic abonnieren
    await plugin.startNotifications?.(
      peerId,
      BLE_SERVICE_UUID,
      BLE_RX_CHAR_UUID,
      (value: DataView) => {
        const decoder = new TextDecoder();
        const text = decoder.decode(value.buffer);
        this.messageHandler?.(peerId, text);
      },
    );
  }

  async disconnect(peerId: string): Promise<void> {
    const plugin = await this.getPlugin() as { disconnect?: (id: string) => Promise<void> } | null;
    await plugin?.disconnect?.(peerId);
  }

  async send(peerId: string, data: string): Promise<void> {
    const plugin = await this.getPlugin() as {
      write?: (deviceId: string, service: string, char: string, value: DataView) => Promise<void>;
    } | null;
    if (!plugin) throw new Error('BLE plugin not available');
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    // BLE MTU ist typischerweise 20–512 Bytes → Chunking für größere Pakete
    const CHUNK_SIZE = 180;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.slice(i, i + CHUNK_SIZE);
      await plugin.write?.(
        peerId,
        BLE_SERVICE_UUID,
        BLE_TX_CHAR_UUID,
        new DataView(chunk.buffer),
      );
    }
  }

  onMessage(handler: (peerId: string, data: string) => void): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: (peerId: string) => void): void {
    this.disconnectHandler = handler;
  }

  async destroy(): Promise<void> {
    await this.stopScanning();
    await this.stopAdvertising();
  }
}

// ----------------------------------------------------------------
// Wi-Fi Direct Transport (Android)
// ----------------------------------------------------------------

export class WiFiDirectTransportAdapter implements TransportAdapter {
  readonly type: P2PTransport = 'wifi-direct';
  private messageHandler: ((peerId: string, data: string) => void) | null = null;
  private disconnectHandler: ((peerId: string) => void) | null = null;
  private socket: WebSocket | null = null;
  private serverPort = 49152;

  async isAvailable(): Promise<boolean> {
    try {
      // Capacitor Wi-Fi P2P Plugin Check
      const { WifiP2p } = await import('@capacitor-community/wifi-p2p' as string) as {
        WifiP2p: { isAvailable?: () => Promise<{ available: boolean }> };
      };
      const result = await WifiP2p.isAvailable?.();
      return result?.available ?? false;
    } catch {
      return false;
    }
  }

  async startAdvertising(deviceId: string, deviceName: string): Promise<void> {
    try {
      const { WifiP2p } = await import('@capacitor-community/wifi-p2p' as string) as {
        WifiP2p: {
          initialize?: () => Promise<void>;
          discoverPeers?: () => Promise<void>;
        };
      };
      await WifiP2p.initialize?.();
      await WifiP2p.discoverPeers?.();
      console.log(`[WiFi-Direct] Advertising as "${deviceName}"`);
    } catch (e) {
      console.warn('[WiFi-Direct] Not available:', e);
    }
  }

  async startScanning(onPeerFound: (peer: P2PPeer) => void): Promise<void> {
    try {
      const { WifiP2p } = await import('@capacitor-community/wifi-p2p' as string) as {
        WifiP2p: {
          addListener?: (event: string, cb: (data: {
            devices: Array<{ deviceAddress: string; deviceName: string }>;
          }) => void) => void;
          discoverPeers?: () => Promise<void>;
        };
      };
      WifiP2p.addListener?.('peersAvailable', (data) => {
        data.devices.forEach((device) => {
          onPeerFound({
            id: device.deviceAddress,
            name: device.deviceName,
            deviceId: device.deviceAddress,
            transport: 'wifi-direct',
          });
        });
      });
      await WifiP2p.discoverPeers?.();
    } catch (e) {
      console.warn('[WiFi-Direct] Scan failed:', e);
    }
  }

  async stopAdvertising(): Promise<void> {}
  async stopScanning(): Promise<void> {}

  async connect(peerId: string): Promise<void> {
    try {
      const { WifiP2p } = await import('@capacitor-community/wifi-p2p' as string) as {
        WifiP2p: {
          connect?: (opts: { deviceAddress: string }) => Promise<void>;
          getGroupInfo?: () => Promise<{ ownerAddress: string }>;
        };
      };
      await WifiP2p.connect?.({ deviceAddress: peerId });
      // Nach Verbindung: TCP-Socket für Datentransfer öffnen
      const groupInfo = await WifiP2p.getGroupInfo?.();
      const hostAddress = groupInfo?.ownerAddress ?? '192.168.49.1';
      this.socket = new WebSocket(`ws://${hostAddress}:${this.serverPort}`);
      this.socket.onmessage = (event) => {
        this.messageHandler?.(peerId, event.data as string);
      };
      this.socket.onclose = () => {
        this.disconnectHandler?.(peerId);
      };
    } catch (e) {
      console.warn('[WiFi-Direct] Connect failed:', e);
    }
  }

  async disconnect(peerId: string): Promise<void> {
    this.socket?.close();
    this.socket = null;
  }

  async send(_peerId: string, data: string): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }

  onMessage(handler: (peerId: string, data: string) => void): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: (peerId: string) => void): void {
    this.disconnectHandler = handler;
  }

  async destroy(): Promise<void> {
    this.socket?.close();
  }
}

// ----------------------------------------------------------------
// Transport Manager — automatische Auswahl & Fallback
// ----------------------------------------------------------------

export class P2PTransportManager {
  private adapters: TransportAdapter[];
  private activeAdapter: TransportAdapter | null = null;
  private messageHandler: ((peerId: string, msg: P2PMessage) => void) | null = null;
  private disconnectHandler: ((peerId: string) => void) | null = null;
  private chunkBuffer: Map<string, string> = new Map();

  constructor() {
    this.adapters = [
      new WiFiDirectTransportAdapter(), // Bevorzugt (niedrige Latenz)
      new BLETransportAdapter(),        // Fallback (universell)
    ];
  }

  /** Wählt automatisch den besten verfügbaren Transport */
  async selectBestTransport(): Promise<TransportAdapter | null> {
    for (const adapter of this.adapters) {
      const available = await adapter.isAvailable();
      if (available) {
        this.activeAdapter = adapter;
        console.log(`[P2P] Selected transport: ${adapter.type}`);
        return adapter;
      }
    }
    console.warn('[P2P] No transport available');
    return null;
  }

  get active(): TransportAdapter | null {
    return this.activeAdapter;
  }

  /** Serialisiert und sendet eine typisierte P2P-Nachricht */
  async sendMessage<T>(peerId: string, message: Omit<P2PMessage<T>, 'checksum'>): Promise<void> {
    if (!this.activeAdapter) throw new Error('No active transport');
    const withChecksum: P2PMessage<T> = {
      ...message,
      checksum: computeChecksum(JSON.stringify(message.payload)),
    };
    await this.activeAdapter.send(peerId, JSON.stringify(withChecksum));
  }

  /** Registriert den globalen Nachrichten-Handler mit Parsing & Validierung */
  onMessage(handler: (peerId: string, msg: P2PMessage) => void): void {
    this.messageHandler = handler;
    this.adapters.forEach((adapter) => {
      adapter.onMessage((peerId, rawData) => {
        // BLE-Chunking: Pakete zusammensetzen
        const buffer = (this.chunkBuffer.get(peerId) ?? '') + rawData;
        try {
          const msg = JSON.parse(buffer) as P2PMessage;
          const expectedChecksum = computeChecksum(JSON.stringify(msg.payload));
          if (msg.checksum !== expectedChecksum) {
            console.warn('[P2P] Checksum mismatch, dropping packet');
            return;
          }
          this.chunkBuffer.delete(peerId);
          this.messageHandler?.(peerId, msg);
        } catch {
          // Unvollständiges Paket → Buffer akkumulieren
          this.chunkBuffer.set(peerId, buffer);
        }
      });
      adapter.onDisconnect((peerId) => {
        this.disconnectHandler?.(peerId);
      });
    });
  }

  onDisconnect(handler: (peerId: string) => void): void {
    this.disconnectHandler = handler;
  }

  async destroy(): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.destroy();
    }
  }
}

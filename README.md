# TAC·NEXUS — Native App with Auto-Updates

## 📱 Download & Installation für Freunde

Du willst die App installieren? So geht's:

1. **Download:** Gehe auf deinem Handy auf den Link: `https://github.com/DEIN_GITHUB_NAME/tac-nexus-app/releases/latest`
2. **Installieren:** Lade die `app-debug.apk` herunter und öffne sie.
3. **Hinweis:** Da die App nicht aus dem Play Store kommt, musst du "Installation aus unbekannten Quellen zulassen" bestätigen.
4. **Fertig!** Ab jetzt erhältst du alle Updates automatisch beim Start der App.

---

## 🛠️ Für den Entwickler (Dich)

### 1. Einrichtung (Einmalig)
- `CAPGO_TOKEN` in GitHub Secrets hinterlegen.
- Das Repo auf GitHub hochladen.

### 2. Updates veröffentlichen
- **Live-Update (nur Code):** Einfach `git push origin main`. Alle Handys aktualisieren sich von selbst.
- **Neue APK (Release):** Wenn du eine neue Version zum Download anbieten willst, erstelle einen Tag:
  ```bash
  git tag v1.0.1
  git push origin v1.0.1
  ```
  GitHub baut dann automatisch eine neue APK und stellt sie unter dem "Releases"-Link für alle bereit.

---

## 🎮 Features
- **100% Offline P2P Multiplayer** (Bluetooth & Wi-Fi Direct)
- **Globales Offline Leaderboard** (Synchronisiert sich bei Begegnung)
- **Premium Dark Luxury UI** (120Hz optimiert)
- **Automatisches Update-System** (Kein erneuter Download nötig)

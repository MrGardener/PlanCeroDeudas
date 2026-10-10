# Phone app (Android / iPhone)

The phone app is the **same code** as the web app (`index.html`, `css/`, `js/`), wrapped with
[Capacitor](https://capacitorjs.com). Nothing is rewritten; every feature in the web app is in
the phone app. The app is **ZeroDebtPlan** (US edition, English with a Spanish switch).

```
mobile/
  build-www.js          builds mobile/www: the app with everything inside (no internet needed)
  capacitor.config.json app id com.zerodebtplan.app, name ZeroDebtPlan
  android/              Android Studio project (API 36, works on the Pixel 10 Pro)
  ios/                  Xcode project (iOS 15+, Swift Package Manager)
  assets/               icon and splash sources (regenerate with npx @capacitor/assets generate)
js/native.js            the bridge: share sheet for files, back button, native copy of the data
.github/workflows/mobile.yml   builds the Android APK and the iOS app in the cloud
```

## What changes inside the app

| | Web file | Phone app |
|---|---|---|
| Styles, charts, icons, font | from the internet (CDN) | inside the app: works offline |
| Sections | tabs at the top | tab bar at the bottom (thumb reach) |
| Backups / CSV reports | browser download | the phone's **Share** sheet (Drive, Files, email…) |
| Android back button | — | closes the open dialog → back to Overview → exits |
| Where the data lives | this browser | the app's storage, **plus a second copy** in native storage that is put back automatically if the system clears the web view |
| Cloud backup by Android | — | **off** (`allowBackup="false"`): the data never leaves the phone unless you share a backup |
| Print buttons, bookmark link | shown | hidden (they don't apply) |
| Reading a PDF/photo of a pay stub or receipt | downloads pdf.js / Tesseract (exact versions, checked by hash) | inside the app (English and Spanish): never needs internet |
| The saved plan without a PIN | readable in this browser's storage (a notice asks for a passcode) | **always encrypted** (AES-256-GCM) with a key the phone keeps in its secure hardware (Android Keystore / iOS Keychain, this device only) |
| Unlocking | type the PIN | the PIN, or **fingerprint / Face ID** (Settings → This device → This phone): the phone keeps the PIN and gives it back only after it confirms it's you |
| Reminders | — | a bill due tomorrow (9:00) and the weekly review (Sundays 18:00), scheduled on the phone: no server, and **no amounts or names** in the notification |
| Pay stub / receipt photo | the file picker | also **Take a photo** (the camera); the photo is read and not kept |
| Quick entry | a bookmark to `#rapido` or the N key | long-press the app icon → **Add expense** |
| Backup to the cloud | download the encrypted file | **Back up (encrypted)** opens the share sheet: Google Drive, iCloud Drive, Files… The file is encrypted before it leaves the app |

Two apps from the same code: **ZeroDebtPlan** (`com.zerodebtplan.app`, US) and **Plan Financiero**
(`com.planfinanciero.ecuador`, Ecuador, Spanish). Each run builds both APKs (`ZeroDebtPlan-android-N`,
`PlanFinanciero-android-N`); they can be on the same phone.

The app's own native code is small and lives in the repository: `DeviceKeyPlugin.java` (Android) and
the `DeviceKeyPlugin` class in `SceneDelegate.swift` (iOS). Besides Capacitor's official plugins
(app, filesystem, preferences, share, local notifications, camera) nothing else is added. What it
can't do: the fingerprint check is the phone's own (the PIN is released by the app after it), not
a key bound to the fingerprint; and none of it was tried on a real phone in CI — only built.

## Getting the test app onto the Pixel 10 Pro (no computer setup needed)

1. Every push to the branch runs **Actions → Phone app** on GitHub.
2. Open the finished run → **Artifacts** → download `ZeroDebtPlan-android-N` (a zip with the APK).
3. On the Pixel: open the APK (Files app) → allow "Install unknown apps" for Files/Chrome once → Install.
4. Newer builds install over the old one and **keep your data** (signed with the same key and
   numbered by the run). The APK is a release build: not debuggable, so `adb run-as` can't read
   the app's files.

### Your own signing key (do this once — it protects your data)

Until you set it, builds are signed with the test key in this public repository
(`mobile/android/app/debug.keystore`): anyone can sign an APK with it that Android would accept as
an update of the app — and an update gets the app's data. The run summary says which key was used.

1. On any computer with Java: `keytool -genkeypair -v -keystore zerodebtplan.jks -keyalg RSA -keysize 4096 -validity 10000 -alias zerodebtplan`
   (pick strong passwords; keep the `.jks` file and the passwords somewhere safe, offline — losing
   them means you can't update the app, only reinstall it).
2. `base64 -w0 zerodebtplan.jks` (macOS: `base64 -i zerodebtplan.jks`) and copy the text.
3. GitHub → the repository → Settings → Secrets and variables → Actions → New repository secret:
   `ANDROID_KEYSTORE_B64` (that text), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
   (`zerodebtplan`), `ANDROID_KEY_PASSWORD`.
4. The next build is signed with your key. **Once**, because the key changes: make an encrypted
   backup in the app (Settings → Your data), uninstall the old app, install the new one, load the
   backup. From then on updates install over each other again.

Building on your own computer instead: install Android Studio, then
`cd mobile && npm ci && npm run sync && npx cap open android` → Run on the phone with USB debugging.

## iPhone without a Mac

Yes. Apple's tools only run on macOS, but they don't have to be **your** Mac:

- **GitHub Actions macOS runners** (already set up here): the `ios` job builds the app on a
  Mac in the cloud on every push. Today it builds for the simulator, which proves the code
  compiles; it doesn't make an installable file.
- To **install on an iPhone** (TestFlight) you need, in any case:
  1. an **Apple Developer Program** membership (US$99/year);
  2. an iPhone to test on;
  3. signing set up once, from any browser: an App Store Connect API key, and a distribution
     certificate + provisioning profile (Apple's website can create them; or fastlane `match`
     creates them from the CI runner). They're stored as GitHub Secrets, never in the code.
  Then a signed job uploads each build to TestFlight and the TestFlight app installs it on the phone.
- Alternative: Codemagic or Bitrise (hosted Macs with an iOS signing wizard).

## Publishing (later)

| Store | You need | Notes |
|---|---|---|
| Google Play | Google Play Console account (US$25 once); **your own upload key** (keep it safe; Google Play App Signing holds the final key) | 🔍 New personal accounts must run a closed test (currently 12 testers for 14 days) before production. Needs a privacy policy URL and the Data safety form ("no data collected"). Signed `.aab` job: add the key as GitHub Secrets |
| App Store | Apple Developer Program (US$99/year) | TestFlight first; App Review; privacy "nutrition label" (no data collected) |

Keys and passwords are yours: they go in GitHub Secrets or your password manager, never in the repository.

## Why the APK isn't built in the Claude Code container

The container's network policy blocks `dl.google.com` (Google's Maven repository and Android
SDK), which every Android build needs. The GitHub Actions build doesn't have that limit. To
build inside the container too, add `dl.google.com` to the environment's allowed domains.

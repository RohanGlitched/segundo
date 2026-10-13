# Segundo for Android

The Android app is a Trusted Web Activity: a small package (about 0.6 MB) that opens https://segundo.world/app full
screen in the phone's own Chrome, with Segundo's icon, splash screen and bar colours. Everything else (passkeys,
tabs, pay) is the web app, so the Android app is always the live version. If no browser on the phone supports
Trusted Web Activities, it falls back to a Custom Tab.

- Package: `world.segundo.app`, min SDK 24, target SDK 36.
- Library: `com.google.androidbrowserhelper:androidbrowserhelper` (no app code; everything is in
  `app/src/main/AndroidManifest.xml` and `res/`).
- Full screen without the URL bar needs `web/public/.well-known/assetlinks.json` to list this package and the SHA-256
  fingerprint of the release certificate. Change the keystore and you must update that file.
- Long-press the icon for the same shortcuts as the web manifest: your tabs, open a tab, send AUSD.

## Build

From Git Bash, in this folder (uses the Android SDK in `%LOCALAPPDATA%\Android\Sdk`, the JDK on `JAVA_HOME`, and
Gradle 8.14.3 with its caches on `I:\dev-cache`, see `gw.sh`):

```bash
source ../keys/segundo-keystore.env
bash gw.sh :app:assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../web/public/segundo.apk
```

The site serves the APK at https://segundo.world/segundo.apk.

## Signing

The release keystore is `till/keys/segundo-release.jks` (alias `segundo`), and its password is in
`till/keys/segundo-keystore.env` as `SEGUNDO_KEYSTORE_PASSWORD`. `till/keys/` is gitignored: keep both files out of
the repository and back them up, because an update to an installed app must be signed with the same key.

Print the fingerprint for `assetlinks.json`:

```bash
source ../keys/segundo-keystore.env
keytool -list -v -keystore ../keys/segundo-release.jks -alias segundo -storepass "$SEGUNDO_KEYSTORE_PASSWORD" | grep SHA256
```

## Icons

`res/mipmap-*` and `res/drawable-*/splash.png` are made from `web/public/icons/icon-512.png`: an adaptive icon (the
dial on the paper colour `#EDF1EC`, plus a monochrome layer for themed icons on Android 13 and later) and a round
icon for older launchers.

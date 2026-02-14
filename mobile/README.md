# QuickMeet - Android App (Capacitor)

## 📋 প্রয়োজনীয়তা

- **Node.js** 18+
- **npm** বা **yarn**
- **Android Studio** (latest version)
- **Java JDK** 17+
- **Android SDK** (API Level 33+)

## 🚀 দ্রুত শুরু

### ১. ডিপেন্ডেন্সি ইন্সটল

```bash
cd mobile
npm install
```

### ২. Android প্রজেক্ট তৈরি করুন

```bash
# Capacitor Android platform যোগ করুন
npx cap add android
```

### ৩. Web ফাইলস sync করুন

```bash
npx cap sync android
```

### ৪. Android Studio তে খুলুন

```bash
npx cap open android
```

### ৫. Android Studio থেকে

1. Android Studio খুলবে `android/` ফোল্ডার নিয়ে
2. Gradle sync হওয়া পর্যন্ত অপেক্ষা করুন
3. একটি device/emulator সিলেক্ট করুন
4. "Run" (▶) বাটনে ক্লিক করুন

## 📱 APK তৈরি করুন

### Debug APK

```bash
npm run android:build
npx cap open android
```

Android Studio তে: **Build → Build Bundle(s) / APK(s) → Build APK(s)**

APK পাবেন: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK (Signed)

1. Android Studio তে: **Build → Generate Signed Bundle / APK**
2. **APK** সিলেক্ট করুন
3. Keystore তৈরি করুন (প্রথমবার)
4. Release build type সিলেক্ট করুন
5. **Finish** ক্লিক করুন

## ⚠️ গুরুত্বপূর্ণ: Android Permissions

Capacitor `add android` করার পর `android/app/src/main/AndroidManifest.xml` ফাইলে এই permissions যোগ করুন:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    
    <!-- Internet -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    
    <!-- Camera & Microphone (WebRTC) -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    
    <!-- Keep screen on during meeting -->
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    
    <!-- Bluetooth headset support -->
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    
    <!-- Feature declarations -->
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <application
        ...
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true">
        
        <activity
            ...>
            <!-- Keep screen on during meetings -->
            android:keepScreenOn="true"
        </activity>
    </application>
</manifest>
```

## ⚠️ গুরুত্বপূর্ণ: WebView Settings

`android/app/src/main/java/.../MainActivity.java` ফাইলে WebRTC সাপোর্ট যোগ করতে হবে:

```java
package com.quickmeet.app;

import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    // WebRTC permissions auto-grant
    @Override
    public void onBridgeReady() {
        super.onBridgeReady();
        
        WebView webView = getBridge().getWebView();
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });
    }
}
```

## 📁 ফাইল স্ট্রাকচার

```
mobile/
├── capacitor.config.json  # Capacitor কনফিগ
├── package.json           # Dependencies
├── www/                   # Web content (fallback)
│   └── index.html
├── scripts/
│   └── build-web.js       # Client → www copy script
├── resources/
│   └── README.md          # Icon instructions
└── android/               # (npx cap add android এর পর তৈরি হবে)
    └── app/
        └── src/
            └── main/
                ├── AndroidManifest.xml
                └── java/.../MainActivity.java
```

## ⚙️ কনফিগারেশন পরিবর্তন

### Server URL বদলাতে

`capacitor.config.json` ফাইলে:

```json
{
  "server": {
    "url": "https://quickmeet.genuinesoftmart.store"
  }
}
```

### App Icon বদলাতে

Android Studio > **app → right-click → New → Image Asset** → আপনার লোগো সিলেক্ট করুন

## ❓ সমস্যা সমাধান

### ক্যামেরা কাজ করছে না
- AndroidManifest.xml এ CAMERA ও RECORD_AUDIO permission আছে কিনা চেক করুন
- MainActivity.java তে WebChromeClient onPermissionRequest সেটআপ আছে কিনা দেখুন
- Device এ app permission settings চেক করুন

### WebView তে লোড হচ্ছে না
- `android:usesCleartextTraffic="true"` আছে কিনা চেক করুন
- `capacitor.config.json` এ `allowNavigation` ঠিক আছে কিনা দেখুন

### Gradle Build ফেইল
```bash
cd android
./gradlew clean
cd ..
npx cap sync android
```

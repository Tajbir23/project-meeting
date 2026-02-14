# QuickMeet - Windows Desktop App (Electron)

## 📋 প্রয়োজনীয়তা

- **Node.js** 18+
- **npm** বা **yarn**
- **Windows 10/11** (64-bit)

## 🚀 দ্রুত শুরু

### ১. ডিপেন্ডেন্সি ইন্সটল

```bash
cd desktop
npm install
```
t
### ২. ডেভেলপমেন্ট মোডে চালান

```bash
npm start
```

এটি সরাসরি `https://quickmeet.genuinesoftmart.store` লোড করবে একটি native Windows window-এ।

### ৩. Windows .exe বিল্ড করুন

```bash
# Installer + Portable দুটোই
npm run build

# শুধু Portable (.exe)
npm run build:portable

# শুধু Installer (.exe setup)
npm run build:installer
```

বিল্ড হওয়া ফাইল পাবেন: `desktop/dist/` ফোল্ডারে।

## 📁 ফাইল স্ট্রাকচার

```
desktop/
├── main.js          # Electron main process
├── preload.js       # Security bridge (main ↔ renderer)
├── index.html       # Offline/error fallback page
├── package.json     # Dependencies & build config
└── assets/
    ├── icon.png     # App icon (PNG)
    ├── icon.ico     # Windows icon
    └── README.md    # Icon instructions
```

## ⚙️ কনফিগারেশন পরিবর্তন

### Server URL বদলাতে

[main.js](main.js) ফাইলে এই লাইন পরিবর্তন করুন:

```javascript
const SERVER_URL = 'https://quickmeet.genuinesoftmart.store';
```

### App Icon বদলাতে

1. আপনার লোগো PNG ফাইল থেকে `.ico` তৈরি করুন
2. `assets/icon.ico` এবং `assets/icon.png` রিপ্লেস করুন
3. আবার বিল্ড করুন

## 🔧 ফিচারসমূহ

- ✅ ক্যামেরা/মাইক অটো পারমিশন
- ✅ স্ক্রিন শেয়ার সাপোর্ট
- ✅ System tray integration
- ✅ ফুলস্ক্রিন মোড (F11)
- ✅ জুম কন্ট্রোল (Ctrl+/Ctrl-)
- ✅ অফলাইন fallback পেজ
- ✅ Auto-hide menu bar
- ✅ Hardware acceleration for video

## ❓ সমস্যা সমাধান

### "electron is not recognized" এরর
```bash
npx electron .
```

### বিল্ড এরর (Windows)
```bash
# Visual C++ Build Tools ইন্সটল করুন
npm install --global windows-build-tools
```

### ক্যামেরা কাজ করছে না
- Windows Settings > Privacy > Camera > Allow apps থেকে চেক করুন
- Antivirus ক্যামেরা ব্লক করছে কিনা দেখুন

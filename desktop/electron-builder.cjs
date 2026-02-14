/**
 * electron-builder config
 * JS ফরম্যাটে কারণ sign: () => {} JSON-এ সম্ভব না
 */
module.exports = {
    appId: "com.quickmeet.desktop",
    productName: "QuickMeet",
    directories: {
        output: "dist"
    },
    win: {
        target: [
            { target: "nsis", arch: ["x64"] },
            { target: "portable", arch: ["x64"] }
        ],
        icon: "assets/icon.png",
        // কোড সাইনিং সম্পূর্ণ বাদ — সার্টিফিকেট ছাড়াই বিল্ড
        sign: async () => {},
        signingHashAlgorithms: null,
        verifyUpdateCodeSignature: false
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        installerLanguages: ["en_US"],
        language: "1033",
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: "QuickMeet"
    },
    files: [
        "main.js",
        "preload.js",
        "renderer.js",
        "index.html",
        "assets/**/*"
    ],
    forceCodeSigning: false
};

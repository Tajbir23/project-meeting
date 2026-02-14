/**
 * QuickMeet Desktop - Electron Main Process
 * 
 * এটি Electron অ্যাপের মেইন প্রসেস।
 * ব্রাউজার উইন্ডো তৈরি করে এবং অ্যাপ লাইফসাইকেল ম্যানেজ করে।
 */

const { app, BrowserWindow, Menu, Tray, shell, ipcMain, dialog, Notification } = require('electron');
const path = require('path');

// ===== গ্লোবাল ভেরিয়েবলস =====
let mainWindow = null;
let tray = null;

// Server URL
const SERVER_URL = 'https://quickmeet.genuinesoftmart.store';

// ===== অ্যাপ কনফিগারেশন =====
const APP_CONFIG = {
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'QuickMeet - ভিডিও মিটিং',
};

// ===== মেইন উইন্ডো তৈরি =====
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: APP_CONFIG.width,
        height: APP_CONFIG.height,
        minWidth: APP_CONFIG.minWidth,
        minHeight: APP_CONFIG.minHeight,
        title: APP_CONFIG.title,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // WebRTC permissions
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        // Window appearance
        backgroundColor: '#0f0f23',
        show: false, // ready-to-show এ দেখাবো
        autoHideMenuBar: true,
    });

    // ===== মেনু বার =====
    const menuTemplate = [
        {
            label: 'QuickMeet',
            submenu: [
                { 
                    label: 'হোম পেজ', 
                    click: () => mainWindow.loadURL(SERVER_URL)
                },
                { type: 'separator' },
                {
                    label: 'রিলোড',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => mainWindow.reload()
                },
                {
                    label: 'ডেভ টুলস',
                    accelerator: 'F12',
                    click: () => mainWindow.webContents.toggleDevTools()
                },
                { type: 'separator' },
                { 
                    label: 'বের হন', 
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => app.quit() 
                }
            ]
        },
        {
            label: 'ভিউ',
            submenu: [
                {
                    label: 'জুম ইন',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => {
                        const zoom = mainWindow.webContents.getZoomFactor();
                        mainWindow.webContents.setZoomFactor(Math.min(zoom + 0.1, 2.0));
                    }
                },
                {
                    label: 'জুম আউট',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => {
                        const zoom = mainWindow.webContents.getZoomFactor();
                        mainWindow.webContents.setZoomFactor(Math.max(zoom - 0.1, 0.5));
                    }
                },
                {
                    label: 'রিসেট জুম',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => mainWindow.webContents.setZoomFactor(1.0)
                },
                { type: 'separator' },
                {
                    label: 'ফুলস্ক্রিন',
                    accelerator: 'F11',
                    click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen())
                }
            ]
        },
        {
            label: 'সাহায্য',
            submenu: [
                {
                    label: 'ওয়েবসাইটে যান',
                    click: () => shell.openExternal(SERVER_URL)
                },
                {
                    label: 'সম্পর্কে',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'QuickMeet',
                            message: 'QuickMeet - ভিডিও মিটিং অ্যাপ',
                            detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode.js: ${process.versions.node}`,
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    // ===== সার্ভার URL লোড করি =====
    mainWindow.loadURL(SERVER_URL);

    // ===== উইন্ডো ইভেন্টস =====
    
    // Window ready হলে দেখাই
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Window close হলে
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // External link নতুন ব্রাউজারে open করি
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // শুধু server URL এর link গুলো app এ open করি
        if (url.startsWith(SERVER_URL)) {
            return { action: 'allow' };
        }
        // বাকিগুলো ব্রাউজারে
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Navigation control - শুধু server URL এ navigate করতে দেবো
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(SERVER_URL) && !url.startsWith('about:')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    // ===== Media Permissions =====
    // ক্যামেরা ও মাইক্রোফোন পারমিশন অটো দেবো
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = [
            'media',           // ক্যামেরা/মাইক
            'mediaKeySystem',  // DRM
            'display-capture', // স্ক্রিন শেয়ার
            'notifications',   // নোটিফিকেশন
        ];

        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    // Screen share জন্য desktopCapturer permission
    mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
        return true;
    });

    // ===== Error Handling =====
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`Page load failed: ${errorCode} - ${errorDescription}`);
        // Error page দেখাই
        mainWindow.loadFile('index.html');
    });

    // Certificate error handling (self-signed cert support)
    mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
        // Production এ proper certificate থাকলে এটা remove করুন
        if (url.startsWith(SERVER_URL)) {
            event.preventDefault();
            callback(true);
        } else {
            callback(false);
        }
    });
}

// ===== System Tray =====
function createTray() {
    try {
        const iconPath = path.join(__dirname, 'assets', 'icon.png');
        tray = new Tray(iconPath);
        
        const contextMenu = Menu.buildFromTemplate([
            { 
                label: 'QuickMeet খুলুন', 
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            },
            { type: 'separator' },
            { 
                label: 'বের হন', 
                click: () => app.quit() 
            }
        ]);
        
        tray.setToolTip('QuickMeet - ভিডিও মিটিং');
        tray.setContextMenu(contextMenu);
        
        tray.on('double-click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
    } catch (error) {
        console.log('Tray icon not available:', error.message);
    }
}

// ===== IPC Handlers =====
ipcMain.handle('get-server-url', () => SERVER_URL);
ipcMain.handle('get-app-version', () => app.getVersion());

// ===== অ্যাপ ইভেন্টস =====

// অ্যাপ রেডি হলে
app.whenReady().then(() => {
    createMainWindow();
    createTray();

    // macOS: dock icon click এ window আবার দেখাই
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

// সব উইন্ডো বন্ধ হলে
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// অ্যাপ বন্ধ হওয়ার আগে
app.on('before-quit', () => {
    if (tray) {
        tray.destroy();
    }
});

// GPU acceleration
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
// Hardware acceleration for better video performance
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

/**
 * QuickMeet Desktop - Preload Script
 * 
 * এটি Electron এর preload script।
 * Main process এবং renderer process এর মধ্যে সেতু হিসেবে কাজ করে।
 */

const { contextBridge, ipcRenderer } = require('electron');

// Renderer process এ API expose করি
contextBridge.exposeInMainWorld('electronAPI', {
    // Server URL পাওয়ার জন্য
    getServerUrl: () => ipcRenderer.invoke('get-server-url'),
    
    // App version পাওয়ার জন্য
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // Platform check
    platform: process.platform,
    
    // App কিনা চেক করার জন্য
    isElectronApp: true,
});

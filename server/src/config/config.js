/**
 * কনফিগারেশন ফাইল (Configuration File)
 * 
 * এখানে সার্ভারের সব সেটিংস রাখা হয়েছে।
 * .env ফাইল থেকে environment variables পড়া হয়।
 */

import dotenv from 'dotenv';
import os from 'os';

// .env ফাইল লোড করি
dotenv.config();

/**
 * mediasoup Worker কনফিগারেশন
 * 
 * Worker কী? 
 * - Worker হলো একটি আলাদা প্রসেস যা ভিডিও/অডিও প্রসেসিং করে
 * - প্রতিটি CPU core-এর জন্য একটি Worker তৈরি করলে পারফরম্যান্স ভালো হয়
 */
const mediasoupWorkerConfig = {
    // লগ লেভেল (debug, warn, error, none)
    logLevel: 'warn',
    
    // RTC পোর্ট রেঞ্জ (এই পোর্টগুলোতে মিডিয়া ট্রাফিক আসবে)
    rtcMinPort: 10000,
    rtcMaxPort: 10100
};

/**
 * mediasoup Router কনফিগারেশন
 * 
 * Router কী?
 * - Router মিডিয়া স্ট্রিম রাউট করে এক ইউজার থেকে অন্য ইউজারে
 * - প্রতিটি মিটিং রুমের জন্য একটি Router থাকে
 */
const mediasoupRouterConfig = {
    // কোন কোন মিডিয়া কোডেক সাপোর্ট করব
    mediaCodecs: [
        {
            kind: 'audio',                    // অডিওর জন্য
            mimeType: 'audio/opus',           // Opus কোডেক (সবচেয়ে ভালো কোয়ালিটি)
            clockRate: 48000,                 // 48kHz স্যাম্পল রেট
            channels: 2                       // স্টেরিও সাউন্ড
        },
        {
            kind: 'video',                    // ভিডিওর জন্য
            mimeType: 'video/VP8',            // VP8 কোডেক (ব্যাপকভাবে সমর্থিত)
            clockRate: 90000,
            parameters: {
                'x-google-start-bitrate': 1000  // শুরুতে 1Mbps বিটরেট
            }
        },
        {
            kind: 'video',
            mimeType: 'video/VP9',            // VP9 কোডেক (আরও ভালো কম্প্রেশন)
            clockRate: 90000,
            parameters: {
                'profile-id': 2,
                'x-google-start-bitrate': 1000
            }
        },
        {
            kind: 'video',
            mimeType: 'video/H264',           // H264 কোডেক (সব ব্রাউজারে কাজ করে)
            clockRate: 90000,
            parameters: {
                'packetization-mode': 1,
                'profile-level-id': '4d0032',
                'level-asymmetry-allowed': 1,
                'x-google-start-bitrate': 1000
            }
        }
    ]
};

/**
 * WebRTC Transport কনফিগারেশন
 * 
 * Transport কী?
 * - Transport হলো মিডিয়া পাঠানোর "পাইপ" বা "রাস্তা"
 * - প্রতিটি ইউজারের দুইটি Transport থাকে: একটি পাঠাতে, একটি রিসিভ করতে
 */
const webRtcTransportConfig = {
    listenIps: [
        {
            ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
            announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || null
        }
    ],
    // প্রাথমিক বিটরেট (bps)
    initialAvailableOutgoingBitrate: 1000000,
    // TCP ফলব্যাক (UDP না কাজ করলে)
    enableTcp: true,
    // UDP প্রেফার করি (কম latency)
    enableUdp: true,
    // UDP প্রথমে ব্যবহার করি
    preferUdp: true
};

/**
 * সম্পূর্ণ কনফিগারেশন অবজেক্ট
 */
const config = {
    // সার্ভার পোর্ট
    port: parseInt(process.env.PORT) || 3000,
    
    // mediasoup সেটিংস
    mediasoup: {
        // কয়টি Worker তৈরি করব (CPU cores সংখ্যা অনুযায়ী)
        numWorkers: Object.keys(os.cpus()).length,
        worker: mediasoupWorkerConfig,
        router: mediasoupRouterConfig,
        webRtcTransport: webRtcTransportConfig
    },
    
    // ICE সার্ভার (STUN/TURN)
    // STUN = আপনার পাবলিক IP খুঁজে বের করে
    // TURN = ফায়ারওয়াল পার করতে সাহায্য করে
    iceServers: [
        { urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

export default config;

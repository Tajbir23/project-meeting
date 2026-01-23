/**
 * মিটিং রুম স্ক্রিপ্ট
 * 
 * এই ফাইল কী করে?
 * ================
 * 1. Socket.IO দিয়ে সার্ভারে কানেক্ট করে
 * 2. WebRTC দিয়ে অন্য ইউজারদের সাথে কানেক্ট করে
 * 3. ভিডিও গ্রিড ম্যানেজ করে
 * 4. কন্ট্রোল বার হ্যান্ডল করে
 * 5. চ্যাট ফিচার পরিচালনা করে
 */

import { WebRTCManager } from './webrtc.js';

// ===== গ্লোবাল ভেরিয়েবলস =====
let socket = null;              // Socket.IO কানেকশন
let webrtcManager = null;       // WebRTC ম্যানেজার
let localStream = null;         // আমার ক্যামেরা/মাইক স্ট্রিম
let screenStream = null;        // স্ক্রিন শেয়ার স্ট্রিম

// মিটিং তথ্য
let roomId = null;              // বর্তমান রুম আইডি
let userName = '';              // আমার নাম
let userId = null;              // আমার সকেট আইডি

// মিডিয়া স্টেট
let audioEnabled = true;
let videoEnabled = true;
let isScreenSharing = false;

// মিটিং টাইমার
let meetingStartTime = null;
let timerInterval = null;

// ICE সার্ভার (STUN/TURN)
let iceServers = [];

// Audio Analyzer (Speaking Detection)
// এটা দিয়ে বুঝতে পারি কে কথা বলছে
let audioContext = null;
let audioAnalyzers = new Map();  // Map<peerId, { analyzer, dataArray, animationId }>

// ===== DOM এলিমেন্টস =====
const elements = {
    // ভিডিও গ্রিড
    videoGrid: document.getElementById('videoGrid'),
    localVideo: document.getElementById('localVideo'),
    localVideoTile: document.getElementById('localVideoTile'),
    localPlaceholder: document.getElementById('localPlaceholder'),
    localAvatarText: document.getElementById('localAvatarText'),
    localUserName: document.getElementById('localUserName'),
    localMuteIndicator: document.getElementById('localMuteIndicator'),
    
    // স্ক্রিন শেয়ার
    screenShareContainer: document.getElementById('screenShareContainer'),
    screenShareVideo: document.getElementById('screenShareVideo'),
    screenShareUser: document.getElementById('screenShareUser'),
    
    // কন্ট্রোল বার
    toggleMic: document.getElementById('toggleMic'),
    toggleCamera: document.getElementById('toggleCamera'),
    toggleScreenShare: document.getElementById('toggleScreenShare'),
    leaveCall: document.getElementById('leaveCall'),
    moreOptions: document.getElementById('moreOptions'),
    moreOptionsMenu: document.getElementById('moreOptionsMenu'),
    
    // হেডার
    meetingCode: document.getElementById('meetingCode'),
    meetingTimer: document.getElementById('meetingTimer'),
    meetingTimerMobile: document.getElementById('meetingTimerMobile'),
    participantCount: document.getElementById('participantCount'),
    
    // সাইড প্যানেল
    sidePanel: document.getElementById('sidePanel'),
    toggleChatBtn: document.getElementById('toggleChatBtn'),
    toggleParticipantsBtn: document.getElementById('toggleParticipantsBtn'),
    closePanelBtn: document.getElementById('closePanelBtn'),
    participantsPanel: document.getElementById('participantsPanel'),
    chatPanel: document.getElementById('chatPanel'),
    participantsList: document.getElementById('participantsList'),
    participantCountPanel: document.getElementById('participantCountPanel'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    chatBadge: document.getElementById('chatBadge'),
    
    // অন্যান্য
    connectionOverlay: document.getElementById('connectionOverlay'),
    connectionStatus: document.getElementById('connectionStatus'),
    copyLinkBtn: document.getElementById('copyLinkBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    pipBtn: document.getElementById('pipBtn')
};

// ===== টোস্ট নোটিফিকেশন =====
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('.toast-icon');
    const msg = toast.querySelector('.toast-message');
    
    const icons = {
        success: 'check_circle',
        error: 'error',
        warning: 'warning',
        info: 'info'
    };
    
    icon.textContent = icons[type] || icons.info;
    msg.textContent = message;
    toast.className = `toast ${type}`;
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== কানেকশন ওভারলে =====
function showConnectionOverlay(message) {
    elements.connectionStatus.textContent = message;
    elements.connectionOverlay.style.display = 'flex';
}

function hideConnectionOverlay() {
    elements.connectionOverlay.style.display = 'none';
}

// ===== মিটিং টাইমার =====
function startMeetingTimer() {
    meetingStartTime = Date.now();
    
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - meetingStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        elements.meetingTimer.textContent = timeString;
        elements.meetingTimerMobile.textContent = timeString;
    }, 1000);
}

function stopMeetingTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
}

// ===== লোকাল মিডিয়া সেটআপ =====
async function setupLocalMedia() {
    try {
        showConnectionOverlay('ক্যামেরা চালু করা হচ্ছে...');
        
        // সেটিংস পড়ি (ল্যান্ডিং পেজ থেকে)
        audioEnabled = sessionStorage.getItem('audioEnabled') !== 'false';
        videoEnabled = sessionStorage.getItem('videoEnabled') !== 'false';
        
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                facingMode: 'user',
                frameRate: { ideal: 30, max: 30 }
            },
            audio: {
                // Echo cancellation - মোবাইলে audio loop এড়াতে
                echoCancellation: { exact: true },
                noiseSuppression: { exact: true },
                autoGainControl: { exact: true },
                // Additional settings for better audio
                sampleRate: 48000,
                channelCount: 1  // Mono audio echoes less
            }
        });
        
        // সেটিংস অ্যাপ্লাই করি
        localStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
        localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
        
        // ভিডিওতে দেখাই
        elements.localVideo.srcObject = localStream;
        
        // UI আপডেট করি
        updateLocalVideoTile();
        updateControlButtons();
        
        // Local audio analyzer সেটআপ করি (speaking detection)
        setupAudioAnalyzer(localStream, 'local');
        
        console.log('✅ লোকাল মিডিয়া রেডি');
        return true;
        
    } catch (error) {
        console.error('❌ মিডিয়া এরর:', error);
        showToast('ক্যামেরা/মাইক অ্যাক্সেস করতে সমস্যা হয়েছে', 'error');
        return false;
    }
}

// ===== লোকাল ভিডিও টাইল আপডেট =====
function updateLocalVideoTile() {
    // ক্যামেরা বন্ধ থাকলে প্লেসহোল্ডার দেখাই
    if (!videoEnabled) {
        elements.localVideoTile.classList.add('video-off');
    } else {
        elements.localVideoTile.classList.remove('video-off');
    }
    
    // মাইক বন্ধ থাকলে ইন্ডিকেটর দেখাই
    if (!audioEnabled) {
        elements.localVideoTile.classList.add('audio-off');
    } else {
        elements.localVideoTile.classList.remove('audio-off');
    }
    
    // নাম আপডেট
    elements.localUserName.textContent = userName || 'আপনি';
    
    // অ্যাভাটার (নামের প্রথম অক্ষর)
    elements.localAvatarText.textContent = userName ? userName.charAt(0).toUpperCase() : 'Me';
}

// ===== কন্ট্রোল বাটন আপডেট =====
function updateControlButtons() {
    // মাইক বাটন
    elements.toggleMic.classList.toggle('off', !audioEnabled);
    
    // ক্যামেরা বাটন
    elements.toggleCamera.classList.toggle('off', !videoEnabled);
    
    // স্ক্রিন শেয়ার বাটন
    elements.toggleScreenShare.classList.toggle('active', isScreenSharing);
}

// ===== Audio Analyzer Functions (Speaking Detection) =====
/**
 * অডিও স্ট্রিম থেকে speaking detection সেটআপ করে
 * 
 * এটা Web Audio API ব্যবহার করে audio level analyze করে।
 * যখন level threshold এর উপরে যায়, তখন "speaking" class যোগ করে।
 * 
 * @param {MediaStream} stream - অডিও স্ট্রিম
 * @param {string} peerId - ইউজার আইডি (local = 'local')
 */
function setupAudioAnalyzer(stream, peerId) {
    try {
        // Audio Context তৈরি করি (যদি না থাকে)
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // আগের analyzer থাকলে বন্ধ করি
        stopAudioAnalyzer(peerId);
        
        // Audio source তৈরি করি stream থেকে
        const source = audioContext.createMediaStreamSource(stream);
        
        // Analyzer তৈরি করি
        const analyzer = audioContext.createAnalyser();
        analyzer.fftSize = 256;
        analyzer.smoothingTimeConstant = 0.5;
        
        // Source কে analyzer এর সাথে কানেক্ট করি
        source.connect(analyzer);
        
        // Data array তৈরি করি
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        
        // Threshold (এর উপরে গেলে speaking বলে ধরবো)
        const SPEAKING_THRESHOLD = 15;
        
        // Animation loop for checking audio level
        function checkAudioLevel() {
            analyzer.getByteFrequencyData(dataArray);
            
            // Average audio level বের করি
            const sum = dataArray.reduce((a, b) => a + b, 0);
            const average = sum / dataArray.length;
            
            // Video tile element পাই
            const tileId = peerId === 'local' ? 'localVideoTile' : `video-tile-${peerId}`;
            const tile = document.getElementById(tileId);
            
            if (tile) {
                if (average > SPEAKING_THRESHOLD) {
                    tile.classList.add('speaking');
                } else {
                    tile.classList.remove('speaking');
                }
            }
            
            // পরের ফ্রেমে আবার চেক করি
            const animationId = requestAnimationFrame(checkAudioLevel);
            
            // Animation ID সেভ করি (পরে বন্ধ করার জন্য)
            const existingData = audioAnalyzers.get(peerId);
            if (existingData) {
                existingData.animationId = animationId;
            }
        }
        
        // শুরু করি
        const animationId = requestAnimationFrame(checkAudioLevel);
        
        // সেভ করি
        audioAnalyzers.set(peerId, { analyzer, dataArray, animationId, source });
        
        console.log(`🎤 Audio analyzer সেটআপ হয়েছে: ${peerId}`);
        
    } catch (error) {
        console.error(`❌ Audio analyzer সেটআপ এরর (${peerId}):`, error);
    }
}

/**
 * Audio analyzer বন্ধ করে
 * @param {string} peerId - ইউজার আইডি
 */
function stopAudioAnalyzer(peerId) {
    const data = audioAnalyzers.get(peerId);
    if (data) {
        if (data.animationId) {
            cancelAnimationFrame(data.animationId);
        }
        if (data.source) {
            data.source.disconnect();
        }
        audioAnalyzers.delete(peerId);
        
        // Speaking class সরাই
        const tileId = peerId === 'local' ? 'localVideoTile' : `video-tile-${peerId}`;
        const tile = document.getElementById(tileId);
        if (tile) {
            tile.classList.remove('speaking');
        }
        
        console.log(`🔇 Audio analyzer বন্ধ হয়েছে: ${peerId}`);
    }
}

// ===== ICE সার্ভার ফেচ =====
async function fetchIceServers() {
    try {
        const response = await fetch('/api/ice-servers');
        const data = await response.json();
        iceServers = data.iceServers || [];
        console.log('✅ ICE সার্ভার পাওয়া গেছে:', iceServers.length);
    } catch (error) {
        console.error('⚠️ ICE সার্ভার ফেচ করতে সমস্যা:', error);
        // ফলব্যাক
        iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
    }
}

// ===== Socket.IO কানেকশন =====
function connectSocket() {
    showConnectionOverlay('সার্ভারে কানেক্ট করা হচ্ছে...');
    
    // Socket.IO কানেক্ট করি
    socket = io({
        transports: ['websocket', 'polling']
    });
    
    // === কানেকশন ইভেন্টস ===
    
    socket.on('connect', () => {
        console.log('✅ সার্ভারে কানেক্ট হয়েছে:', socket.id);
        userId = socket.id;
        
        // রুমে জয়েন করি
        joinRoom();
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ কানেকশন এরর:', error);
        showConnectionOverlay('সার্ভারে কানেক্ট করতে সমস্যা হচ্ছে...');
    });
    
    socket.on('disconnect', (reason) => {
        console.log('⚠️ ডিসকানেক্ট:', reason);
        showConnectionOverlay('সংযোগ বিচ্ছিন্ন হয়েছে...');
    });
    
    // === সিগনালিং ইভেন্টস ===
    
    // নতুন ইউজার জয়েন করলে
    socket.on('user-joined', async (data) => {
        console.log(`👤 নতুন ইউজার: ${data.userName} (${data.userId})`);
        
        showToast(`${data.userName} জয়েন করেছে`, 'info');
        updateParticipantCount(data.userCount);
        
        // আমি আগে থেকে আছি, তাই আমি offer পাঠাবো নতুন ইউজারকে
        // "Polite Peer" pattern: আগে থাকা ইউজার = initiator
        await webrtcManager.connectToUser(data.userId);
        
        // পার্টিসিপ্যান্ট লিস্টে যোগ করি
        addParticipant(data.userId, data.userName);
    });
    
    // ইউজার চলে গেলে
    socket.on('user-left', (data) => {
        console.log(`👋 ইউজার চলে গেছে: ${data.userId}`);
        
        showToast('কেউ চলে গেছে', 'info');
        updateParticipantCount(data.userCount);
        
        // কানেকশন বন্ধ করি
        webrtcManager.closeConnection(data.userId);
        
        // ভিডিও টাইল মুছি
        removeVideoTile(data.userId);
        
        // পার্টিসিপ্যান্ট লিস্ট থেকে মুছি
        removeParticipant(data.userId);
    });
    
    // Offer পেলে
    socket.on('offer', async (data) => {
        console.log(`📥 Offer পাওয়া গেছে: ${data.senderId}`);
        await webrtcManager.handleOffer(data.senderId, data.offer);
    });
    
    // Answer পেলে
    socket.on('answer', async (data) => {
        console.log(`📥 Answer পাওয়া গেছে: ${data.senderId}`);
        await webrtcManager.handleAnswer(data.senderId, data.answer);
    });
    
    // ICE Candidate পেলে
    socket.on('ice-candidate', async (data) => {
        await webrtcManager.handleIceCandidate(data.senderId, data.candidate);
    });
    
    // মিডিয়া স্টেট পরিবর্তন
    socket.on('media-state-change', (data) => {
        console.log(`🎚️ মিডিয়া স্টেট: ${data.userId}`);
        updateRemoteVideoTile(data.userId, data.audioEnabled, data.videoEnabled);
    });
    
    // স্ক্রিন শেয়ার স্টেট
    socket.on('screen-share-state', (data) => {
        console.log(`🖥️ স্ক্রিন শেয়ার: ${data.userId} - ${data.isSharing}`);
        // TODO: স্ক্রিন শেয়ার হ্যান্ডলিং
    });
    
    // চ্যাট মেসেজ
    socket.on('chat-message', (data) => {
        addChatMessage(data);
    });
}

// ===== রুমে জয়েন =====
function joinRoom() {
    showConnectionOverlay('রুমে যোগ দেওয়া হচ্ছে...');
    
    socket.emit('join-room', {
        roomId: roomId,
        userName: userName
    }, async (response) => {
        if (response.success) {
            console.log('✅ রুমে জয়েন করেছি:', response);
            
            userId = response.userId;
            
            // মিটিং কোড দেখাই
            elements.meetingCode.textContent = roomId;
            
            // পার্টিসিপ্যান্ট কাউন্ট আপডেট
            updateParticipantCount(response.userCount);
            
            // WebRTC ম্যানেজার সেটআপ
            setupWebRTC();
            
            // আগে থেকে থাকা ইউজারদের জন্য শুধু participant list-এ যোগ করি
            // তারা আমাকে offer পাঠাবে (user-joined event থেকে)
            // আমি connectToUser কল করছি না - collision এড়াতে
            for (const user of response.existingUsers) {
                console.log(`👀 আগের ইউজার দেখছি: ${user.name} - তারা offer পাঠাবে`);
                addParticipant(user.id, user.name);
            }
            
            // নিজেকে পার্টিসিপ্যান্ট লিস্টে যোগ করি
            addParticipant(userId, userName, true);
            
            hideConnectionOverlay();
            startMeetingTimer();
            
            showToast('মিটিং-এ যোগ দিয়েছেন!', 'success');
            
        } else {
            console.error('❌ রুমে জয়েন করতে সমস্যা:', response.error);
            showToast('রুমে জয়েন করতে সমস্যা হয়েছে', 'error');
        }
    });
}

// ===== WebRTC সেটআপ =====
function setupWebRTC() {
    webrtcManager = new WebRTCManager(socket, localStream, iceServers);
    
    // রিমোট স্ট্রিম এলে
    webrtcManager.onRemoteStream = (userId, stream) => {
        console.log(`🎥 রিমোট স্ট্রিম পাওয়া গেছে: ${userId}`);
        addVideoTile(userId, stream);
    };
    
    // রিমোট স্ট্রিম গেলে
    webrtcManager.onRemoteStreamRemoved = (userId) => {
        console.log(`❌ রিমোট স্ট্রিম সরানো হয়েছে: ${userId}`);
        removeVideoTile(userId);
    };
    
    // কানেকশন স্টেট পরিবর্তন
    webrtcManager.onConnectionStateChange = (userId, state) => {
        console.log(`📡 কানেকশন স্টেট (${userId}): ${state}`);
        if (state === 'connected') {
            showToast('কানেক্টেড!', 'success');
        }
    };
    
    console.log('✅ WebRTC ম্যানেজার রেডি');
}

// ===== ভিডিও টাইল যোগ =====
function addVideoTile(peerId, stream) {
    console.log(`➕ ভিডিও টাইল যোগ করছি: ${peerId}, tracks: ${stream.getTracks().length}`);
    
    // আগে থেকে থাকলে শুধু stream আপডেট করি
    let tile = document.getElementById(`video-tile-${peerId}`);
    
    if (!tile) {
        // নতুন টাইল তৈরি করি
        tile = document.createElement('div');
        tile.id = `video-tile-${peerId}`;
        tile.className = 'video-tile';
        
        tile.innerHTML = `
            <video id="video-${peerId}" autoplay playsinline></video>
            <div class="video-placeholder">
                <div class="avatar">
                    <span>?</span>
                </div>
            </div>
            <div class="video-label">
                <span class="user-name">Guest</span>
                <span class="mute-indicator">
                    <span class="material-icons-round">mic_off</span>
                </span>
            </div>
            <div class="pin-btn" title="পিন করুন">
                <span class="material-icons-round">push_pin</span>
            </div>
        `;
        
        elements.videoGrid.appendChild(tile);
    }
    
    // ভিডিও এলিমেন্ট সেট করি
    const video = document.getElementById(`video-${peerId}`);
    if (video) {
        video.srcObject = stream;
        
        // ভিডিও প্লে হচ্ছে না এমন সমস্যা ফিক্স করি
        video.onloadedmetadata = () => {
            console.log(`📺 ভিডিও মেটাডাটা লোড হয়েছে: ${peerId}`);
            video.play().catch(err => {
                console.warn('Auto-play blocked:', err);
            });
        };
        
        // ডিবাগ: ট্র্যাক চেক
        stream.getTracks().forEach(track => {
            console.log(`   Track: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
        });
    }
    
    // Remote audio analyzer সেটআপ করি (speaking detection)
    setupAudioAnalyzer(stream, peerId);
    
    console.log(`✅ ভিডিও টাইল যোগ হয়েছে: ${peerId}`);
}

// ===== ভিডিও টাইল মুছি =====
function removeVideoTile(peerId) {
    const tile = document.getElementById(`video-tile-${peerId}`);
    if (tile) {
        tile.remove();
        
        // Audio analyzer বন্ধ করি
        stopAudioAnalyzer(peerId);
        
        console.log(`➖ ভিডিও টাইল মুছে ফেলা হয়েছে: ${peerId}`);
    }
}

// ===== রিমোট ভিডিও টাইল আপডেট =====
function updateRemoteVideoTile(peerId, audioOn, videoOn) {
    const tile = document.getElementById(`video-tile-${peerId}`);
    if (!tile) return;
    
    tile.classList.toggle('video-off', !videoOn);
    tile.classList.toggle('audio-off', !audioOn);
}

// ===== পার্টিসিপ্যান্ট কাউন্ট =====
function updateParticipantCount(count) {
    elements.participantCount.textContent = count;
    elements.participantCountPanel.textContent = count;
}

// ===== পার্টিসিপ্যান্ট যোগ =====
function addParticipant(id, name, isSelf = false) {
    const existing = document.getElementById(`participant-${id}`);
    if (existing) return;
    
    const item = document.createElement('div');
    item.id = `participant-${id}`;
    item.className = 'participant-item';
    
    const initial = name ? name.charAt(0).toUpperCase() : '?';
    
    item.innerHTML = `
        <div class="participant-avatar">${initial}</div>
        <div class="participant-info">
            <div class="participant-name">${name}${isSelf ? ' (আপনি)' : ''}</div>
            <div class="participant-status">${isSelf ? 'উপস্থাপক' : 'উপস্থিত'}</div>
        </div>
    `;
    
    elements.participantsList.appendChild(item);
}

// ===== পার্টিসিপ্যান্ট মুছি =====
function removeParticipant(id) {
    const item = document.getElementById(`participant-${id}`);
    if (item) item.remove();
}

// ===== মাইক টগল =====
elements.toggleMic.addEventListener('click', () => {
    // লোকাল স্ট্রিম না থাকলে কিছু করি না
    if (!localStream) {
        showToast('ক্যামেরা রেডি নয়', 'warning');
        return;
    }
    
    audioEnabled = !audioEnabled;
    
    // লোকাল স্ট্রিম আপডেট
    localStream.getAudioTracks().forEach(track => {
        track.enabled = audioEnabled;
    });
    
    // WebRTC আপডেট
    if (webrtcManager) {
        webrtcManager.setAudioEnabled(audioEnabled);
    }
    
    // সার্ভারে জানাই
    if (socket) {
        socket.emit('media-state-change', { audioEnabled, videoEnabled });
    }
    
    // UI আপডেট
    updateControlButtons();
    updateLocalVideoTile();
    
    showToast(audioEnabled ? 'মাইক চালু' : 'মাইক বন্ধ', 'info');
});

// ===== ক্যামেরা টগল =====
elements.toggleCamera.addEventListener('click', () => {
    // লোকাল স্ট্রিম না থাকলে কিছু করি না
    if (!localStream) {
        showToast('ক্যামেরা রেডি নয়', 'warning');
        return;
    }
    
    videoEnabled = !videoEnabled;
    
    // লোকাল স্ট্রিম আপডেট
    localStream.getVideoTracks().forEach(track => {
        track.enabled = videoEnabled;
    });
    
    // WebRTC আপডেট
    if (webrtcManager) {
        webrtcManager.setVideoEnabled(videoEnabled);
    }
    
    // সার্ভারে জানাই
    if (socket) {
        socket.emit('media-state-change', { audioEnabled, videoEnabled });
    }
    
    // UI আপডেট
    updateControlButtons();
    updateLocalVideoTile();
    
    showToast(videoEnabled ? 'ক্যামেরা চালু' : 'ক্যামেরা বন্ধ', 'info');
});

// ===== স্ক্রিন শেয়ার টগল =====
elements.toggleScreenShare.addEventListener('click', async () => {
    if (!isScreenSharing) {
        // স্ক্রিন শেয়ার শুরু
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { 
                    cursor: 'always',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false  // Audio usually causes issues
            });
            
            isScreenSharing = true;
            
            // স্ক্রিন ট্র্যাক পাই
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // পিয়ার কানেকশনে video track replace করি
            if (webrtcManager) {
                webrtcManager.replaceVideoTrack(screenTrack);
            }
            
            // লোকাল ভিডিওতেও দেখাই
            elements.localVideo.srcObject = screenStream;
            
            // ইউজার স্ক্রিন শেয়ার বন্ধ করলে (browser থেকে)
            screenTrack.onended = () => {
                stopScreenSharing();
            };
            
            // সার্ভারে জানাই
            socket.emit('screen-share-state', { isSharing: true });
            
            updateControlButtons();
            showToast('স্ক্রিন শেয়ার শুরু হয়েছে', 'success');
            
        } catch (error) {
            console.error('স্ক্রিন শেয়ার এরর:', error);
            if (error.name !== 'NotAllowedError') {
                showToast('স্ক্রিন শেয়ার করতে সমস্যা হয়েছে', 'error');
            }
        }
    } else {
        stopScreenSharing();
    }
});

function stopScreenSharing() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    isScreenSharing = false;
    
    // ক্যামেরা track ফিরিয়ে আনি
    if (localStream && webrtcManager) {
        const cameraTrack = localStream.getVideoTracks()[0];
        if (cameraTrack) {
            webrtcManager.replaceVideoTrack(cameraTrack);
        }
    }
    
    // লোকাল ভিডিওতে ক্যামেরা ফিরিয়ে দিই
    elements.localVideo.srcObject = localStream;
    
    socket.emit('screen-share-state', { isSharing: false });
    
    updateControlButtons();
    showToast('স্ক্রিন শেয়ার বন্ধ হয়েছে', 'info');
}

// ===== কল ছেড়ে দেওয়া =====
elements.leaveCall.addEventListener('click', () => {
    leaveCall();
});

function leaveCall() {
    console.log('👋 কল ছেড়ে দিচ্ছি...');
    
    // টাইমার বন্ধ
    stopMeetingTimer();
    
    // স্ট্রিম বন্ধ
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    
    // WebRTC বন্ধ
    if (webrtcManager) {
        webrtcManager.closeAllConnections();
    }
    
    // সকেট থেকে রুম ছাড়ি
    if (socket) {
        socket.emit('leave-room');
        socket.disconnect();
    }
    
    // হোম পেজে ফিরে যাই
    window.location.href = '/';
}

// ===== More Options মেনু =====
elements.moreOptions.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = elements.moreOptions.getBoundingClientRect();
    elements.moreOptionsMenu.style.bottom = `${window.innerHeight - rect.top + 10}px`;
    elements.moreOptionsMenu.style.left = `${rect.left}px`;
    elements.moreOptionsMenu.classList.toggle('open');
});

document.addEventListener('click', () => {
    elements.moreOptionsMenu.classList.remove('open');
});

// ===== লিংক কপি =====
elements.copyLinkBtn.addEventListener('click', () => {
    const meetingUrl = window.location.href;
    navigator.clipboard.writeText(meetingUrl).then(() => {
        showToast('মিটিং লিংক কপি হয়েছে!', 'success');
    });
    elements.moreOptionsMenu.classList.remove('open');
});

// ===== সাইড প্যানেল =====
elements.toggleChatBtn.addEventListener('click', () => {
    openSidePanel('chat');
});

elements.toggleParticipantsBtn.addEventListener('click', () => {
    openSidePanel('participants');
});

elements.closePanelBtn.addEventListener('click', () => {
    elements.sidePanel.classList.remove('open');
});

function openSidePanel(panel) {
    elements.sidePanel.classList.add('open');
    
    // প্যানেল ট্যাব আপডেট
    document.querySelectorAll('.panel-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.panel === panel);
    });
    
    // কন্টেন্ট দেখাই
    elements.participantsPanel.style.display = panel === 'participants' ? 'flex' : 'none';
    elements.chatPanel.style.display = panel === 'chat' ? 'flex' : 'none';
    
    // চ্যাট ব্যাজ ক্লিয়ার
    if (panel === 'chat') {
        elements.chatBadge.textContent = '';
    }
}

// প্যানেল ট্যাব ক্লিক
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        openSidePanel(tab.dataset.panel);
    });
});

// ===== চ্যাট =====
let unreadMessages = 0;

elements.sendChatBtn.addEventListener('click', sendChatMessage);
elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
    const message = elements.chatInput.value.trim();
    if (!message) return;
    
    socket.emit('chat-message', {
        userName: userName,
        message: message
    });
    
    elements.chatInput.value = '';
}

function addChatMessage(data) {
    const isOwn = data.userId === userId;
    
    // Welcome মেসেজ সরাই
    const welcome = elements.chatMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${isOwn ? 'own' : ''}`;
    
    const time = new Date(data.timestamp).toLocaleTimeString('bn-BD', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageEl.innerHTML = `
        <div class="chat-message-header">
            <span class="chat-sender">${isOwn ? 'আপনি' : data.userName}</span>
            <span class="chat-time">${time}</span>
        </div>
        <div class="chat-text">${escapeHtml(data.message)}</div>
    `;
    
    elements.chatMessages.appendChild(messageEl);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    
    // ব্যাজ আপডেট (যদি চ্যাট প্যানেল বন্ধ থাকে)
    if (!elements.chatPanel.style.display || elements.chatPanel.style.display === 'none') {
        unreadMessages++;
        elements.chatBadge.textContent = unreadMessages;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== ফুলস্ক্রিন =====
elements.fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        elements.fullscreenBtn.querySelector('.material-icons-round').textContent = 'fullscreen_exit';
    } else {
        document.exitFullscreen();
        elements.fullscreenBtn.querySelector('.material-icons-round').textContent = 'fullscreen';
    }
});

// ===== Picture in Picture =====
elements.pipBtn.addEventListener('click', async () => {
    try {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else {
            await elements.localVideo.requestPictureInPicture();
        }
    } catch (error) {
        console.error('PiP এরর:', error);
    }
});

// ===== কীবোর্ড শর্টকাট =====
document.addEventListener('keydown', (e) => {
    // Alt চাপা থাকলে ইগনোর
    if (e.altKey) return;
    
    switch (e.key.toLowerCase()) {
        case 'm':
            elements.toggleMic.click();
            break;
        case 'v':
            elements.toggleCamera.click();
            break;
        case 's':
            if (e.ctrlKey || e.metaKey) break; // Ctrl+S ইগনোর
            elements.toggleScreenShare.click();
            break;
    }
});

// ===== ব্রাউজার বন্ধ করার আগে =====
window.addEventListener('beforeunload', () => {
    leaveCall();
});

// ===== পেজ লোড হলে =====
async function init() {
    console.log('🚀 মিটিং পেজ লোড হচ্ছে...');
    
    // URL থেকে রুম আইডি পাই
    const pathParts = window.location.pathname.split('/');
    roomId = pathParts[pathParts.length - 1];
    
    if (!roomId) {
        showToast('মিটিং কোড পাওয়া যায়নি', 'error');
        setTimeout(() => window.location.href = '/', 2000);
        return;
    }
    
    // সেশন থেকে নাম পাই
    userName = sessionStorage.getItem('userName') || 'Guest';
    
    console.log(`📋 রুম: ${roomId}, নাম: ${userName}`);
    
    // ICE সার্ভার ফেচ করি
    await fetchIceServers();
    
    // লোকাল মিডিয়া সেটআপ করি
    const mediaReady = await setupLocalMedia();
    if (!mediaReady) {
        console.warn('⚠️ মিডিয়া ছাড়া চলছি');
    }
    
    // সার্ভারে কানেক্ট করি
    connectSocket();
}

// শুরু করি!
document.addEventListener('DOMContentLoaded', init);

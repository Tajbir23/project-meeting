/**
 * মেইন ল্যান্ডিং পেজ স্ক্রিপ্ট
 * 
 * এই ফাইল কী করে?
 * ================
 * 1. ক্যামেরা/মাইক্রোফোন প্রিভিউ দেখায়
 * 2. মিটিং কোড জেনারেট করে
 * 3. ফর্ম সাবমিট হ্যান্ডল করে
 * 4. মিটিং রুমে রিডাইরেক্ট করে
 */

// ===== গ্লোবাল ভেরিয়েবলস =====
let localStream = null;      // ক্যামেরা/মাইকের স্ট্রিম
let audioEnabled = true;     // মাইক চালু
let videoEnabled = true;     // ক্যামেরা চালু

// ===== DOM এলিমেন্টস =====
const joinForm = document.getElementById('joinForm');
const userNameInput = document.getElementById('userName');
const roomCodeInput = document.getElementById('roomCode');
const generateCodeBtn = document.getElementById('generateCodeBtn');
const localPreview = document.getElementById('localPreview');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const togglePreviewMic = document.getElementById('togglePreviewMic');
const togglePreviewCam = document.getElementById('togglePreviewCam');

// ===== টোস্ট নোটিফিকেশন =====
/**
 * টোস্ট মেসেজ দেখায়
 * 
 * @param {string} message - মেসেজ টেক্সট
 * @param {string} type - success, error, warning, info
 */
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('.toast-icon');
    const msg = toast.querySelector('.toast-message');
    
    // আইকন সেট করি
    const icons = {
        success: 'check_circle',
        error: 'error',
        warning: 'warning',
        info: 'info'
    };
    
    icon.textContent = icons[type] || icons.info;
    msg.textContent = message;
    
    // ক্লাস সেট করি
    toast.className = `toast ${type}`;
    
    // দেখাই
    setTimeout(() => toast.classList.add('show'), 10);
    
    // 3 সেকেন্ড পর লুকাই
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ===== মিটিং কোড জেনারেট =====
/**
 * র‍্যান্ডম মিটিং কোড তৈরি করে
 * Google Meet স্টাইল: xxx-yyyy-zzz
 * 
 * @returns {string} - মিটিং কোড
 */
function generateMeetingCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    
    function randomPart(length) {
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }
    
    // xxx-yyyy-zzz ফরম্যাট
    return `${randomPart(3)}-${randomPart(4)}-${randomPart(3)}`;
}

// জেনারেট বাটনে ক্লিক
generateCodeBtn.addEventListener('click', () => {
    roomCodeInput.value = generateMeetingCode();
    showToast('নতুন মিটিং কোড তৈরি হয়েছে!', 'success');
});

// ===== ক্যামেরা/মাইক্রোফোন সেটআপ =====
/**
 * ক্যামেরা এবং মাইক্রোফোন চালু করে
 * 
 * getUserMedia কী?
 * - এটা ব্রাউজারের API যা ক্যামেরা/মাইক অ্যাক্সেস করে
 * - ইউজারকে পারমিশন দিতে হয়
 */
async function setupLocalMedia() {
    try {
        // ক্যামেরা এবং মাইক্রোফোন চালু করি
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'  // সামনের ক্যামেরা
            },
            audio: {
                echoCancellation: true,    // ইকো ক্যান্সেল
                noiseSuppression: true,    // নয়েজ কমানো
                autoGainControl: true      // অটো ভলিউম
            }
        });
        
        // প্রিভিউতে দেখাই
        localPreview.srcObject = localStream;
        previewPlaceholder.style.display = 'none';
        
        console.log('✅ ক্যামেরা এবং মাইক্রোফোন চালু হয়েছে');
        
    } catch (error) {
        console.error('❌ মিডিয়া এরর:', error);
        
        // কোন এরর হয়েছে বুঝি
        let errorMessage = 'ক্যামেরা/মাইক্রোফোন অ্যাক্সেস করতে সমস্যা হয়েছে';
        
        if (error.name === 'NotAllowedError') {
            errorMessage = 'আপনি ক্যামেরা/মাইক্রোফোন অ্যাক্সেস দেননি';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'কোনো ক্যামেরা বা মাইক্রোফোন পাওয়া যায়নি';
        } else if (error.name === 'NotReadableError') {
            errorMessage = 'ক্যামেরা/মাইক্রোফোন অন্য অ্যাপে ব্যবহার হচ্ছে';
        }
        
        showToast(errorMessage, 'error');
        previewPlaceholder.querySelector('p').textContent = errorMessage;
    }
}

// ===== মাইক্রোফোন টগল =====
togglePreviewMic.addEventListener('click', () => {
    if (!localStream) return;
    
    audioEnabled = !audioEnabled;
    
    // অডিও ট্র্যাক খুঁজে বের করে টগল করি
    localStream.getAudioTracks().forEach(track => {
        track.enabled = audioEnabled;
    });
    
    // বাটন স্টাইল আপডেট
    togglePreviewMic.classList.toggle('active', audioEnabled);
    togglePreviewMic.querySelector('.material-icons-round').textContent = 
        audioEnabled ? 'mic' : 'mic_off';
    
    showToast(audioEnabled ? 'মাইক্রোফোন চালু' : 'মাইক্রোফোন বন্ধ', 'info');
});

// ===== ক্যামেরা টগল =====
togglePreviewCam.addEventListener('click', () => {
    if (!localStream) return;
    
    videoEnabled = !videoEnabled;
    
    // ভিডিও ট্র্যাক খুঁজে বের করে টগল করি
    localStream.getVideoTracks().forEach(track => {
        track.enabled = videoEnabled;
    });
    
    // বাটন স্টাইল আপডেট
    togglePreviewCam.classList.toggle('active', videoEnabled);
    togglePreviewCam.querySelector('.material-icons-round').textContent = 
        videoEnabled ? 'videocam' : 'videocam_off';
    
    // প্লেসহোল্ডার টগল
    previewPlaceholder.style.display = videoEnabled ? 'none' : 'flex';
    
    showToast(videoEnabled ? 'ক্যামেরা চালু' : 'ক্যামেরা বন্ধ', 'info');
});

// ===== ফর্ম সাবমিট =====
joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const userName = userNameInput.value.trim();
    let roomCode = roomCodeInput.value.trim();
    
    // ভ্যালিডেশন
    if (!userName) {
        showToast('আপনার নাম দিন', 'warning');
        userNameInput.focus();
        return;
    }
    
    // রুম কোড না থাকলে তৈরি করি
    if (!roomCode) {
        roomCode = generateMeetingCode();
    }
    
    // ডেটা সেভ করি (মিটিং পেজে ব্যবহার হবে)
    sessionStorage.setItem('userName', userName);
    sessionStorage.setItem('audioEnabled', audioEnabled);
    sessionStorage.setItem('videoEnabled', videoEnabled);
    
    // স্ট্রিম বন্ধ করি (মিটিং পেজে নতুন করে শুরু হবে)
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    console.log(`🚀 মিটিং-এ যাচ্ছি: ${roomCode}`);
    
    // মিটিং পেজে রিডাইরেক্ট
    window.location.href = `/meeting/${roomCode}`;
});

// ===== ফাইল ট্রান্সফার বাটন =====
const fileTransferBtn = document.getElementById('fileTransferBtn');
if (fileTransferBtn) {
    fileTransferBtn.addEventListener('click', () => {
        const userName = userNameInput.value.trim();
        if (!userName) {
            showToast('প্রথমে আপনার নাম দিন', 'warning');
            userNameInput.focus();
            return;
        }
        sessionStorage.setItem('userName', userName);

        // ইউনিক ট্রান্সফার কোড তৈরি
        const transferCode = generateMeetingCode();

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        window.location.href = `/transfer/${transferCode}`;
    });
}

// ===== পেজ লোড হলে =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 ল্যান্ডিং পেজ লোড হয়েছে');
    
    // ক্যামেরা/মাইক সেটআপ
    setupLocalMedia();
    
    // আগের নাম থাকলে দেখাই
    const savedName = sessionStorage.getItem('userName');
    if (savedName) {
        userNameInput.value = savedName;
    }
});

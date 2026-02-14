/**
 * স্ট্যান্ডঅ্যালোন ফাইল ট্রান্সফার পেজ
 * 
 * মিটিং ছাড়াই P2P ফাইল ট্রান্সফার
 * - একটি কোড দিয়ে দুজন কানেক্ট হবে
 * - WebRTC DataChannel দিয়ে সরাসরি ফাইল যাবে
 * - Offline হলে resume হবে
 */

import { FileTransferManager, formatFileSize, TransferStatus } from './fileTransfer.js';

// ===== গ্লোবাল ভেরিয়েবলস =====
let socket = null;
let peerConnections = new Map();   // Map<peerId, RTCPeerConnection>
let fileTransferManager = null;
let roomId = null;
let userName = '';
let userId = null;
let iceServers = [];

// ===== DOM =====
const el = {
    transferRoomCode: document.getElementById('transferRoomCode'),
    myNameDisplay: document.getElementById('myNameDisplay'),
    myStatus: document.getElementById('myStatus'),

    // File Select
    tfDropZone: document.getElementById('tfDropZone'),
    tfFileInput: document.getElementById('tfFileInput'),
    tfSelectedFiles: document.getElementById('tfSelectedFiles'),
    tfFilesList: document.getElementById('tfFilesList'),
    tfRecipientSelect: document.getElementById('tfRecipientSelect'),
    tfSendBtn: document.getElementById('tfSendBtn'),

    // Transfers
    tfTransfersList: document.getElementById('tfTransfersList'),
    tfEmptyState: document.getElementById('tfEmptyState'),

    // Peers
    tfPeersList: document.getElementById('tfPeersList'),
    tfPeerCount: document.getElementById('tfPeerCount'),

    // Share
    tfShareLink: document.getElementById('tfShareLink'),
    tfCopyLink: document.getElementById('tfCopyLink'),

    // Modal
    tfOfferModal: document.getElementById('tfOfferModal'),
    tfOfferTitle: document.getElementById('tfOfferTitle'),
    tfOfferDetails: document.getElementById('tfOfferDetails'),
    tfOfferAccept: document.getElementById('tfOfferAccept'),
    tfOfferReject: document.getElementById('tfOfferReject'),

    // Overlay
    connectionOverlay: document.getElementById('connectionOverlay'),
    connectionStatus: document.getElementById('connectionStatus'),
};

// ===== Toast =====
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('.toast-icon');
    const msg = toast.querySelector('.toast-message');
    const icons = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
    icon.textContent = icons[type] || icons.info;
    msg.textContent = message;
    toast.className = `toast ${type}`;
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function showOverlay(msg) {
    el.connectionStatus.textContent = msg;
    el.connectionOverlay.style.display = 'flex';
}
function hideOverlay() {
    el.connectionOverlay.style.display = 'none';
}

// ===== ICE Servers =====
async function fetchIceServers() {
    try {
        const res = await fetch('/api/ice-servers');
        const data = await res.json();
        iceServers = data.iceServers || [];
    } catch {
        iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
    }
}

// ===== WebRTC PeerConnection (ফাইল ট্রান্সফার only, no media) =====
function createPeerConnection(peerId, isInitiator = false) {
    console.log(`🤝 PeerConnection: ${peerId} (initiator: ${isInitiator})`);

    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { targetId: peerId, candidate: event.candidate });
        }
    };

    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log(`📡 ICE (${peerId}): ${state}`);
        updatePeerStatus(peerId, state);

        if (state === 'connected') {
            showToast('কানেক্টেড!', 'success');
        }
        if (state === 'failed') {
            pc.restartIce();
        }
    };

    // Remote DataChannel receive
    pc.ondatachannel = (event) => {
        console.log(`📡 Remote DataChannel: ${event.channel.label}`);
        if (event.channel.label === 'file-transfer' && fileTransferManager) {
            fileTransferManager.acceptDataChannel(peerId, event.channel);
        }
    };

    pc.onnegotiationneeded = async () => {
        if (isInitiator) {
            await createAndSendOffer(peerId);
        }
    };

    peerConnections.set(peerId, pc);
    return pc;
}

async function createAndSendOffer(peerId) {
    const pc = peerConnections.get(peerId);
    if (!pc || pc.signalingState !== 'stable') return;

    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { targetId: peerId, offer });
    } catch (err) {
        console.error('Offer এরর:', err);
    }
}

async function handleOffer(senderId, offer) {
    let pc = peerConnections.get(senderId);
    if (!pc) pc = createPeerConnection(senderId, false);

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { targetId: senderId, answer });
}

async function handleAnswer(senderId, answer) {
    const pc = peerConnections.get(senderId);
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleIceCandidate(senderId, candidate) {
    const pc = peerConnections.get(senderId);
    if (!pc) return;
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
}

function closePeerConnection(peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) { pc.close(); peerConnections.delete(peerId); }
}

// ===== Socket.IO =====
function connectSocket() {
    showOverlay('সার্ভারে কানেক্ট করা হচ্ছে...');
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
        userId = socket.id;
        console.log('✅ কানেক্টেড:', userId);
        joinTransferRoom();
    });

    socket.on('connect_error', () => {
        showOverlay('সার্ভারে কানেক্ট করতে সমস্যা...');
    });

    socket.on('disconnect', () => {
        showOverlay('সংযোগ বিচ্ছিন্ন...');
        el.myStatus.textContent = 'ডিসকানেক্টেড';
        el.myStatus.className = 'status-badge disconnected';
    });

    // === Transfer Room Events ===

    socket.on('transfer-user-joined', async (data) => {
        console.log(`👤 ${data.userName} জয়েন করেছে`);
        showToast(`${data.userName} কানেক্ট হয়েছে`, 'info');
        addPeerUI(data.userId, data.userName);
        updatePeerCount(data.userCount);

        // আমি আগে থাকায় আমি offer পাঠাবো
        const pc = createPeerConnection(data.userId, true);
        // DataChannel তৈরি করি
        if (fileTransferManager) {
            fileTransferManager.setupDataChannel(data.userId);
        }
        await createAndSendOffer(data.userId);
    });

    socket.on('transfer-user-left', (data) => {
        console.log(`👋 ${data.userId} চলে গেছে`);
        showToast('কেউ চলে গেছে', 'info');
        closePeerConnection(data.userId);
        removePeerUI(data.userId);
        updatePeerCount(data.userCount);
    });

    // Signaling
    socket.on('offer', async (data) => {
        await handleOffer(data.senderId, data.offer);
    });
    socket.on('answer', async (data) => {
        await handleAnswer(data.senderId, data.answer);
    });
    socket.on('ice-candidate', async (data) => {
        await handleIceCandidate(data.senderId, data.candidate);
    });
}

function joinTransferRoom() {
    showOverlay('রুমে যোগ দেওয়া হচ্ছে...');

    socket.emit('join-transfer-room', {
        roomId,
        userName,
    }, (response) => {
        if (response.success) {
            console.log('✅ Transfer room joined:', response);
            userId = response.userId;
            el.myStatus.textContent = 'কানেক্টেড';
            el.myStatus.className = 'status-badge connected';
            updatePeerCount(response.userCount);

            // আগের ইউজাররা — তারা আমাকে offer পাঠাবে
            for (const user of response.existingUsers) {
                addPeerUI(user.id, user.name);
            }

            // FileTransfer Manager
            setupFileTransfer();

            hideOverlay();
            showToast('কানেক্ট হয়েছে!', 'success');
        } else {
            showToast('রুমে জয়েন করতে সমস্যা', 'error');
        }
    });
}

// ===== File Transfer Manager =====
function setupFileTransfer() {
    fileTransferManager = new FileTransferManager(socket, peerConnections);

    // --- Callbacks ---
    fileTransferManager.onTransferOffer = (transfer) => {
        pendingOfferFileId = transfer.fileId;
        el.tfOfferTitle.textContent = 'ফাইল পাঠাতে চায়';
        el.tfOfferDetails.innerHTML = `<strong>${transfer.fileName}</strong><br>সাইজ: ${formatFileSize(transfer.fileSize)}`;
        el.tfOfferModal.style.display = 'flex';
        showToast('📁 নতুন ফাইল এসেছে!', 'info');
    };

    fileTransferManager.onTransferProgress = (data) => {
        updateTransferItem(data.fileId, data);
    };

    fileTransferManager.onTransferStatusChange = (data) => {
        updateTransferStatus(data.fileId, data);
    };

    fileTransferManager.onTransferComplete = (transfer) => {
        showToast(`✅ ${transfer.fileName} সম্পূর্ণ!`, 'success');
    };

    fileTransferManager.onTransferFailed = (transfer, reason) => {
        showToast(`❌ ${transfer.fileName}: ${reason}`, 'error');
    };
}

// ===== UI: Peers =====
function addPeerUI(id, name) {
    if (document.getElementById(`peer-${id}`)) return;

    const empty = el.tfPeersList.querySelector('.tf-empty-peers');
    if (empty) empty.style.display = 'none';

    const div = document.createElement('div');
    div.id = `peer-${id}`;
    div.className = 'tf-peer-item';
    div.innerHTML = `
        <div class="tf-peer-avatar">${(name || '?').charAt(0).toUpperCase()}</div>
        <div class="tf-peer-info">
            <div class="tf-peer-name">${name}</div>
            <div class="tf-peer-status" id="peer-status-${id}">কানেক্টিং...</div>
        </div>
    `;
    el.tfPeersList.appendChild(div);

    // Recipient dropdown আপডেট
    updateRecipientDropdown();
}

function removePeerUI(id) {
    const item = document.getElementById(`peer-${id}`);
    if (item) item.remove();

    if (el.tfPeersList.querySelectorAll('.tf-peer-item').length === 0) {
        const empty = el.tfPeersList.querySelector('.tf-empty-peers');
        if (empty) empty.style.display = 'block';
    }

    updateRecipientDropdown();
}

function updatePeerStatus(peerId, state) {
    const statusEl = document.getElementById(`peer-status-${peerId}`);
    if (!statusEl) return;

    const stateMap = {
        'new': 'কানেক্টিং...',
        'checking': 'কানেক্টিং...',
        'connected': '🟢 কানেক্টেড',
        'completed': '🟢 কানেক্টেড',
        'disconnected': '🟡 ডিসকানেক্টেড',
        'failed': '🔴 ব্যর্থ',
        'closed': '⚫ বন্ধ',
    };
    statusEl.textContent = stateMap[state] || state;
}

function updatePeerCount(count) {
    // নিজেকে বাদ দিই
    el.tfPeerCount.textContent = Math.max(0, count - 1);
}

function updateRecipientDropdown() {
    const select = el.tfRecipientSelect;
    const currentVal = select.value;
    select.innerHTML = '<option value="">— সিলেক্ট করুন —</option>';

    const peers = el.tfPeersList.querySelectorAll('.tf-peer-item');
    peers.forEach(p => {
        const id = p.id.replace('peer-', '');
        const name = p.querySelector('.tf-peer-name')?.textContent || 'Guest';
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        select.appendChild(opt);
    });

    // Re-select previous if still available
    if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
        select.value = currentVal;
    }

    el.tfSendBtn.disabled = peers.length === 0;
}

// ===== UI: File Select =====
let selectedFiles = [];

el.tfDropZone.addEventListener('click', () => el.tfFileInput.click());

el.tfFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectedFiles = Array.from(e.target.files);
        showSelectedFiles();
    }
});

el.tfDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.tfDropZone.classList.add('drag-active');
});
el.tfDropZone.addEventListener('dragleave', () => {
    el.tfDropZone.classList.remove('drag-active');
});
el.tfDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    el.tfDropZone.classList.remove('drag-active');
    if (e.dataTransfer.files.length > 0) {
        selectedFiles = Array.from(e.dataTransfer.files);
        showSelectedFiles();
    }
});

function showSelectedFiles() {
    el.tfFilesList.innerHTML = '';
    let totalSize = 0;

    for (const f of selectedFiles) {
        totalSize += f.size;
        const icon = getFileIcon(f.type);
        el.tfFilesList.innerHTML += `
            <div class="tf-file-item">
                <span class="material-icons-round">${icon}</span>
                <span class="tf-file-name">${f.name}</span>
                <span class="tf-file-size">${formatFileSize(f.size)}</span>
            </div>
        `;
    }

    if (selectedFiles.length > 1) {
        el.tfFilesList.innerHTML += `<div class="tf-file-total">মোট: ${selectedFiles.length} টি (${formatFileSize(totalSize)})</div>`;
    }

    el.tfSelectedFiles.style.display = 'block';
    el.tfDropZone.style.display = 'none';
}

function getFileIcon(mimeType) {
    if (!mimeType) return 'insert_drive_file';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'movie';
    if (mimeType.startsWith('audio/')) return 'audiotrack';
    if (mimeType.includes('pdf')) return 'picture_as_pdf';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return 'folder_zip';
    return 'insert_drive_file';
}

// ===== Send Button =====
el.tfSendBtn.addEventListener('click', () => {
    const recipientId = el.tfRecipientSelect.value;
    if (!recipientId) { showToast('প্রাপক সিলেক্ট করুন', 'warning'); return; }
    if (selectedFiles.length === 0) { showToast('ফাইল সিলেক্ট করুন', 'warning'); return; }
    if (!fileTransferManager) { showToast('এখনো কানেক্ট হয়নি', 'warning'); return; }

    // DataChannel ensure
    fileTransferManager.setupDataChannel(recipientId);

    for (const file of selectedFiles) {
        if (file.size > 2 * 1024 * 1024 * 1024) {
            showToast(`${file.name} 2GB এর বেশি!`, 'error');
            continue;
        }
        fileTransferManager.sendFile(recipientId, file);
    }

    // Reset
    selectedFiles = [];
    el.tfFileInput.value = '';
    el.tfSelectedFiles.style.display = 'none';
    el.tfDropZone.style.display = '';
    showToast('ফাইল পাঠানো শুরু হচ্ছে...', 'info');
});

// ===== File Offer Modal =====
let pendingOfferFileId = null;

el.tfOfferAccept.addEventListener('click', () => {
    if (pendingOfferFileId && fileTransferManager) {
        fileTransferManager.acceptFile(pendingOfferFileId);
        el.tfOfferModal.style.display = 'none';
        showToast('ফাইল গ্রহণ করা হয়েছে', 'success');
        pendingOfferFileId = null;
    }
});

el.tfOfferReject.addEventListener('click', () => {
    if (pendingOfferFileId && fileTransferManager) {
        fileTransferManager.rejectFile(pendingOfferFileId);
        el.tfOfferModal.style.display = 'none';
        pendingOfferFileId = null;
    }
});

// ===== Transfer UI =====
function updateTransferItem(fileId, data) {
    let item = document.getElementById(`tf-item-${fileId}`);

    if (!item) {
        el.tfEmptyState.style.display = 'none';
        item = document.createElement('div');
        item.id = `tf-item-${fileId}`;
        item.className = 'tf-transfer-item';
        item.innerHTML = `
            <div class="tf-t-header">
                <span class="material-icons-round tf-t-icon">${data.direction === 'send' ? 'upload' : 'download'}</span>
                <div class="tf-t-info">
                    <div class="tf-t-name">${data.fileName}</div>
                    <div class="tf-t-meta">${formatFileSize(data.fileSize)} • ${data.direction === 'send' ? 'পাঠাচ্ছে' : 'পাচ্ছে'}</div>
                </div>
                <button class="tf-t-cancel" data-file-id="${fileId}" title="বাতিল">
                    <span class="material-icons-round">close</span>
                </button>
            </div>
            <div class="ft-progress-bar"><div class="ft-progress-fill" style="width:0%"></div></div>
            <div class="ft-stats"><span class="ft-percent">0%</span><span class="ft-speed"></span></div>
        `;
        el.tfTransfersList.appendChild(item);

        item.querySelector('.tf-t-cancel').addEventListener('click', () => {
            if (fileTransferManager) fileTransferManager.cancelTransfer(fileId);
        });
    }

    item.querySelector('.ft-progress-fill').style.width = data.percent + '%';
    item.querySelector('.ft-percent').textContent = data.percent + '%';
    if (data.speed > 0) {
        item.querySelector('.ft-speed').textContent = formatFileSize(data.speed) + '/s';
    }
}

function updateTransferStatus(fileId, data) {
    let item = document.getElementById(`tf-item-${fileId}`);

    if (!item && data.status !== TransferStatus.CANCELLED) {
        updateTransferItem(fileId, { ...data, percent: 0, speed: 0 });
        item = document.getElementById(`tf-item-${fileId}`);
    }
    if (!item) return;

    const meta = item.querySelector('.tf-t-meta');
    const fill = item.querySelector('.ft-progress-fill');

    switch (data.status) {
        case TransferStatus.OFFERING:
            meta.textContent = `${formatFileSize(data.fileSize)} • অপেক্ষায়...`;
            break;
        case TransferStatus.TRANSFERRING:
            meta.textContent = `${formatFileSize(data.fileSize)} • ${data.direction === 'send' ? 'পাঠাচ্ছে' : 'পাচ্ছে'}`;
            fill.classList.remove('paused');
            break;
        case TransferStatus.PAUSED:
            meta.textContent = `${formatFileSize(data.fileSize)} • বিরতি (রিকানেক্ট হলে resume হবে)`;
            fill.classList.add('paused');
            break;
        case TransferStatus.COMPLETED:
            meta.textContent = `${formatFileSize(data.fileSize)} • ✅ সম্পূর্ণ!`;
            fill.style.width = '100%';
            fill.classList.add('completed');
            item.querySelector('.tf-t-cancel').style.display = 'none';
            break;
        case TransferStatus.FAILED:
            meta.textContent = `${formatFileSize(data.fileSize)} • ❌ ব্যর্থ`;
            fill.classList.add('failed');
            break;
        case TransferStatus.CANCELLED:
            if (item) item.remove();
            break;
    }
}

// ===== Copy Link =====
el.tfCopyLink.addEventListener('click', () => {
    el.tfShareLink.select();
    navigator.clipboard.writeText(el.tfShareLink.value).then(() => {
        showToast('লিংক কপি হয়েছে!', 'success');
    });
});

// ===== Init =====
function generateTransferCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

async function init() {
    console.log('📁 ফাইল ট্রান্সফার পেজ লোড হচ্ছে...');

    // URL থেকে room code পাই
    const pathParts = window.location.pathname.split('/');
    roomId = pathParts[pathParts.length - 1];

    if (!roomId) {
        // কোড না থাকলে নতুন তৈরি করে redirect
        roomId = generateTransferCode();
        window.history.replaceState(null, '', `/transfer/${roomId}`);
    }

    // নাম পাই
    userName = sessionStorage.getItem('userName') || prompt('আপনার নাম দিন:', 'Guest') || 'Guest';
    sessionStorage.setItem('userName', userName);

    el.transferRoomCode.textContent = roomId;
    el.myNameDisplay.textContent = userName;
    el.tfShareLink.value = window.location.href;

    await fetchIceServers();
    connectSocket();
}

document.addEventListener('DOMContentLoaded', init);

// Cleanup
window.addEventListener('beforeunload', () => {
    if (fileTransferManager) fileTransferManager.destroy();
    peerConnections.forEach(pc => pc.close());
    if (socket) { socket.emit('leave-transfer-room'); socket.disconnect(); }
});

/**
 * FileTransferManager - P2P ফাইল ট্রান্সফার (WebRTC DataChannel)
 * 
 * কীভাবে কাজ করে?
 * ================
 * 1. Sender ফাইলকে ছোট ছোট chunk-এ ভাগ করে (Torrent স্টাইল)
 * 2. WebRTC DataChannel দিয়ে সরাসরি (P2P) chunk পাঠায়
 * 3. Receiver চাঙ্ক IndexedDB তে সেভ করে (মেমরি বাঁচে)
 * 4. সব chunk পেয়ে গেলে Blob তৈরি করে ডাউনলোড দেয়
 * 5. কানেকশন বিচ্ছিন্ন হলে যেখানে ছিল সেখান থেকে resume করে
 * 
 * Resume কীভাবে কাজ করে?
 * =======================
 * - Receiver জানে কোন chunk গুলো পেয়েছে (IndexedDB তে আছে)
 * - রিকানেক্ট হলে receiver "missing chunks" এর লিস্ট পাঠায়
 * - Sender শুধু missing chunk গুলো আবার পাঠায়
 * 
 * মেমরি ম্যানেজমেন্ট:
 * ===================
 * - Sender: File.slice() দিয়ে chunk পড়ে → পাঠায় → GC করে
 * - Receiver: chunk পায় → সরাসরি IndexedDB তে → মেমরি ফ্রি
 * - মোবাইলে crash এড়াতে backpressure/flow control আছে
 */

import { ChunkStore } from './chunkStore.js';

// ===== Constants =====
const CHUNK_SIZE = 64 * 1024;           // 64KB per chunk (মোবাইল-ফ্রেন্ডলি)
const MAX_BUFFERED_AMOUNT = 512 * 1024; // 512KB buffer limit
const DATACHANNEL_LABEL = 'file-transfer';

/**
 * ট্রান্সফার স্ট্যাটাস
 */
export const TransferStatus = {
    WAITING: 'waiting',         // অপেক্ষায়
    OFFERING: 'offering',       // ফাইল অফার পাঠানো হয়েছে
    ACCEPTED: 'accepted',       // গ্রহীতা গ্রহণ করেছে
    TRANSFERRING: 'transferring', // ট্রান্সফার চলছে
    PAUSED: 'paused',           // বিরতিতে
    COMPLETED: 'completed',     // সম্পূর্ণ
    FAILED: 'failed',           // ব্যর্থ
    CANCELLED: 'cancelled',     // বাতিল
};

/**
 * ইউনিক ফাইল আইডি জেনারেট করে
 */
function generateFileId() {
    return `f-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * ফাইল সাইজ ফরম্যাট করে (human-readable)
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * FileTransferManager Class
 */
export class FileTransferManager {
    /**
     * @param {Object} socket - Socket.IO instance (signaling)
     * @param {Map} peerConnections - WebRTC peer connections from WebRTCManager
     */
    constructor(socket, peerConnections) {
        this.socket = socket;
        this.peerConnections = peerConnections;

        // IndexedDB chunk store
        this.chunkStore = new ChunkStore();

        // DataChannels - Map<peerId, RTCDataChannel>
        this.dataChannels = new Map();

        // Active transfers - Map<fileId, TransferInfo>
        this.transfers = new Map();

        // File references (sender only) - Map<fileId, File>
        this.fileRefs = new Map();

        // Callbacks
        this.onTransferOffer = null;        // ফাইল অফার পেলে
        this.onTransferProgress = null;     // প্রগ্রেস আপডেট
        this.onTransferComplete = null;     // ট্রান্সফার সম্পূর্ণ
        this.onTransferFailed = null;       // ব্যর্থ
        this.onTransferStatusChange = null; // status change

        // Init
        this._initSignaling();
        this.chunkStore.open().catch(err => console.error('ChunkStore init error:', err));

        console.log('📁 FileTransferManager তৈরি হয়েছে');
    }

    // ========================================
    // ===== SIGNALING (Socket.IO) ===========
    // ========================================

    /**
     * Socket.IO ইভেন্ট লিসনার সেটআপ
     * ফাইল offer/accept/resume সিগনালিং সার্ভারের মাধ্যমে হয়
     */
    _initSignaling() {
        // ফাইল অফার পেলে
        this.socket.on('file-offer', (data) => {
            console.log(`📨 ফাইল অফার পাওয়া গেছে: ${data.fileName}`);
            this._handleFileOffer(data);
        });

        // ফাইল গ্রহণ/বাতিল
        this.socket.on('file-response', (data) => {
            console.log(`📬 ফাইল রেসপন্স: ${data.fileId} - ${data.accepted ? 'গ্রহণ' : 'বাতিল'}`);
            this._handleFileResponse(data);
        });

        // Resume রিকোয়েস্ট (receiver কোন chunk গুলো পেয়েছে জানায়)
        this.socket.on('file-resume', (data) => {
            console.log(`🔄 Resume রিকোয়েস্ট: ${data.fileId}`);
            this._handleResumeRequest(data);
        });

        // ট্রান্সফার বাতিল
        this.socket.on('file-cancel', (data) => {
            console.log(`❌ ট্রান্সফার বাতিল: ${data.fileId}`);
            this._handleCancel(data);
        });
    }

    // ========================================
    // ===== DATA CHANNEL SETUP ==============
    // ========================================

    /**
     * একটি peer এর জন্য DataChannel তৈরি/সেটআপ করে
     * 
     * DataChannel কী?
     * - WebRTC তে video/audio ছাড়াও arbitrary data পাঠানো যায়
     * - এটাই DataChannel - সরাসরি P2P data pipe
     * - TCP/UDP দুটোই সাপোর্ট করে
     */
    setupDataChannel(peerId) {
        const pc = this.peerConnections.get(peerId);
        if (!pc) {
            console.warn(`⚠️ PeerConnection নেই: ${peerId}`);
            return null;
        }

        // আগের channel থাকলে skip
        if (this.dataChannels.has(peerId)) {
            const existing = this.dataChannels.get(peerId);
            if (existing.readyState === 'open') return existing;
        }

        // নতুন DataChannel তৈরি করি
        const dc = pc.createDataChannel(DATACHANNEL_LABEL, {
            ordered: true,      // ক্রমানুসারে পাঠাবে (chunk order maintain)
            maxRetransmits: 30   // হারিয়ে গেলে 30 বার retry
        });

        dc.binaryType = 'arraybuffer';

        this._attachDataChannelHandlers(dc, peerId);
        this.dataChannels.set(peerId, dc);

        console.log(`📡 DataChannel তৈরি: ${peerId}`);
        return dc;
    }

    /**
     * Remote peer এর DataChannel accept করে (ondatachannel event থেকে)
     */
    acceptDataChannel(peerId, dataChannel) {
        dataChannel.binaryType = 'arraybuffer';
        this._attachDataChannelHandlers(dataChannel, peerId);
        this.dataChannels.set(peerId, dataChannel);
        console.log(`📡 DataChannel গ্রহণ: ${peerId}`);
    }

    /**
     * DataChannel ইভেন্ট হ্যান্ডলার সেটআপ
     */
    _attachDataChannelHandlers(dc, peerId) {
        dc.onopen = () => {
            console.log(`✅ DataChannel ওপেন: ${peerId}`);
            // রিকানেক্ট হলে incomplete transfers resume করি
            this._checkPendingResumes(peerId);
        };

        dc.onclose = () => {
            console.log(`🔒 DataChannel বন্ধ: ${peerId}`);
            // চলমান ট্রান্সফার pause করি
            this._pauseTransfersForPeer(peerId);
        };

        dc.onerror = (err) => {
            console.error(`❌ DataChannel এরর (${peerId}):`, err);
        };

        dc.onmessage = (event) => {
            this._handleDataChannelMessage(peerId, event.data);
        };
    }

    // ========================================
    // ===== SENDING ==========================
    // ========================================

    /**
     * ফাইল পাঠানো শুরু করে
     * 
     * @param {string} peerId - কাকে পাঠাবে
     * @param {File} file - কোন ফাইল পাঠাবে
     * @returns {string} fileId
     */
    async sendFile(peerId, file) {
        const fileId = generateFileId();
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        const transfer = {
            fileId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type || 'application/octet-stream',
            totalChunks,
            chunkSize: CHUNK_SIZE,
            peerId,
            direction: 'send',
            status: TransferStatus.OFFERING,
            sentChunks: 0,
            startTime: Date.now(),
        };

        this.transfers.set(fileId, transfer);
        this.fileRefs.set(fileId, file);

        // DataChannel ensure করি
        this.setupDataChannel(peerId);

        // Socket.IO দিয়ে ফাইল অফার পাঠাই
        this.socket.emit('file-offer', {
            targetId: peerId,
            fileId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type || 'application/octet-stream',
            totalChunks,
            chunkSize: CHUNK_SIZE,
        });

        this._emitStatusChange(fileId, transfer);
        console.log(`📤 ফাইল অফার পাঠানো হয়েছে: ${file.name} (${formatFileSize(file.size)})`);

        return fileId;
    }

    /**
     * ফাইল chunk গুলো পাঠায় (accepted হওয়ার পর)
     * 
     * Flow control:
     * - DataChannel এর buffer check করে
     * - Buffer ভরে গেলে অপেক্ষা করে (backpressure)
     * - মোবাইলে crash এড়াতে এটা critical!
     */
    async _startSending(fileId, startFromChunk = 0, missingChunks = null) {
        const transfer = this.transfers.get(fileId);
        if (!transfer) return;

        const file = this.fileRefs.get(fileId);
        if (!file) {
            console.error(`❌ ফাইল রেফারেন্স নেই: ${fileId}`);
            this._failTransfer(fileId, 'ফাইল পাওয়া যায়নি');
            return;
        }

        const dc = this.dataChannels.get(transfer.peerId);
        if (!dc || dc.readyState !== 'open') {
            console.warn('⚠️ DataChannel রেডি নয়, পরে চেষ্টা হবে');
            transfer.status = TransferStatus.PAUSED;
            this._emitStatusChange(fileId, transfer);
            return;
        }

        transfer.status = TransferStatus.TRANSFERRING;
        this._emitStatusChange(fileId, transfer);

        // কোন chunk গুলো পাঠাতে হবে
        const chunksToSend = [];
        if (missingChunks && missingChunks.length > 0) {
            // Resume: শুধু missing chunks
            chunksToSend.push(...missingChunks);
        } else {
            // Fresh start: সব chunk
            for (let i = startFromChunk; i < transfer.totalChunks; i++) {
                chunksToSend.push(i);
            }
        }

        console.log(`📤 পাঠানো শুরু: ${chunksToSend.length} chunks`);

        for (const chunkIndex of chunksToSend) {
            // বাতিল হলে বন্ধ করি
            if (transfer.status === TransferStatus.CANCELLED || 
                transfer.status === TransferStatus.FAILED) {
                return;
            }

            // Paused হলে অপেক্ষা
            if (transfer.status === TransferStatus.PAUSED) {
                console.log('⏸️ ট্রান্সফার পজ করা হয়েছে');
                return;
            }

            // File থেকে chunk পড়ি
            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const blob = file.slice(start, end);
            const arrayBuffer = await blob.arrayBuffer();

            // === Backpressure / Flow Control ===
            // Buffer ভরে গেলে অপেক্ষা করি - এটাই মোবাইলে crash আটকায়
            while (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                if (dc.readyState !== 'open') {
                    transfer.status = TransferStatus.PAUSED;
                    this._emitStatusChange(fileId, transfer);
                    return;
                }
                await this._waitForBufferDrain(dc);
            }

            // Header তৈরি করি (8 bytes fileId hash + 4 bytes chunk index)
            const header = this._createChunkHeader(fileId, chunkIndex);

            // Header + Data মিলিয়ে পাঠাই
            const packet = new Uint8Array(header.byteLength + arrayBuffer.byteLength);
            packet.set(new Uint8Array(header), 0);
            packet.set(new Uint8Array(arrayBuffer), header.byteLength);

            try {
                dc.send(packet.buffer);
            } catch (err) {
                console.error(`❌ Chunk পাঠাতে সমস্যা (${chunkIndex}):`, err);
                transfer.status = TransferStatus.PAUSED;
                this._emitStatusChange(fileId, transfer);
                return;
            }

            transfer.sentChunks++;

            // প্রগ্রেস রিপোর্ট (প্রতি 10 chunk বা শেষ chunk)
            if (transfer.sentChunks % 10 === 0 || transfer.sentChunks >= transfer.totalChunks) {
                this._emitProgress(fileId, transfer);
            }
        }

        // সব পাঠানো হয়ে গেলে (sender side complete)
        transfer.status = TransferStatus.COMPLETED;
        transfer.endTime = Date.now();
        this._emitStatusChange(fileId, transfer);
        console.log(`✅ ফাইল পাঠানো সম্পূর্ণ: ${transfer.fileName}`);
    }

    // ========================================
    // ===== RECEIVING ========================
    // ========================================

    /**
     * ফাইল অফার হ্যান্ডল করে
     */
    async _handleFileOffer(data) {
        const transfer = {
            fileId: data.fileId,
            fileName: data.fileName,
            fileSize: data.fileSize,
            fileType: data.fileType,
            totalChunks: data.totalChunks,
            chunkSize: data.chunkSize,
            peerId: data.senderId,
            direction: 'receive',
            status: TransferStatus.WAITING,
            receivedChunks: 0,
            startTime: Date.now(),
        };

        this.transfers.set(data.fileId, transfer);

        // IndexedDB তে metadata সেভ করি
        await this.chunkStore.createTransfer({
            fileId: data.fileId,
            fileName: data.fileName,
            fileSize: data.fileSize,
            fileType: data.fileType,
            totalChunks: data.totalChunks,
            chunkSize: data.chunkSize,
            peerId: data.senderId,
            status: 'receiving',
            createdAt: Date.now(),
        });

        // UI callback
        if (this.onTransferOffer) {
            this.onTransferOffer(transfer);
        }
    }

    /**
     * ফাইল accept/reject করে
     */
    acceptFile(fileId) {
        const transfer = this.transfers.get(fileId);
        if (!transfer) return;

        transfer.status = TransferStatus.ACCEPTED;
        this._emitStatusChange(fileId, transfer);

        // Sender কে জানাই
        this.socket.emit('file-response', {
            targetId: transfer.peerId,
            fileId,
            accepted: true,
        });
    }

    rejectFile(fileId) {
        const transfer = this.transfers.get(fileId);
        if (!transfer) return;

        transfer.status = TransferStatus.CANCELLED;
        this._emitStatusChange(fileId, transfer);

        this.socket.emit('file-response', {
            targetId: transfer.peerId,
            fileId,
            accepted: false,
        });

        // Clean up
        this.transfers.delete(fileId);
        this.chunkStore.deleteTransfer(fileId);
    }

    /**
     * DataChannel থেকে message হ্যান্ডল করে
     * 
     * Binary message format:
     * [4 bytes fileId hash][4 bytes chunk index][...chunk data...]
     */
    async _handleDataChannelMessage(peerId, data) {
        if (typeof data === 'string') {
            // Control message (JSON)
            try {
                const msg = JSON.parse(data);
                this._handleControlMessage(peerId, msg);
            } catch (e) {
                console.warn('অজানা string message:', data);
            }
            return;
        }

        // Binary = chunk data
        const buffer = data instanceof ArrayBuffer ? data : data.buffer;
        const view = new DataView(buffer);

        // Header পড়ি (8 bytes)
        const fileIdHash = view.getUint32(0);
        const chunkIndex = view.getUint32(4);

        // কোন ট্রান্সফারের chunk?
        const transfer = this._findTransferByHash(fileIdHash);
        if (!transfer) {
            console.warn(`⚠️ অজানা ফাইল hash: ${fileIdHash}`);
            return;
        }

        // Chunk data extract করি (header skip)
        const chunkData = buffer.slice(8);

        // IndexedDB তে সেভ করি (মেমরি-সেফ!)
        try {
            await this.chunkStore.saveChunk(transfer.fileId, chunkIndex, chunkData);
            transfer.receivedChunks++;

            // প্রগ্রেস রিপোর্ট
            if (transfer.receivedChunks % 10 === 0 || 
                transfer.receivedChunks >= transfer.totalChunks) {
                this._emitProgress(transfer.fileId, transfer);
            }

            // সব chunk পেয়ে গেলে → ফাইল assemble
            if (transfer.receivedChunks >= transfer.totalChunks) {
                await this._completeReceive(transfer.fileId);
            }
        } catch (err) {
            console.error(`❌ Chunk সেভ এরর (${chunkIndex}):`, err);
        }
    }

    /**
     * Control message হ্যান্ডল
     */
    _handleControlMessage(peerId, msg) {
        switch (msg.type) {
            case 'transfer-complete-ack':
                console.log(`✅ Receiver confirmation: ${msg.fileId}`);
                break;
        }
    }

    /**
     * ফাইল receive সম্পূর্ণ
     */
    async _completeReceive(fileId) {
        const transfer = this.transfers.get(fileId);
        if (!transfer) return;

        try {
            console.log(`🔧 ফাইল assemble করা হচ্ছে: ${transfer.fileName}`);

            // IndexedDB থেকে chunks মিলিয়ে Blob তৈরি
            const blob = await this.chunkStore.assembleFile(
                fileId,
                transfer.totalChunks,
                transfer.fileType
            );

            // ডাউনলোড trigger
            this._downloadBlob(blob, transfer.fileName);

            transfer.status = TransferStatus.COMPLETED;
            transfer.endTime = Date.now();
            this._emitStatusChange(fileId, transfer);

            // Sender কে confirmation পাঠাই
            const dc = this.dataChannels.get(transfer.peerId);
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify({
                    type: 'transfer-complete-ack',
                    fileId
                }));
            }

            // IndexedDB cleanup (ফাইল ডাউনলোড হয়ে গেছে)
            await this.chunkStore.updateTransfer(fileId, { status: 'completed' });

            if (this.onTransferComplete) {
                this.onTransferComplete(transfer);
            }

            console.log(`✅ ফাইল ডাউনলোড রেডি: ${transfer.fileName}`);

            // কিছুক্ষণ পর chunks মুছে দিই (storage বাঁচাতে)
            setTimeout(() => {
                this.chunkStore.deleteTransfer(fileId).catch(() => {});
            }, 30000);

        } catch (err) {
            console.error(`❌ ফাইল assemble এরর:`, err);
            this._failTransfer(fileId, 'ফাইল তৈরি করতে সমস্যা');
        }
    }

    /**
     * Blob ডাউনলোড করে
     */
    _downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        // Cleanup - কিছুক্ষণ পর URL revoke করি
        setTimeout(() => {
            URL.revokeObjectURL(url);
            a.remove();
        }, 5000);
    }

    // ========================================
    // ===== FILE RESPONSE (sender side) =====
    // ========================================

    _handleFileResponse(data) {
        const transfer = this.transfers.get(data.fileId);
        if (!transfer) return;

        if (data.accepted) {
            transfer.status = TransferStatus.ACCEPTED;
            this._emitStatusChange(data.fileId, transfer);
            // পাঠানো শুরু করি
            this._startSending(data.fileId);
        } else {
            transfer.status = TransferStatus.CANCELLED;
            this._emitStatusChange(data.fileId, transfer);
            this.fileRefs.delete(data.fileId);
            this.transfers.delete(data.fileId);
        }
    }

    // ========================================
    // ===== RESUME ===========================
    // ========================================

    /**
     * রিকানেক্ট হলে incomplete transfers চেক করে resume করে
     */
    async _checkPendingResumes(peerId) {
        try {
            const incompleteTransfers = await this.chunkStore.getIncompleteTransfers();
            
            for (const t of incompleteTransfers) {
                if (t.peerId === peerId) {
                    // Receiver side: sender কে জানাই কোন chunk দরকার
                    const receivedIndices = await this.chunkStore.getReceivedChunkIndices(t.fileId);
                    const missingChunks = [];
                    for (let i = 0; i < t.totalChunks; i++) {
                        if (!receivedIndices.has(i)) {
                            missingChunks.push(i);
                        }
                    }

                    if (missingChunks.length > 0) {
                        console.log(`🔄 Resume: ${t.fileName} - ${missingChunks.length} chunks বাকি`);

                        // In-memory transfer state পুনরুদ্ধার
                        if (!this.transfers.has(t.fileId)) {
                            this.transfers.set(t.fileId, {
                                ...t,
                                direction: 'receive',
                                status: TransferStatus.TRANSFERRING,
                                receivedChunks: receivedIndices.size,
                            });
                        }

                        this.socket.emit('file-resume', {
                            targetId: peerId,
                            fileId: t.fileId,
                            missingChunks,
                            fileName: t.fileName,
                        });

                        this._emitStatusChange(t.fileId, this.transfers.get(t.fileId));
                    } else {
                        // সব chunk আছে, complete করি
                        if (!this.transfers.has(t.fileId)) {
                            this.transfers.set(t.fileId, {
                                ...t,
                                direction: 'receive',
                                receivedChunks: t.totalChunks,
                            });
                        }
                        await this._completeReceive(t.fileId);
                    }
                }
            }
        } catch (err) {
            console.error('Resume check এরর:', err);
        }
    }

    /**
     * Resume রিকোয়েস্ট হ্যান্ডল (sender side)
     */
    _handleResumeRequest(data) {
        const transfer = this.transfers.get(data.fileId);
        const file = this.fileRefs.get(data.fileId);

        if (transfer && file) {
            console.log(`🔄 Resume পাঠাচ্ছি: ${data.missingChunks.length} chunks`);
            this._startSending(data.fileId, 0, data.missingChunks);
        } else {
            console.warn(`⚠️ Resume: ফাইল রেফারেন্স নেই (sender reopened?): ${data.fileId}`);
            // Sender browser refresh করলে file reference হারায় 
            // এক্ষেত্রে sender কে আবার ফাইল select করতে হবে
            this.socket.emit('file-cancel', {
                targetId: data.senderId,
                fileId: data.fileId,
                reason: 'sender-lost-file'
            });
        }
    }

    // ========================================
    // ===== CANCEL / PAUSE ==================
    // ========================================

    /**
     * ট্রান্সফার বাতিল করে
     */
    cancelTransfer(fileId) {
        const transfer = this.transfers.get(fileId);
        if (!transfer) return;

        transfer.status = TransferStatus.CANCELLED;
        this._emitStatusChange(fileId, transfer);

        // অপর পক্ষকে জানাই
        this.socket.emit('file-cancel', {
            targetId: transfer.peerId,
            fileId,
            reason: 'user-cancelled'
        });

        // Cleanup
        this.fileRefs.delete(fileId);
        this.chunkStore.deleteTransfer(fileId).catch(() => {});
    }

    _handleCancel(data) {
        const transfer = this.transfers.get(data.fileId);
        if (!transfer) return;

        transfer.status = TransferStatus.CANCELLED;
        this._emitStatusChange(data.fileId, transfer);
        this.chunkStore.deleteTransfer(data.fileId).catch(() => {});
    }

    /**
     * Peer disconnect হলে চলমান transfers pause
     */
    _pauseTransfersForPeer(peerId) {
        for (const [fileId, transfer] of this.transfers) {
            if (transfer.peerId === peerId && 
                transfer.status === TransferStatus.TRANSFERRING) {
                transfer.status = TransferStatus.PAUSED;
                this._emitStatusChange(fileId, transfer);
                console.log(`⏸️ ট্রান্সফার পজ: ${transfer.fileName}`);
            }
        }
    }

    // ========================================
    // ===== HELPERS ==========================
    // ========================================

    /**
     * Chunk header তৈরি করে
     * Format: [4 bytes fileId hash][4 bytes chunk index]
     */
    _createChunkHeader(fileId, chunkIndex) {
        const header = new ArrayBuffer(8);
        const view = new DataView(header);
        view.setUint32(0, this._hashString(fileId));
        view.setUint32(4, chunkIndex);
        return header;
    }

    /**
     * fileId hash থেকে transfer খুঁজে বের করে
     */
    _findTransferByHash(hash) {
        for (const [fileId, transfer] of this.transfers) {
            if (this._hashString(fileId) === hash) {
                return transfer;
            }
        }
        return null;
    }

    /**
     * Simple string hash (djb2)
     */
    _hashString(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xFFFFFFFF;
        }
        return hash >>> 0;
    }

    /**
     * DataChannel buffer drain হওয়া পর্যন্ত অপেক্ষা
     */
    _waitForBufferDrain(dc) {
        return new Promise((resolve) => {
            const check = () => {
                if (dc.bufferedAmount <= MAX_BUFFERED_AMOUNT / 2 || dc.readyState !== 'open') {
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            // bufferedamountlow event আছে কিনা চেক করি
            if (typeof dc.onbufferedamountlow !== 'undefined') {
                dc.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;
                dc.onbufferedamountlow = () => {
                    dc.onbufferedamountlow = null;
                    resolve();
                };
            } else {
                setTimeout(check, 50);
            }
        });
    }

    /**
     * ট্রান্সফার ব্যর্থ
     */
    _failTransfer(fileId, reason) {
        const transfer = this.transfers.get(fileId);
        if (!transfer) return;

        transfer.status = TransferStatus.FAILED;
        transfer.error = reason;
        this._emitStatusChange(fileId, transfer);

        if (this.onTransferFailed) {
            this.onTransferFailed(transfer, reason);
        }
    }

    /**
     * প্রগ্রেস callback
     */
    _emitProgress(fileId, transfer) {
        if (this.onTransferProgress) {
            const sent = transfer.direction === 'send' ? transfer.sentChunks : transfer.receivedChunks;
            const percent = Math.round((sent / transfer.totalChunks) * 100);
            const elapsed = (Date.now() - transfer.startTime) / 1000;
            const bytesTransferred = sent * transfer.chunkSize;
            const speed = elapsed > 0 ? bytesTransferred / elapsed : 0;

            this.onTransferProgress({
                fileId,
                fileName: transfer.fileName,
                fileSize: transfer.fileSize,
                direction: transfer.direction,
                percent,
                speed,
                bytesTransferred,
                elapsed,
            });
        }
    }

    /**
     * Status change callback
     */
    _emitStatusChange(fileId, transfer) {
        if (this.onTransferStatusChange) {
            this.onTransferStatusChange({
                fileId,
                fileName: transfer.fileName,
                fileSize: transfer.fileSize,
                direction: transfer.direction,
                status: transfer.status,
            });
        }
    }

    /**
     * সব active transfer পায়
     */
    getActiveTransfers() {
        return Array.from(this.transfers.values()).filter(t =>
            t.status !== TransferStatus.COMPLETED &&
            t.status !== TransferStatus.CANCELLED &&
            t.status !== TransferStatus.FAILED
        );
    }

    /**
     * Cleanup
     */
    destroy() {
        for (const [, dc] of this.dataChannels) {
            if (dc.readyState === 'open') dc.close();
        }
        this.dataChannels.clear();
        this.transfers.clear();
        this.fileRefs.clear();
    }
}

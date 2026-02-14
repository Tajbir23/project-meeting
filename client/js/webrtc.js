/**
 * WebRTC ম্যানেজার
 * 
 * WebRTC কী?
 * ===========
 * WebRTC (Web Real-Time Communication) হলো একটি প্রযুক্তি যা:
 * - ব্রাউজারে সরাসরি অডিও/ভিডিও শেয়ার করতে দেয়
 * - কোনো প্লাগইন ছাড়াই কাজ করে
 * - পিয়ার-টু-পিয়ার (সরাসরি) কানেকশন তৈরি করে
 * 
 * মূল কম্পোনেন্ট:
 * ===============
 * 1. RTCPeerConnection - দুই ব্রাউজারের মধ্যে কানেকশন
 * 2. MediaStream - ক্যামেরা/মাইকের স্ট্রিম
 * 3. ICE Candidates - নেটওয়ার্ক তথ্য বিনিময়
 */

/**
 * WebRTC Manager Class
 * 
 * এই ক্লাস পিয়ার কানেকশন পরিচালনা করে
 */
export class WebRTCManager {
    constructor(socket, localStream, iceServers) {
        // সকেট (সিগনালিং এর জন্য)
        this.socket = socket;
        
        // লোকাল মিডিয়া স্ট্রিম
        this.localStream = localStream;
        
        // ICE সার্ভার কনফিগারেশন
        this.iceServers = iceServers;
        
        // পিয়ার কানেকশনগুলো রাখার জন্য Map
        // Map<userId, RTCPeerConnection>
        this.peerConnections = new Map();
        
        // রিমোট স্ট্রিমগুলো রাখার জন্য Map
        // Map<userId, MediaStream>
        this.remoteStreams = new Map();
        
        // Offer তৈরি হচ্ছে কিনা ট্র্যাক করি (duplicate offer আটকাতে)
        // Map<userId, boolean>
        this.makingOffer = new Map();
        
        // কলব্যাক ফাংশনস
        this.onRemoteStream = null;      // নতুন রিমোট স্ট্রিম এলে
        this.onRemoteStreamRemoved = null; // রিমোট স্ট্রিম গেলে
        this.onConnectionStateChange = null;
        this.onDataChannel = null;       // Remote DataChannel পেলে
        
        console.log('🔌 WebRTC Manager তৈরি হয়েছে');
    }
    
    /**
     * নতুন পিয়ার কানেকশন তৈরি করে
     * 
     * RTCPeerConnection কী?
     * - এটা দুই ব্রাউজারের মধ্যে "সেতু"
     * - এই সেতু দিয়ে অডিও/ভিডিও যায়
     * 
     * @param {string} userId - অপর পক্ষের ইউজার আইডি
     * @param {boolean} isInitiator - আমি কি কল শুরু করছি?
     * @returns {RTCPeerConnection}
     */
    createPeerConnection(userId, isInitiator = false) {
        console.log(`🤝 পিয়ার কানেকশন তৈরি করছি: ${userId} (Initiator: ${isInitiator})`);
        
        // কনফিগারেশন
        const config = {
            iceServers: this.iceServers,
            // ICE ট্রান্সপোর্ট পলিসি
            // 'all' = সব রাস্তা চেষ্টা করে
            // 'relay' = শুধু TURN ব্যবহার করে
            iceTransportPolicy: 'all'
        };
        
        // নতুন কানেকশন তৈরি
        const peerConnection = new RTCPeerConnection(config);
        
        // ===== ইভেন্ট হ্যান্ডলার সেটআপ =====
        
        /**
         * ICE Candidate পাওয়া গেলে
         * 
         * ICE Candidate কী?
         * - নেটওয়ার্ক "রাস্তা" - কীভাবে আমার কাছে পৌঁছাবে
         * - প্রতিটি candidate একটা সম্ভাব্য রাস্তা
         * - ব্রাউজার অনেকগুলো candidate খুঁজে বের করে
         */
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`🧊 ICE Candidate পাওয়া গেছে → ${userId}`);
                
                // সিগনালিং সার্ভারে পাঠাই
                this.socket.emit('ice-candidate', {
                    targetId: userId,
                    candidate: event.candidate
                });
            }
        };
        
        /**
         * ICE কানেকশন স্টেট পরিবর্তন
         * 
         * States:
         * - new: শুরু হয়নি
         * - checking: রাস্তা খুঁজছে
         * - connected: কানেক্ট হয়েছে! 🎉
         * - disconnected: সাময়িক বিচ্ছিন্ন
         * - failed: ব্যর্থ
         * - closed: বন্ধ
         */
        peerConnection.oniceconnectionstatechange = () => {
            const state = peerConnection.iceConnectionState;
            console.log(`📡 ICE স্টেট (${userId}): ${state}`);
            
            if (this.onConnectionStateChange) {
                this.onConnectionStateChange(userId, state);
            }
            
            // ব্যর্থ হলে রিকানেক্ট চেষ্টা
            if (state === 'failed') {
                console.log('⚠️ কানেকশন ব্যর্থ, রিস্টার্ট করছি...');
                peerConnection.restartIce();
            }
        };
        
        /**
         * রিমোট ট্র্যাক পাওয়া গেলে
         * 
         * Track কী?
         * - একটা মিডিয়া স্ট্রিমের অংশ
         * - অডিও ট্র্যাক = মাইক্রোফোনের সাউন্ড
         * - ভিডিও ট্র্যাক = ক্যামেরার ছবি
         */
        peerConnection.ontrack = (event) => {
            console.log(`🎥 রিমোট ট্র্যাক পাওয়া গেছে (${userId}): ${event.track.kind}`);
            console.log(`   Streams count: ${event.streams.length}`);
            
            // event.streams[0] ব্যবহার করি - এটা সবচেয়ে reliable
            let remoteStream;
            
            if (event.streams && event.streams.length > 0) {
                // এটাই best approach
                remoteStream = event.streams[0];
                console.log(`   Using event.streams[0], tracks: ${remoteStream.getTracks().length}`);
            } else {
                // Fallback: manual stream creation
                remoteStream = this.remoteStreams.get(userId);
                if (!remoteStream) {
                    remoteStream = new MediaStream();
                }
                remoteStream.addTrack(event.track);
                console.log(`   Created manual stream, tracks: ${remoteStream.getTracks().length}`);
            }
            
            // রিমোট স্ট্রিম সেভ করি
            this.remoteStreams.set(userId, remoteStream);
            
            // কলব্যাক কল করি (UI আপডেটের জন্য)
            if (this.onRemoteStream) {
                this.onRemoteStream(userId, remoteStream);
            }
        };
        
        /**
         * নেগোশিয়েশন প্রয়োজন হলে
         * 
         * Negotiation কী?
         * - দুই পক্ষ কথা বলে ঠিক করে কীভাবে মিডিয়া আদান-প্রদান হবে
         * - যখন নতুন ট্র্যাক যোগ হয় বা সেটিংস বদলায়
         */
        peerConnection.onnegotiationneeded = async () => {
            console.log(`🔄 Negotiation প্রয়োজন (${userId})`);
            
            // শুধু initiator offer পাঠায়
            if (isInitiator) {
                await this.createAndSendOffer(userId);
            }
        };

        /**
         * Remote DataChannel পেলে (ফাইল ট্রান্সফারের জন্য)
         */
        peerConnection.ondatachannel = (event) => {
            console.log(`📡 Remote DataChannel পাওয়া গেছে (${userId}): ${event.channel.label}`);
            if (this.onDataChannel) {
                this.onDataChannel(userId, event.channel);
            }
        };
        
        // ===== লোকাল ট্র্যাক যোগ করি =====
        /**
         * আমার ক্যামেরা/মাইকের ট্র্যাক পিয়ার কানেকশনে যোগ করি
         * এতে অপর পক্ষ আমাকে দেখতে/শুনতে পাবে
         */
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log(`➕ লোকাল ট্র্যাক যোগ করছি: ${track.kind}`);
                peerConnection.addTrack(track, this.localStream);
            });
        }
        
        // সেভ করে রাখি
        this.peerConnections.set(userId, peerConnection);
        
        return peerConnection;
    }
    
    /**
     * Offer তৈরি করে পাঠায়
     * 
     * Offer কী?
     * - "আমি তোমাকে কল করতে চাই" মেসেজ
     * - এতে থাকে: কলারের মিডিয়া তথ্য (কোডেক, রেজোলিউশন ইত্যাদি)
     * 
     * @param {string} userId - টার্গেট ইউজার
     */
    async createAndSendOffer(userId) {
        try {
            const peerConnection = this.peerConnections.get(userId);
            if (!peerConnection) return;
            
            // ইতিমধ্যে offer তৈরি হচ্ছে কিনা চেক করি
            if (this.makingOffer.get(userId)) {
                console.log(`⏳ ইতিমধ্যে offer তৈরি হচ্ছে: ${userId}`);
                return;
            }
            
            // Signaling state চেক - শুধু stable state থাকলেই offer করি
            if (peerConnection.signalingState !== 'stable') {
                console.log(`⏳ Offer স্কিপ করছি - state: ${peerConnection.signalingState}`);
                return;
            }
            
            // মার্ক করি যে offer তৈরি হচ্ছে
            this.makingOffer.set(userId, true);
            
            console.log(`📤 Offer তৈরি করছি → ${userId}`);
            
            // Offer তৈরি
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            // আবার state চেক করি (race condition এড়াতে)
            if (peerConnection.signalingState !== 'stable') {
                console.log(`⚠️ State বদলে গেছে, offer বাদ দিচ্ছি`);
                this.makingOffer.set(userId, false);
                return;
            }
            
            // লোকাল ডেসক্রিপশন সেট করি
            await peerConnection.setLocalDescription(offer);
            
            // সার্ভারে পাঠাই
            this.socket.emit('offer', {
                targetId: userId,
                offer: offer
            });
            
            console.log(`✅ Offer পাঠানো হয়েছে → ${userId}`);
            
        } catch (error) {
            console.error('❌ Offer তৈরি করতে সমস্যা:', error);
        } finally {
            // ফ্ল্যাগ রিসেট করি
            this.makingOffer.set(userId, false);
        }
    }
    
    /**
     * Offer হ্যান্ডল করে Answer পাঠায়
     * 
     * Answer কী?
     * - "হ্যাঁ, আমি কল রিসিভ করতে রাজি" মেসেজ
     * - এতে থাকে: রিসিভারের মিডিয়া তথ্য
     * 
     * @param {string} userId - যে Offer পাঠিয়েছে
     * @param {RTCSessionDescription} offer - প্রাপ্ত Offer
     */
    async handleOffer(userId, offer) {
        try {
            console.log(`📥 Offer পাওয়া গেছে ← ${userId}`);
            
            // পিয়ার কানেকশন আছে নাকি তৈরি করতে হবে?
            let peerConnection = this.peerConnections.get(userId);
            
            if (!peerConnection) {
                // নতুন কানেকশন তৈরি (আমি initiator না)
                peerConnection = this.createPeerConnection(userId, false);
            }
            
            // রিমোট ডেসক্রিপশন সেট করি
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            // Answer তৈরি করি
            console.log(`📤 Answer তৈরি করছি → ${userId}`);
            const answer = await peerConnection.createAnswer();
            
            // লোকাল ডেসক্রিপশন সেট করি
            await peerConnection.setLocalDescription(answer);
            
            // সার্ভারে পাঠাই
            this.socket.emit('answer', {
                targetId: userId,
                answer: answer
            });
            
            console.log(`✅ Answer পাঠানো হয়েছে → ${userId}`);
            
        } catch (error) {
            console.error('❌ Offer হ্যান্ডল করতে সমস্যা:', error);
        }
    }
    
    /**
     * Answer হ্যান্ডল করে
     * 
     * @param {string} userId - যে Answer পাঠিয়েছে
     * @param {RTCSessionDescription} answer - প্রাপ্ত Answer
     */
    async handleAnswer(userId, answer) {
        try {
            console.log(`📥 Answer পাওয়া গেছে ← ${userId}`);
            
            const peerConnection = this.peerConnections.get(userId);
            if (!peerConnection) {
                console.warn('⚠️ পিয়ার কানেকশন পাওয়া যায়নি');
                return;
            }
            
            // Signaling state চেক - শুধু have-local-offer থাকলেই answer সেট করি
            if (peerConnection.signalingState !== 'have-local-offer') {
                console.log(`⏳ Answer স্কিপ করছি - state: ${peerConnection.signalingState}`);
                return;
            }
            
            // রিমোট ডেসক্রিপশন সেট করি
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            
            console.log(`✅ Answer সেট হয়েছে ← ${userId}`);
            
        } catch (error) {
            console.error('❌ Answer হ্যান্ডল করতে সমস্যা:', error);
        }
    }
    
    /**
     * ICE Candidate হ্যান্ডল করে
     * 
     * @param {string} userId - যে Candidate পাঠিয়েছে
     * @param {RTCIceCandidate} candidate - প্রাপ্ত Candidate
     */
    async handleIceCandidate(userId, candidate) {
        try {
            const peerConnection = this.peerConnections.get(userId);
            if (!peerConnection) {
                console.warn('⚠️ পিয়ার কানেকশন পাওয়া যায়নি');
                return;
            }
            
            // Candidate যোগ করি
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log(`🧊 ICE Candidate যোগ হয়েছে ← ${userId}`);
            
        } catch (error) {
            console.error('❌ ICE Candidate যোগ করতে সমস্যা:', error);
        }
    }
    
    /**
     * নতুন ইউজারের সাথে কানেকশন শুরু করে
     * 
     * @param {string} userId - নতুন ইউজারের আইডি
     */
    async connectToUser(userId) {
        console.log(`📞 কানেক্ট করছি: ${userId}`);
        
        // পিয়ার কানেকশন তৈরি (আমি initiator)
        const peerConnection = this.createPeerConnection(userId, true);
        
        // Offer তৈরি করে পাঠাই
        await this.createAndSendOffer(userId);
    }
    
    /**
     * ইউজারের কানেকশন বন্ধ করে
     * 
     * @param {string} userId - বন্ধ করতে চাওয়া ইউজার
     */
    closeConnection(userId) {
        console.log(`❌ কানেকশন বন্ধ করছি: ${userId}`);
        
        // পিয়ার কানেকশন বন্ধ করি
        const peerConnection = this.peerConnections.get(userId);
        if (peerConnection) {
            peerConnection.close();
            this.peerConnections.delete(userId);
        }
        
        // রিমোট স্ট্রিম মুছে ফেলি
        this.remoteStreams.delete(userId);
        
        // কলব্যাক কল করি
        if (this.onRemoteStreamRemoved) {
            this.onRemoteStreamRemoved(userId);
        }
    }
    
    /**
     * সব কানেকশন বন্ধ করে
     */
    closeAllConnections() {
        console.log('❌ সব কানেকশন বন্ধ করছি...');
        
        this.peerConnections.forEach((pc, userId) => {
            pc.close();
        });
        
        this.peerConnections.clear();
        this.remoteStreams.clear();
    }
    
    /**
     * লোকাল স্ট্রিম আপডেট করে
     * 
     * @param {MediaStream} newStream - নতুন স্ট্রিম
     */
    updateLocalStream(newStream) {
        this.localStream = newStream;
        
        // সব পিয়ার কানেকশনে নতুন ট্র্যাক যোগ করি
        this.peerConnections.forEach(async (pc, userId) => {
            // পুরনো ট্র্যাক রিপ্লেস করি
            const senders = pc.getSenders();
            
            newStream.getTracks().forEach(newTrack => {
                const sender = senders.find(s => s.track?.kind === newTrack.kind);
                if (sender) {
                    sender.replaceTrack(newTrack);
                }
            });
        });
    }
    
    /**
     * অডিও মিউট/আনমিউট করে
     * 
     * @param {boolean} enabled - চালু করতে চাইলে true
     */
    setAudioEnabled(enabled) {
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = enabled;
            });
        }
    }
    
    /**
     * ভিডিও অন/অফ করে
     * 
     * @param {boolean} enabled - চালু করতে চাইলে true
     */
    setVideoEnabled(enabled) {
        if (this.localStream) {
            this.localStream.getVideoTracks().forEach(track => {
                track.enabled = enabled;
            });
        }
    }
    
    /**
     * ভিডিও ট্র্যাক রিপ্লেস করে (স্ক্রিন শেয়ারের জন্য)
     * 
     * এটা সব পিয়ার কানেকশনে video track পরিবর্তন করে।
     * ক্যামেরা → স্ক্রিন, অথবা স্ক্রিন → ক্যামেরা
     * 
     * @param {MediaStreamTrack} newTrack - নতুন ভিডিও ট্র্যাক
     */
    replaceVideoTrack(newTrack) {
        console.log(`🔄 ভিডিও ট্র্যাক রিপ্লেস করছি: ${newTrack.kind}`);
        
        // সব পিয়ার কানেকশনে ভিডিও ট্র্যাক রিপ্লেস করি
        this.peerConnections.forEach((pc, peerId) => {
            // সব sender খুঁজি
            const senders = pc.getSenders();
            
            // ভিডিও sender খুঁজে বের করি
            const videoSender = senders.find(sender => 
                sender.track && sender.track.kind === 'video'
            );
            
            if (videoSender) {
                videoSender.replaceTrack(newTrack)
                    .then(() => {
                        console.log(`✅ ট্র্যাক রিপ্লেস হয়েছে → ${peerId}`);
                    })
                    .catch(err => {
                        console.error(`❌ ট্র্যাক রিপ্লেস এরর (${peerId}):`, err);
                    });
            } else {
                console.warn(`⚠️ Video sender পাওয়া যায়নি: ${peerId}`);
            }
        });
    }
}

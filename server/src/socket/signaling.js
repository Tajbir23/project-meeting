/**
 * সিগনালিং হ্যান্ডলার (Signaling Handler)
 * 
 * সিগনালিং কী?
 * ================
 * দুইজন মানুষ ভিডিও কল করতে চাইলে তাদের আগে "কথা বলে ঠিক করতে হয়":
 * - "আমি কোন ফরম্যাটে ভিডিও পাঠাব?"
 * - "তোমার IP অ্যাড্রেস কী?"
 * - "তুমি কি অডিও রিসিভ করতে প্রস্তুত?"
 * 
 * এই "কথা বলা" প্রক্রিয়াকে Signaling বলে।
 * WebRTC নিজে এটা করে না, তাই আমাদের Socket.IO দিয়ে করতে হয়।
 * 
 * Signaling-এর ধাপ:
 * ==================
 * 1. User A: "আমি কল করতে চাই" (offer পাঠায়)
 * 2. User B: "ওকে, আমি রেডি" (answer পাঠায়)
 * 3. দুজনে: "আমার নেটওয়ার্ক তথ্য" (ICE candidates বিনিময়)
 * 4. কানেকশন তৈরি!
 */

import {
    joinRoom,
    leaveRoom,
    getRoom,
    getRoomUsers,
    getRoomSize,
    findUserRoom
} from './roomManager.js';

/**
 * সকেট ইভেন্ট হ্যান্ডলার সেটআপ করে
 * 
 * @param {Object} io - Socket.IO সার্ভার ইন্সট্যান্স
 * @param {Object} mediasoupManager - mediasoup ম্যানেজার (গ্রুপ কলের জন্য)
 */
export function setupSignaling(io, mediasoupManager = null) {
    
    /**
     * নতুন ক্লায়েন্ট কানেক্ট হলে
     */
    io.on('connection', (socket) => {
        console.log(`🔌 নতুন ক্লায়েন্ট কানেক্ট হয়েছে: ${socket.id}`);
        
        /**
         * রুমে জয়েন করা
         * 
         * ক্লায়েন্ট থেকে আসে:
         * { roomId: "abc123", userName: "রহিম" }
         */
        socket.on('join-room', async (data, callback) => {
            try {
                const { roomId, userName } = data;
                
                console.log(`📥 জয়েন রিকোয়েস্ট: ${userName} → ${roomId}`);
                
                // রুমে যোগ করি
                const room = joinRoom(roomId, socket.id, { name: userName });
                
                // Socket.IO রুমে জয়েন করি (মেসেজ ব্রডকাস্টের জন্য)
                socket.join(roomId);
                
                // এই রুমে আগে থেকে কারা আছে?
                const existingUsers = getRoomUsers(roomId).filter(u => u.id !== socket.id);
                
                // রুমে কয়জন আছে দেখি
                const userCount = getRoomSize(roomId);
                
                console.log(`✅ ${userName} জয়েন করেছে। রুমে মোট: ${userCount} জন`);
                
                // অন্যদের জানাই যে নতুন ইউজার এসেছে
                socket.to(roomId).emit('user-joined', {
                    userId: socket.id,
                    userName: userName,
                    userCount: userCount
                });
                
                // কলব্যাক দিয়ে জানাচ্ছি জয়েন সফল
                if (callback) {
                    callback({
                        success: true,
                        roomId: roomId,
                        userId: socket.id,
                        existingUsers: existingUsers.map(u => ({
                            id: u.id,
                            name: u.name
                        })),
                        userCount: userCount,
                        // গ্রুপ কলে (3+ জন) SFU ব্যবহার করব
                        useSfu: userCount > 2
                    });
                }
                
            } catch (error) {
                console.error('❌ জয়েন এরর:', error);
                if (callback) {
                    callback({ success: false, error: error.message });
                }
            }
        });
        
        /**
         * WebRTC Offer পাঠানো
         * 
         * Offer কী?
         * - এটা হলো "আমি তোমাকে কল করতে চাই" মেসেজ
         * - এতে থাকে: কলারের ভিডিও/অডিও ফরম্যাট, কোডেক ইত্যাদি
         * 
         * SDP (Session Description Protocol):
         * - এটা একটা টেক্সট ফরম্যাট যেখানে মিডিয়া তথ্য থাকে
         */
        socket.on('offer', (data) => {
            const { targetId, offer } = data;
            
            console.log(`📤 Offer: ${socket.id} → ${targetId}`);
            
            // টার্গেট ইউজারকে offer পাঠাই
            io.to(targetId).emit('offer', {
                senderId: socket.id,
                offer: offer
            });
        });
        
        /**
         * WebRTC Answer পাঠানো
         * 
         * Answer কী?
         * - এটা হলো "হ্যাঁ, আমি কল রিসিভ করতে প্রস্তুত" মেসেজ
         * - এতে থাকে: রিসিভারের মিডিয়া তথ্য
         */
        socket.on('answer', (data) => {
            const { targetId, answer } = data;
            
            console.log(`📥 Answer: ${socket.id} → ${targetId}`);
            
            // অরিজিনাল কলারকে answer পাঠাই
            io.to(targetId).emit('answer', {
                senderId: socket.id,
                answer: answer
            });
        });
        
        /**
         * ICE Candidate পাঠানো
         * 
         * ICE Candidate কী?
         * =================
         * - ICE = Interactive Connectivity Establishment
         * - এটা হলো "আমার কাছে পৌঁছানোর সম্ভাব্য রাস্তা"
         * - একজনের অনেকগুলো candidate থাকতে পারে:
         *   1. Local IP (192.168.x.x) - একই নেটওয়ার্কে থাকলে কাজ করে
         *   2. Public IP - ইন্টারনেটে কাজ করে
         *   3. TURN relay - ফায়ারওয়াল পার করতে ব্যবহার
         */
        socket.on('ice-candidate', (data) => {
            const { targetId, candidate } = data;
            
            console.log(`🧊 ICE Candidate: ${socket.id} → ${targetId}`);
            
            // টার্গেট ইউজারকে candidate পাঠাই
            io.to(targetId).emit('ice-candidate', {
                senderId: socket.id,
                candidate: candidate
            });
        });
        
        /**
         * মিডিয়া স্টেট পরিবর্তন (মিউট/আনমিউট, ক্যামেরা অন/অফ)
         */
        socket.on('media-state-change', (data) => {
            const roomId = findUserRoom(socket.id);
            if (!roomId) return;
            
            const { audioEnabled, videoEnabled } = data;
            
            console.log(`🎚️ মিডিয়া স্টেট: ${socket.id} - অডিও: ${audioEnabled}, ভিডিও: ${videoEnabled}`);
            
            // রুমের সবাইকে জানাই
            socket.to(roomId).emit('media-state-change', {
                userId: socket.id,
                audioEnabled,
                videoEnabled
            });
        });
        
        /**
         * স্ক্রিন শেয়ার শুরু/শেষ
         */
        socket.on('screen-share-state', (data) => {
            const roomId = findUserRoom(socket.id);
            if (!roomId) return;
            
            console.log(`🖥️ স্ক্রিন শেয়ার: ${socket.id} - ${data.isSharing ? 'শুরু' : 'শেষ'}`);
            
            socket.to(roomId).emit('screen-share-state', {
                userId: socket.id,
                isSharing: data.isSharing
            });
        });
        
        /**
         * চ্যাট মেসেজ
         */
        socket.on('chat-message', (data) => {
            const roomId = findUserRoom(socket.id);
            if (!roomId) return;
            
            console.log(`💬 চ্যাট: ${data.userName}: ${data.message}`);
            
            // রুমের সবাইকে মেসেজ পাঠাই
            io.to(roomId).emit('chat-message', {
                userId: socket.id,
                userName: data.userName,
                message: data.message,
                timestamp: new Date().toISOString()
            });
        });
        
        /**
         * রুম ছেড়ে যাওয়া
         */
        socket.on('leave-room', () => {
            handleUserLeave(socket, io);
        });
        
        /**
         * ডিসকানেক্ট (ব্রাউজার বন্ধ, নেট চলে গেছে ইত্যাদি)
         */
        socket.on('disconnect', (reason) => {
            console.log(`🔌 ডিসকানেক্ট: ${socket.id} (কারণ: ${reason})`);
            handleUserLeave(socket, io);
        });
    });
}

/**
 * ইউজার রুম ছেড়ে গেলে কী করতে হবে
 * 
 * @param {Object} socket - সকেট অবজেক্ট
 * @param {Object} io - Socket.IO সার্ভার
 */
function handleUserLeave(socket, io) {
    // ইউজার কোন রুমে ছিল খুঁজি
    const roomId = findUserRoom(socket.id);
    
    if (roomId) {
        // রুম থেকে বের করি
        leaveRoom(roomId, socket.id);
        
        // অন্যদের জানাই
        socket.to(roomId).emit('user-left', {
            userId: socket.id,
            userCount: getRoomSize(roomId)
        });
        
        // Socket.IO রুম থেকে বের করি
        socket.leave(roomId);
        
        console.log(`👋 ${socket.id} রুম ছেড়ে গেছে: ${roomId}`);
    }
}

export default { setupSignaling };

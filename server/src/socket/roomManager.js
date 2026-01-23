/**
 * রুম ম্যানেজার (Room Manager)
 * 
 * এই ফাইল মিটিং রুম পরিচালনা করে:
 * - নতুন রুম তৈরি
 * - ইউজার যোগ করা/বের করা
 * - রুমের মধ্যে কে কে আছে ট্র্যাক করা
 * - খালি রুম মুছে ফেলা
 */

/**
 * রুম ডাটা স্টোর
 * 
 * Map ব্যবহার করছি কারণ:
 * - দ্রুত খোঁজা যায় (O(1) time complexity)
 * - যেকোনো ধরনের key রাখা যায়
 * 
 * গঠন:
 * rooms = {
 *   "room-id-123": {
 *     id: "room-id-123",
 *     name: "My Meeting",
 *     users: Map { socketId -> userInfo },
 *     createdAt: Date,
 *     router: mediasoupRouter (গ্রুপ কলের জন্য)
 *   }
 * }
 */
const rooms = new Map();

/**
 * নতুন রুম তৈরি করে
 * 
 * @param {string} roomId - রুমের ইউনিক আইডি
 * @param {string} roomName - রুমের নাম (ইউজার দেখবে)
 * @returns {Object} - নতুন রুমের তথ্য
 */
export function createRoom(roomId, roomName = 'Untitled Meeting') {
    // রুম আগে থেকে থাকলে সেটাই রিটার্ন করি
    if (rooms.has(roomId)) {
        console.log(`📍 রুম আগে থেকেই আছে: ${roomId}`);
        return rooms.get(roomId);
    }
    
    // নতুন রুম তৈরি
    const room = {
        id: roomId,
        name: roomName,
        users: new Map(),           // ইউজারদের লিস্ট
        createdAt: new Date(),      // কখন তৈরি হয়েছে
        router: null,               // mediasoup router (পরে সেট হবে)
        producers: new Map(),       // যারা ভিডিও/অডিও পাঠাচ্ছে
        consumers: new Map()        // যারা ভিডিও/অডিও রিসিভ করছে
    };
    
    rooms.set(roomId, room);
    console.log(`✅ নতুন রুম তৈরি হয়েছে: ${roomId}`);
    
    return room;
}

/**
 * রুমে ইউজার যোগ করে
 * 
 * @param {string} roomId - রুমের আইডি
 * @param {string} socketId - ইউজারের সকেট আইডি
 * @param {Object} userInfo - ইউজারের তথ্য (নাম, ছবি ইত্যাদি)
 * @returns {Object|null} - রুমের তথ্য বা null
 */
export function joinRoom(roomId, socketId, userInfo) {
    // রুম না থাকলে তৈরি করি
    let room = rooms.get(roomId);
    if (!room) {
        room = createRoom(roomId);
    }
    
    // ইউজার ইনফো সেট করি
    const user = {
        id: socketId,
        name: userInfo.name || 'Anonymous',
        avatar: userInfo.avatar || null,
        joinedAt: new Date(),
        // মিডিয়া স্টেট
        audioEnabled: true,
        videoEnabled: true,
        // mediasoup transports (পরে সেট হবে)
        producerTransport: null,
        consumerTransport: null
    };
    
    room.users.set(socketId, user);
    
    console.log(`👤 ${user.name} রুমে জয়েন করেছে: ${roomId} (মোট: ${room.users.size} জন)`);
    
    return room;
}

/**
 * রুম থেকে ইউজার বের করে
 * 
 * @param {string} roomId - রুমের আইডি
 * @param {string} socketId - ইউজারের সকেট আইডি
 * @returns {boolean} - সফল হলে true
 */
export function leaveRoom(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) return false;
    
    const user = room.users.get(socketId);
    if (!user) return false;
    
    // ইউজারের transports ক্লোজ করি
    if (user.producerTransport) {
        user.producerTransport.close();
    }
    if (user.consumerTransport) {
        user.consumerTransport.close();
    }
    
    room.users.delete(socketId);
    console.log(`👋 ইউজার রুম ছেড়ে গেছে: ${roomId} (বাকি: ${room.users.size} জন)`);
    
    // রুম খালি হলে মুছে ফেলি
    if (room.users.size === 0) {
        deleteRoom(roomId);
    }
    
    return true;
}

/**
 * রুম মুছে ফেলে
 * 
 * @param {string} roomId - রুমের আইডি
 */
export function deleteRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    // mediasoup router ক্লোজ করি
    if (room.router) {
        room.router.close();
    }
    
    rooms.delete(roomId);
    console.log(`🗑️ রুম মুছে ফেলা হয়েছে: ${roomId}`);
}

/**
 * রুমের তথ্য পায়
 * 
 * @param {string} roomId - রুমের আইডি
 * @returns {Object|null} - রুমের তথ্য
 */
export function getRoom(roomId) {
    return rooms.get(roomId) || null;
}

/**
 * রুমে কে কে আছে তার লিস্ট
 * 
 * @param {string} roomId - রুমের আইডি
 * @returns {Array} - ইউজারদের অ্যারে
 */
export function getRoomUsers(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];
    
    // Map কে Array তে রূপান্তর করি
    return Array.from(room.users.values());
}

/**
 * একটি নির্দিষ্ট ইউজার পায়
 * 
 * @param {string} roomId - রুমের আইডি
 * @param {string} socketId - সকেট আইডি
 * @returns {Object|null} - ইউজারের তথ্য
 */
export function getUser(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    return room.users.get(socketId) || null;
}

/**
 * রুমে কয়জন ইউজার আছে
 * 
 * @param {string} roomId - রুমের আইডি
 * @returns {number} - ইউজার সংখ্যা
 */
export function getRoomSize(roomId) {
    const room = rooms.get(roomId);
    return room ? room.users.size : 0;
}

/**
 * সব রুমের লিস্ট (ডিবাগিং এর জন্য)
 * 
 * @returns {Array} - সব রুমের সারাংশ
 */
export function getAllRooms() {
    const roomList = [];
    rooms.forEach((room, id) => {
        roomList.push({
            id,
            name: room.name,
            userCount: room.users.size,
            createdAt: room.createdAt
        });
    });
    return roomList;
}

/**
 * ইউজার কোন রুমে আছে খুঁজে বের করে
 * 
 * @param {string} socketId - সকেট আইডি
 * @returns {string|null} - রুম আইডি বা null
 */
export function findUserRoom(socketId) {
    for (const [roomId, room] of rooms) {
        if (room.users.has(socketId)) {
            return roomId;
        }
    }
    return null;
}

// সব ফাংশন এক্সপোর্ট
export default {
    createRoom,
    joinRoom,
    leaveRoom,
    deleteRoom,
    getRoom,
    getRoomUsers,
    getUser,
    getRoomSize,
    getAllRooms,
    findUserRoom
};

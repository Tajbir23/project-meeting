/**
 * ChunkStore - IndexedDB ভিত্তিক চাঙ্ক স্টোরেজ
 * 
 * কেন IndexedDB ব্যবহার?
 * =======================
 * - বড় ফাইল (GB+) মেমরিতে রাখলে মোবাইলে crash করবে
 * - IndexedDB ডিস্কে রাখে, তাই মেমরি খরচ কম
 * - ব্রাউজার বন্ধ করলেও ডেটা থাকে (resume সম্ভব!)
 * - Torrent এর মতো: প্রতিটি chunk আলাদাভাবে সেভ হয়
 */

const DB_NAME = 'quickmeet-filetransfer';
const DB_VERSION = 1;

// IndexedDB stores
const STORE_TRANSFERS = 'transfers';     // ট্রান্সফার metadata
const STORE_CHUNKS = 'chunks';           // ফাইল chunks

export class ChunkStore {
    constructor() {
        this.db = null;
    }

    /**
     * IndexedDB ডাটাবেস ওপেন করে
     */
    async open() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // transfers store - ট্রান্সফার মেটাডেটা
                if (!db.objectStoreNames.contains(STORE_TRANSFERS)) {
                    const transferStore = db.createObjectStore(STORE_TRANSFERS, { keyPath: 'fileId' });
                    transferStore.createIndex('status', 'status', { unique: false });
                    transferStore.createIndex('peerId', 'peerId', { unique: false });
                }

                // chunks store - ফাইলের chunks
                if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
                    const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: ['fileId', 'index'] });
                    chunkStore.createIndex('fileId', 'fileId', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('📦 ChunkStore ওপেন হয়েছে');
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('❌ ChunkStore এরর:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * নতুন ট্রান্সফার তৈরি করে (sender বা receiver)
     */
    async createTransfer(transferInfo) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_TRANSFERS, 'readwrite');
            const store = tx.objectStore(STORE_TRANSFERS);
            store.put(transferInfo);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * ট্রান্সফার মেটাডেটা পায়
     */
    async getTransfer(fileId) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_TRANSFERS, 'readonly');
            const store = tx.objectStore(STORE_TRANSFERS);
            const request = store.get(fileId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * ট্রান্সফার আপডেট করে
     */
    async updateTransfer(fileId, updates) {
        await this.open();
        const existing = await this.getTransfer(fileId);
        if (!existing) return;
        
        const updated = { ...existing, ...updates };
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_TRANSFERS, 'readwrite');
            const store = tx.objectStore(STORE_TRANSFERS);
            store.put(updated);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * একটি chunk সেভ করে
     * 
     * @param {string} fileId - ফাইল আইডি
     * @param {number} index - chunk ইনডেক্স
     * @param {ArrayBuffer} data - chunk ডেটা
     */
    async saveChunk(fileId, index, data) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_CHUNKS, 'readwrite');
            const store = tx.objectStore(STORE_CHUNKS);
            store.put({ fileId, index, data });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * একটি chunk পড়ে
     */
    async getChunk(fileId, index) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_CHUNKS, 'readonly');
            const store = tx.objectStore(STORE_CHUNKS);
            const request = store.get([fileId, index]);
            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * কোন কোন chunk পাওয়া গেছে তার বিটম্যাপ পায়
     * Resume এর জন্য ব্যবহার হয়
     */
    async getReceivedChunkIndices(fileId) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_CHUNKS, 'readonly');
            const store = tx.objectStore(STORE_CHUNKS);
            const index = store.index('fileId');
            const request = index.getAllKeys(IDBKeyRange.only(fileId));
            request.onsuccess = () => {
                // key = [fileId, chunkIndex], তাই index[1] নেবো
                const indices = new Set(request.result.map(key => key[1]));
                resolve(indices);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * সব chunk মিলিয়ে পূর্ণ ফাইল Blob তৈরি করে
     * 
     * মেমরি-সেফ: একটি করে chunk পড়ে Blob এ যোগ করে
     */
    async assembleFile(fileId, totalChunks, mimeType) {
        await this.open();
        const parts = [];

        for (let i = 0; i < totalChunks; i++) {
            const data = await this.getChunk(fileId, i);
            if (!data) {
                throw new Error(`Chunk ${i} পাওয়া যায়নি!`);
            }
            parts.push(data);
        }

        return new Blob(parts, { type: mimeType || 'application/octet-stream' });
    }

    /**
     * ট্রান্সফারের সব ডেটা মুছে ফেলে
     */
    async deleteTransfer(fileId) {
        await this.open();

        // chunks মুছি
        const indices = await this.getReceivedChunkIndices(fileId);
        if (indices.size > 0) {
            await new Promise((resolve, reject) => {
                const tx = this.db.transaction(STORE_CHUNKS, 'readwrite');
                const store = tx.objectStore(STORE_CHUNKS);
                for (const idx of indices) {
                    store.delete([fileId, idx]);
                }
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        }

        // metadata মুছি
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_TRANSFERS, 'readwrite');
            const store = tx.objectStore(STORE_TRANSFERS);
            store.delete(fileId);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Resume এর জন্য: সব অসম্পূর্ণ ট্রান্সফার পায়
     */
    async getIncompleteTransfers() {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_TRANSFERS, 'readonly');
            const store = tx.objectStore(STORE_TRANSFERS);
            const index = store.index('status');
            const request = index.getAll('receiving');
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

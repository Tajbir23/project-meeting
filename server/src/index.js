/**
 * সিম্পল সার্ভার - Tunnel টেস্টিং এর জন্য
 * শুধু HTTP (HTTPS নেই) - Tunnel নিজেই HTTPS দেবে
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from './config/config.js';
import { setupSignaling } from './socket/signaling.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Express app
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST'], credentials: true }));
app.use(express.json());

// Static files
const clientPath = join(__dirname, '../../client');
app.use(express.static(clientPath));
console.log(`📁 Client path: ${clientPath}`);

// HTTP Server only (Serveo/tunnel will provide HTTPS)
const httpServer = createServer(app);

// Socket.IO
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 10000,
    pingTimeout: 5000
});

// Routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running!' });
});

app.get('/api/ice-servers', (req, res) => {
    res.json({ iceServers: config.iceServers });
});

app.get('/', (req, res) => {
    res.sendFile(join(clientPath, 'index.html'));
});

app.get('/meeting/:roomId', (req, res) => {
    res.sendFile(join(clientPath, 'meeting.html'));
});

app.get('/transfer', (req, res) => {
    res.sendFile(join(clientPath, 'transfer.html'));
});

app.get('/transfer/:roomId', (req, res) => {
    res.sendFile(join(clientPath, 'transfer.html'));
});

// Signaling
setupSignaling(io);

// Start server
const PORT = config.port || 3000;

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║   🎥 VIDEO MEETING SERVER                     ║');
    console.log('╠═══════════════════════════════════════════════╣');
    console.log(`║   Local: http://localhost:${PORT}                 ║`);
    console.log('║                                               ║');
    console.log('║   📱 Mobile টেস্ট করতে serveo tunnel চালান:   ║');
    console.log('║   ssh -R 80:localhost:3000 serveo.net         ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    io.close();
    httpServer.close(() => {
        console.log('👋 Goodbye!');
        process.exit(0);
    });
});

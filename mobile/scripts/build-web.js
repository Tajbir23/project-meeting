/**
 * Web Build Script
 * Client ফোল্ডার থেকে www ফোল্ডারে কপি করে
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../../client');
const destDir = path.join(__dirname, '../www');

function copyRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

console.log('📁 Client ফাইল www তে কপি করা হচ্ছে...');
copyRecursive(srcDir, destDir);
console.log('✅ কপি সম্পন্ন!');

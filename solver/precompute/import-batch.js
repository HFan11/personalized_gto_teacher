#!/usr/bin/env node
// Split precomputed_flops.json (downloaded from browser batch solver)
// into individual board files in web/data/precomputed/flop/
// Usage: node solver/precompute/import-batch.js precomputed_flops.json

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
if (!inputFile) {
    console.log('Usage: node solver/precompute/import-batch.js <precomputed_flops.json>');
    process.exit(1);
}

const outputDir = path.join(__dirname, '../../web/data/precomputed/flop');
fs.mkdirSync(outputDir, { recursive: true });

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
let count = 0;

for (const [filename, boardData] of Object.entries(data)) {
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(boardData));
    count++;
}

console.log(`✅ Imported ${count} boards into ${outputDir}`);

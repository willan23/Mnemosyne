'use strict';
const {deflateSync} = require('node:zlib');
function crc32(bytes) {let crc = 0xffffffff; for (const byte of bytes) {crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);} return (crc ^ 0xffffffff) >>> 0;}
function chunk(type, data) {const name = Buffer.from(type), output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); name.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return output;}
function png(width = 1024, height = 1024) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width * 4)))), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = {png};

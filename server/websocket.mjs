import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

export class RealtimePeer {
  #buffer = Buffer.alloc(0);
  #closed = false;

  constructor(socket, userId) {
    this.socket = socket;
    this.userId = userId;
    this.onClose = null;
    this.onMessage = null;
    socket.on('data', chunk => this.#consume(chunk));
    socket.on('close', () => this.#finish());
    socket.on('error', () => this.#finish());
  }

  send(payload) {
    if (this.#closed || this.socket.destroyed) return;
    this.socket.write(frame(0x1, JSON.stringify(payload)));
  }

  close() {
    if (this.#closed) return;
    try { this.socket.write(frame(0x8)); } catch { /* best effort */ }
    this.socket.end();
    this.#finish();
  }

  #finish() {
    if (this.#closed) return;
    this.#closed = true;
    this.onClose?.();
  }

  #consume(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 2) {
      const first = this.#buffer[0];
      const second = this.#buffer[1];
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.#buffer.length < 4) return;
        length = this.#buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.#buffer.length < 10) return;
        const long = this.#buffer.readBigUInt64BE(2);
        if (long > BigInt(Number.MAX_SAFE_INTEGER)) return this.close();
        length = Number(long);
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (this.#buffer.length < offset + maskBytes + length) return;
      let payload = this.#buffer.subarray(offset + maskBytes, offset + maskBytes + length);
      if (masked) {
        const mask = this.#buffer.subarray(offset, offset + 4);
        const decoded = Buffer.alloc(payload.length);
        for (let index = 0; index < payload.length; index++) decoded[index] = payload[index] ^ mask[index % 4];
        payload = decoded;
      }
      this.#buffer = this.#buffer.subarray(offset + maskBytes + length);

      if (opcode === 0x8) return this.close();
      if (opcode === 0x9) {
        if (!this.#closed) this.socket.write(frame(0xA, payload));
        continue;
      }
      if (opcode !== 0x1) continue;
      try { this.onMessage?.(JSON.parse(payload.toString('utf8'))); } catch { /* malformed client payload */ }
    }
  }
}

export function acceptWebSocket(req, socket, userId) {
  const key = String(req.headers['sec-websocket-key'] || '');
  const version = String(req.headers['sec-websocket-version'] || '');
  if (!key || version !== '13') return null;
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'));
  return new RealtimePeer(socket, userId);
}

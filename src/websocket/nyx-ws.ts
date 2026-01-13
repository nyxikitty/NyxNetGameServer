import * as net from 'net';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

enum OpCode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xa
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface Frame {
  opcode: OpCode;
  payload: Buffer;
}

interface ServerOptions {
  port?: number;
  host?: string;
  pingInterval?: number;
  maxPayload?: number;
  backlog?: number;
}

interface ClientOptions {
  protocols?: string[];
  headers?: Record<string, string>;
  timeout?: number;
  maxPayload?: number;
}

export enum SocketMode {
  TCP = 'tcp',
  WEBSOCKET = 'websocket'
}

export abstract class Socket extends EventEmitter {
  public abstract send(data: string | Buffer): void;
  public abstract sendRaw(data: Buffer): void;
  public abstract close(code?: number, reason?: string): void;
  public abstract getMode(): SocketMode;
}

export class NetSocket extends Socket {
  protected mode: SocketMode = SocketMode.TCP;
  
  constructor(public socket: net.Socket) {
    super();
  }

  public getMode(): SocketMode {
    return this.mode;
  }

  public setMode(mode: SocketMode): void {
    this.mode = mode;
  }

  public send(data: string | Buffer): void {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.socket.write(buffer);
  }

  public sendRaw(data: Buffer): void {
    this.socket.write(data);
  }

  public close(): void {
    this.socket.end();
  }

  public write(data: Buffer): void {
    this.socket.write(data);
  }

  public end(): void {
    this.socket.end();
  }

  public destroy(): void {
    this.socket.destroy();
  }

  public setNoDelay(noDelay: boolean): void {
    this.socket.setNoDelay(noDelay);
  }

  public setKeepAlive(enable: boolean, initialDelay: number): void {
    this.socket.setKeepAlive(enable, initialDelay);
  }

  public connect(port: number, host: string, callback?: () => void): void {
    this.socket.connect(port, host, callback);
  }

  public on(event: string, listener: (...args: any[]) => void): this {
    this.socket.on(event, listener);
    return this;
  }

  public removeListener(event: string, listener: (...args: any[]) => void): this {
    this.socket.removeListener(event, listener);
    return this;
  }
}

class SocketContainer extends NetSocket {
  protected buffer: Buffer;
  protected fragments: Frame[];

  constructor(socket: net.Socket, mode: SocketMode = SocketMode.TCP) {
    super(socket);
    this.mode = mode;
    this.buffer = Buffer.allocUnsafe(0);
    this.fragments = [];
    
    this.setupSocketListeners();
  }

  protected setupSocketListeners(): void {
    this.socket.on('data', (data: Buffer) => this.handleData(data));
    this.socket.on('close', () => this.emit('close'));
    this.socket.on('error', (err: Error) => this.emit('error', err));
  }

  protected handleData(data: Buffer): void {
    if (this.mode === SocketMode.TCP) {
      this.emit('message', data);
      return;
    }

    this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 2) {
      const byte1 = this.buffer[0];
      const byte2 = this.buffer[1];

      const fin = (byte1 & 0x80) === 0x80;
      const opcode = byte1 & 0x0f;
      const masked = (byte2 & 0x80) === 0x80;
      let payloadLength = byte2 & 0x7f;

      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        payloadLength = high * 0x100000000 + low;
        offset = 10;
      }

      const maskingKey = masked ? this.buffer.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;

      if (this.buffer.length < offset + payloadLength) return;

      let payload = this.buffer.subarray(offset, offset + payloadLength);

      if (masked && maskingKey) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskingKey[i % 4];
        }
      }

      this.buffer = this.buffer.subarray(offset + payloadLength);

      this.handleFrame(fin, opcode, payload);
    }
  }

  protected handleFrame(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case OpCode.TEXT:
      case OpCode.BINARY:
        if (!fin) {
          this.fragments.push({ opcode, payload });
        } else if (this.fragments.length > 0) {
          this.fragments.push({ opcode, payload });
          const fullPayload = Buffer.concat(this.fragments.map(f => f.payload));
          this.fragments = [];
          this.emitMessage(opcode, fullPayload);
        } else {
          this.emitMessage(opcode, payload);
        }
        break;

      case OpCode.CONTINUATION:
        this.fragments.push({ opcode, payload });
        if (fin) {
          const fullPayload = Buffer.concat(this.fragments.map(f => f.payload));
          const originalOpcode = this.fragments[0].opcode;
          this.fragments = [];
          this.emitMessage(originalOpcode, fullPayload);
        }
        break;

      case OpCode.CLOSE:
        this.handleCloseFrame(payload);
        break;

      case OpCode.PING:
        this.handlePing(payload);
        break;

      case OpCode.PONG:
        this.handlePong();
        break;
    }
  }

  protected emitMessage(opcode: number, payload: Buffer): void {
    if (opcode === OpCode.TEXT) {
      this.emit('message', payload.toString('utf8'));
    } else {
      this.emit('message', payload);
    }
  }

  protected handleCloseFrame(payload: Buffer): void {
    let code = 1005;
    let reason = '';
    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
      reason = payload.subarray(2).toString('utf8');
    }
    this.close(code, reason);
  }

  protected handlePing(payload: Buffer): void {
    this.sendFrame(OpCode.PONG, payload);
    this.emit('ping');
  }

  protected handlePong(): void {
    this.emit('pong');
  }

  protected sendFrame(opcode: OpCode, data: Buffer | string, masked: boolean = false): void {
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const payloadLength = payload.length;
    let frame: Buffer;
    let offset: number;

    if (payloadLength < 126) {
      frame = Buffer.allocUnsafe(2 + (masked ? 4 : 0) + payloadLength);
      frame[0] = 0x80 | opcode;
      frame[1] = (masked ? 0x80 : 0) | payloadLength;
      offset = 2;
    } else if (payloadLength < 65536) {
      frame = Buffer.allocUnsafe(4 + (masked ? 4 : 0) + payloadLength);
      frame[0] = 0x80 | opcode;
      frame[1] = (masked ? 0x80 : 0) | 126;
      frame.writeUInt16BE(payloadLength, 2);
      offset = 4;
    } else {
      frame = Buffer.allocUnsafe(10 + (masked ? 4 : 0) + payloadLength);
      frame[0] = 0x80 | opcode;
      frame[1] = (masked ? 0x80 : 0) | 127;
      frame.writeUInt32BE(0, 2);
      frame.writeUInt32BE(payloadLength, 6);
      offset = 10;
    }

    if (masked) {
      const maskingKey = crypto.randomBytes(4);
      maskingKey.copy(frame, offset);
      offset += 4;

      for (let i = 0; i < payloadLength; i++) {
        frame[offset + i] = payload[i] ^ maskingKey[i % 4];
      }
    } else {
      payload.copy(frame, offset);
    }

    this.write(frame);
  }

  public override send(data: string | Buffer): void {
    if (this.mode === SocketMode.TCP) {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      this.sendRaw(buffer);
    } else {
      const opcode = typeof data === 'string' ? OpCode.TEXT : OpCode.BINARY;
      this.sendFrame(opcode, data);
    }
  }

  public ping(): void {
    if (this.mode === SocketMode.WEBSOCKET) {
      this.sendFrame(OpCode.PING, Buffer.allocUnsafe(0));
    }
  }

  public override close(code: number = 1000, reason: string = ''): void {
    if (this.mode === SocketMode.WEBSOCKET) {
      const buf = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
      buf.writeUInt16BE(code, 0);
      if (reason) buf.write(reason, 2);
      this.sendFrame(OpCode.CLOSE, buf);
    }
    this.end();
  }
}

export interface NyxWSClient {
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: string | Buffer) => void): this;
  on(event: 'close', listener: (code?: number, reason?: string) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'ping', listener: () => void): this;
  on(event: 'pong', listener: () => void): this;
}

export class NyxWSClient extends SocketContainer {
  private url: URL;
  private options: ClientOptions;
  private readyState: number = 0;

  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  constructor(url: string, options: ClientOptions = {}) {
    super(new net.Socket(), SocketMode.WEBSOCKET);
    this.url = new URL(url);
    this.options = options;
    
    this.initializeConnection();
  }

  protected setupSocketListeners(): void {
    this.socket.on('error', (err: Error) => {
      this.readyState = NyxWSClient.CLOSED;
      this.emit('error', err);
    });

    this.socket.on('close', () => {
      if (this.readyState !== NyxWSClient.CLOSED) {
        this.readyState = NyxWSClient.CLOSED;
        this.emit('close', 1006, 'Connection closed');
      }
    });

    this.socket.on('data', (data: Buffer) => this.handleData(data));
  }

  private initializeConnection(): void {
    const port = parseInt(this.url.port) || (this.url.protocol === 'wss:' ? 443 : 80);
    const host = this.url.hostname;

    this.setNoDelay(true);
    this.setKeepAlive(true, 60000);

    this.connect(port, host, () => {
      this.performHandshake();
    });
  }

  private performHandshake(): void {
    const key = crypto.randomBytes(16).toString('base64');
    const path = this.url.pathname + this.url.search;

    let request = `GET ${path} HTTP/1.1\r\n`;
    request += `Host: ${this.url.host}\r\n`;
    request += `Upgrade: websocket\r\n`;
    request += `Connection: Upgrade\r\n`;
    request += `Sec-WebSocket-Key: ${key}\r\n`;
    request += `Sec-WebSocket-Version: 13\r\n`;

    if (this.options.protocols && this.options.protocols.length > 0) {
      request += `Sec-WebSocket-Protocol: ${this.options.protocols.join(', ')}\r\n`;
    }

    if (this.options.headers) {
      for (const [name, value] of Object.entries(this.options.headers)) {
        request += `${name}: ${value}\r\n`;
      }
    }

    request += `\r\n`;

    this.write(Buffer.from(request));

    const expectedAccept = crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    let responseBuffer = '';

    const onHandshakeData = (data: Buffer) => {
      responseBuffer += data.toString('binary');

      const headerEnd = responseBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headers = responseBuffer.substring(0, headerEnd);
      const lines = headers.split('\r\n');

      if (!lines[0].includes('101')) {
        this.destroy();
        this.emit('error', new Error('Handshake failed: ' + lines[0]));
        return;
      }

      const headerMap: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const colonIndex = lines[i].indexOf(':');
        if (colonIndex > 0) {
          const key = lines[i].substring(0, colonIndex).toLowerCase().trim();
          const value = lines[i].substring(colonIndex + 1).trim();
          headerMap[key] = value;
        }
      }

      if (headerMap['sec-websocket-accept'] !== expectedAccept) {
        this.destroy();
        this.emit('error', new Error('Invalid Sec-WebSocket-Accept'));
        return;
      }

      this.readyState = NyxWSClient.OPEN;
      this.socket.removeListener('data', onHandshakeData);

      const remaining = responseBuffer.substring(headerEnd + 4);
      if (remaining.length > 0) {
        this.handleData(Buffer.from(remaining, 'binary'));
      }

      this.emit('open');
    };

    this.socket.on('data', onHandshakeData);
  }

  protected handleCloseFrame(payload: Buffer): void {
    let code = 1005;
    let reason = '';
    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
      reason = payload.subarray(2).toString('utf8');
    }
    this.readyState = NyxWSClient.CLOSING;
    this.end();
    this.emit('close', code, reason);
  }

  protected handlePing(payload: Buffer): void {
    this.sendFrame(OpCode.PONG, payload, true);
    this.emit('ping');
  }

  protected sendFrame(opcode: OpCode, data: Buffer | string, masked: boolean = true): void {
    if (this.readyState !== NyxWSClient.OPEN) {
      throw new Error('WebSocket is not open');
    }
    super.sendFrame(opcode, data, masked);
  }

  public switchToTCP(): void {
    this.setMode(SocketMode.TCP);
  }

  public switchToWebSocket(): void {
    this.setMode(SocketMode.WEBSOCKET);
  }

  public get state(): number {
    return this.readyState;
  }
}

export interface NyxWSConnection {
  on(event: 'message', listener: (data: string | Buffer) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export class NyxWSConnection extends SocketContainer {
  public isAlive: boolean;

  constructor(socket: net.Socket, mode: SocketMode = SocketMode.WEBSOCKET) {
    super(socket, mode);
    this.isAlive = true;
  }

  protected handlePong(): void {
    this.isAlive = true;
    super.handlePong();
  }

  protected handleCloseFrame(): void {
    this.close(1000);
  }

  public switchToTCP(): void {
    this.setMode(SocketMode.TCP);
  }

  public switchToWebSocket(): void {
    this.setMode(SocketMode.WEBSOCKET);
  }
}

export interface NyxWSServer {
  on(event: 'connection', listener: (ws: NyxWSConnection) => void): this;
  on(event: 'listening', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export class NyxWSServer extends EventEmitter {
  private server: net.Server | null = null;
  private clients: Set<NyxWSConnection>;
  private options: Required<ServerOptions>;
  private pingTimer?: NodeJS.Timeout;

  constructor(options: ServerOptions = {}) {
    super();
    this.clients = new Set();
    this.options = {
      port: options.port || 8080,
      host: options.host || '0.0.0.0',
      pingInterval: options.pingInterval || 30000,
      maxPayload: options.maxPayload || 100 * 1024 * 1024,
      backlog: options.backlog || 511
    };
  }

  public listen(port?: number, callback?: () => void): this {
    if (port) this.options.port = port;

    this.server = net.createServer((socket: net.Socket) => {
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 60000);

      let buffer = '';
      let isUpgraded = false;

      const onData = (data: Buffer) => {
        if (!isUpgraded) {
          buffer += data.toString('binary');

          const headerEnd = buffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) return;

          const headers = buffer.substring(0, headerEnd);
          const lines = headers.split('\r\n');
          const requestLine = lines[0];

          if (!requestLine.includes('HTTP/1.1')) {
            socket.end();
            return;
          }

          const headerMap: Record<string, string> = {};
          for (let i = 1; i < lines.length; i++) {
            const colonIndex = lines[i].indexOf(':');
            if (colonIndex > 0) {
              const key = lines[i].substring(0, colonIndex).toLowerCase().trim();
              const value = lines[i].substring(colonIndex + 1).trim();
              headerMap[key] = value;
            }
          }

          if (
            headerMap['upgrade']?.toLowerCase() !== 'websocket' ||
            !headerMap['connection']?.toLowerCase().includes('upgrade') ||
            headerMap['sec-websocket-version'] !== '13'
          ) {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
            return;
          }

          const key = headerMap['sec-websocket-key'];
          if (!key) {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
            return;
          }

          const acceptKey = crypto
            .createHash('sha1')
            .update(key + GUID)
            .digest('base64');

          const response = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptKey}`,
            '\r\n'
          ].join('\r\n');

          socket.write(response);
          isUpgraded = true;

          const ws = new NyxWSConnection(socket, SocketMode.WEBSOCKET);
          this.clients.add(ws);

          ws.on('close', () => {
            this.clients.delete(ws);
          });

          this.emit('connection', ws);

          const remaining = buffer.substring(headerEnd + 4);
          if (remaining.length > 0) {
            ws['handleData'](Buffer.from(remaining, 'binary'));
          }

          socket.removeListener('data', onData);
        }
      };

      socket.on('data', onData);
      socket.on('error', () => {});
    });

    this.server.listen(this.options.port, this.options.host, this.options.backlog, () => {
      if (callback) callback();
      this.emit('listening');

      if (this.options.pingInterval > 0) {
        this.pingTimer = setInterval(() => {
          for (const client of this.clients) {
            if (!client.isAlive) {
              client.destroy();
              this.clients.delete(client);
            } else {
              client.isAlive = false;
              client.ping();
            }
          }
        }, this.options.pingInterval);
      }
    });

    return this;
  }

  public broadcast(data: string | Buffer): void {
    for (const client of this.clients) {
      try {
        client.send(data);
      } catch (err) {}
    }
  }

  public close(callback?: () => void): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }

    for (const client of this.clients) {
      client.close();
    }

    if (this.server) {
      this.server.close(callback);
    }
  }

  public get clientCount(): number {
    return this.clients.size;
  }
}
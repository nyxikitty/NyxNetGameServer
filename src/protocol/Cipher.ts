export class Cipher {
  private key: number;

  constructor(key: number = 0x5e) {
    this.key = key;
  }

  encrypt(buffer: Buffer): Buffer {
    const result = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      result[i] = buffer[i] ^ this.key ^ (i & 0xff);
    }
    return result;
  }

  decrypt(buffer: Buffer): Buffer {
    return this.encrypt(buffer);
  }
}

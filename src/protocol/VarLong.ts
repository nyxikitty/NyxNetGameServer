export interface VarLongResult {
  value: number;
  bytesRead: number;
}

export class VarLong {
  static encode(value: number | bigint): Buffer {
    let bigValue = BigInt(value);
    const bytes: number[] = [];
    
    while (bigValue > 0x7fn) {
      bytes.push(Number(bigValue & 0x7fn) | 0x80);
      bigValue >>= 7n;
    }
    bytes.push(Number(bigValue & 0x7fn));
    
    return Buffer.from(bytes);
  }

  static decode(buffer: Buffer, offset: number): VarLongResult {
    let value = 0n;
    let shift = 0n;
    let byte: number;
    let bytesRead = 0;

    do {
      if (offset + bytesRead >= buffer.length) {
        throw new Error('Buffer underflow');
      }
      
      byte = buffer[offset + bytesRead];
      value |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
      bytesRead++;
    } while (byte & 0x80);

    return { value: Number(value), bytesRead };
  }
}

export interface VarIntResult {
  value: number;
  bytesRead: number;
}

export class VarInt {
  static encode(value: number): Buffer {
    const bytes: number[] = [];
    
    if (value < 0) {
      value = value >>> 0;
    }
    
    while (value > 0x7f) {
      bytes.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    bytes.push(value & 0x7f);
    
    return Buffer.from(bytes);
  }

  static decode(buffer: Buffer, offset: number): VarIntResult {
    let value = 0;
    let shift = 0;
    let byte: number;
    let bytesRead = 0;

    do {
      if (offset + bytesRead >= buffer.length) {
        throw new Error('Buffer underflow');
      }
      
      byte = buffer[offset + bytesRead];
      value |= (byte & 0x7f) << shift;
      shift += 7;
      bytesRead++;
    } while (byte & 0x80);

    return { value, bytesRead };
  }
}

import { VarInt } from './VarInt';
import { VarLong } from './VarLong';
import { TYPE, ProtocolValue, Vec2, Vec3 } from './types';

export class ProtocolReader {
  private buffer: Buffer;
  private offset: number = 0;

  constructor(buffer: Buffer) {
    this.buffer = Buffer.from(buffer);
  }

  hasBytes(count: number): boolean {
    return this.offset + count <= this.buffer.length;
  }

  read(length: number): Buffer {
    if (!this.hasBytes(length)) {
      throw new Error('Buffer underflow');
    }
    const data = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return data;
  }

  readByte(): number {
    if (!this.hasBytes(1)) {
      throw new Error('Buffer underflow');
    }
    return this.buffer[this.offset++];
  }

  readBool(): boolean {
    return this.readByte() !== 0;
  }

  readVarInt(): number {
    const result = VarInt.decode(this.buffer, this.offset);
    this.offset += result.bytesRead;
    return result.value;
  }

  readVarLong(): number {
    const result = VarLong.decode(this.buffer, this.offset);
    this.offset += result.bytesRead;
    return result.value;
  }

  readShort(): number {
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  readInt(): number {
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readFloat(): number {
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }

  readDouble(): number {
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  readString(): string {
    const length = this.readVarInt();
    if (length === 0) return '';
    const str = this.buffer.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return str;
  }

  readBytes(): Buffer {
    const length = this.readVarInt();
    if (length === 0) return Buffer.alloc(0);
    return this.read(length);
  }

  readValue(): ProtocolValue {
    const type = this.readByte();

    switch (type) {
      case TYPE.NULL:
        return null;
      case TYPE.BOOL:
        return this.readBool();
      case TYPE.BYTE:
        return this.readByte();
      case TYPE.SHORT:
        return this.readShort();
      case TYPE.INT:
        return this.readInt();
      case TYPE.LONG:
        return this.readVarLong();
      case TYPE.FLOAT:
        return this.readFloat();
      case TYPE.DOUBLE:
        return this.readDouble();
      case TYPE.STRING:
        return this.readString();
      case TYPE.BYTES:
        return this.readBytes();
      case TYPE.ARRAY:
        return this.readArray();
      case TYPE.MAP:
        return this.readMap();
      case TYPE.VEC2:
        return { x: this.readFloat(), y: this.readFloat() } as Vec2;
      case TYPE.VEC3:
        return {
          x: this.readFloat(),
          y: this.readFloat(),
          z: this.readFloat(),
        } as Vec3;
      default:
        throw new Error(`Unknown type: ${type}`);
    }
  }

  readArray(): ProtocolValue[] {
    const length = this.readVarInt();
    const arr: ProtocolValue[] = new Array(length);
    for (let i = 0; i < length; i++) {
      arr[i] = this.readValue();
    }
    return arr;
  }

  readMap(): Record<string, ProtocolValue> {
    const length = this.readVarInt();
    const map: Record<string, ProtocolValue> = {};
    for (let i = 0; i < length; i++) {
      const key = this.readString();
      const value = this.readValue();
      map[key] = value;
    }
    return map;
  }
}

import { VarInt } from './VarInt';
import { VarLong } from './VarLong';
import { TYPE, ProtocolValue } from './types';

export class ProtocolWriter {
  private buffers: Buffer[] = [];
  private length: number = 0;

  write(buffer: Buffer): void {
    this.buffers.push(buffer);
    this.length += buffer.length;
  }

  writeByte(value: number): void {
    this.write(Buffer.from([value & 0xff]));
  }

  writeBool(value: boolean): void {
    this.writeByte(value ? 1 : 0);
  }

  writeVarInt(value: number): void {
    this.write(VarInt.encode(value));
  }

  writeVarLong(value: number | bigint): void {
    this.write(VarLong.encode(value));
  }

  writeShort(value: number): void {
    const buf = Buffer.allocUnsafe(2);
    buf.writeInt16BE(value, 0);
    this.write(buf);
  }

  writeInt(value: number): void {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32BE(value, 0);
    this.write(buf);
  }

  writeFloat(value: number): void {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(value, 0);
    this.write(buf);
  }

  writeDouble(value: number): void {
    const buf = Buffer.allocUnsafe(8);
    buf.writeDoubleBE(value, 0);
    this.write(buf);
  }

  writeString(str: string | null | undefined): void {
    if (!str) {
      this.writeVarInt(0);
      return;
    }
    const buf = Buffer.from(str, 'utf8');
    this.writeVarInt(buf.length);
    this.write(buf);
  }

  writeBytes(bytes: Buffer | null | undefined): void {
    if (!bytes) {
      this.writeVarInt(0);
      return;
    }
    this.writeVarInt(bytes.length);
    this.write(Buffer.from(bytes));
  }

  writeValue(value: ProtocolValue): void {
    if (value === null || value === undefined) {
      this.writeByte(TYPE.NULL);
      return;
    }

    const type = typeof value;

    if (type === 'boolean') {
      this.writeByte(TYPE.BOOL);
      this.writeBool(value as boolean);
    } else if (type === 'number') {
      const num = value as number;
      if (Number.isInteger(num)) {
        if (num > 2147483647 || num < -2147483648) {
          this.writeByte(TYPE.LONG);
          this.writeVarLong(num);
        } else if (num >= -128 && num <= 127) {
          this.writeByte(TYPE.BYTE);
          this.writeByte(num);
        } else if (num >= -32768 && num <= 32767) {
          this.writeByte(TYPE.SHORT);
          this.writeShort(num);
        } else {
          this.writeByte(TYPE.INT);
          this.writeInt(num);
        }
      } else {
        this.writeByte(TYPE.FLOAT);
        this.writeFloat(num);
      }
    } else if (type === 'string') {
      this.writeByte(TYPE.STRING);
      this.writeString(value as string);
    } else if (Buffer.isBuffer(value)) {
      this.writeByte(TYPE.BYTES);
      this.writeBytes(value);
    } else if (Array.isArray(value)) {
      this.writeByte(TYPE.ARRAY);
      this.writeVarInt(value.length);
      for (const item of value) {
        this.writeValue(item);
      }
    } else if (type === 'object') {
      const obj = value as any;
      if (obj.x !== undefined && obj.y !== undefined && obj.z !== undefined) {
        this.writeByte(TYPE.VEC3);
        this.writeFloat(obj.x);
        this.writeFloat(obj.y);
        this.writeFloat(obj.z);
      } else if (obj.x !== undefined && obj.y !== undefined) {
        this.writeByte(TYPE.VEC2);
        this.writeFloat(obj.x);
        this.writeFloat(obj.y);
      } else {
        this.writeByte(TYPE.MAP);
        const keys = Object.keys(obj);
        this.writeVarInt(keys.length);
        for (const key of keys) {
          this.writeString(key);
          this.writeValue(obj[key]);
        }
      }
    }
  }

  writeMap(map: Record<string, ProtocolValue>): void {
    this.writeVarInt(Object.keys(map).length);
    for (const [key, value] of Object.entries(map)) {
      this.writeString(key);
      this.writeValue(value);
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.buffers, this.length);
  }

  reset(): void {
    this.buffers = [];
    this.length = 0;
  }
}
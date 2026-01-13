import { ProtocolWriter } from './ProtocolWriter';
import { ProtocolReader } from './ProtocolReader';
import { Checksum } from './Checksum';
import { Cipher } from './Cipher';
import { OPCODE, PacketData, ParsedPacket } from './types';

export class Packet {
  static create(
    opcode: OPCODE,
    data: PacketData = {},
    encrypt: boolean = false
  ): Buffer {
    const writer = new ProtocolWriter();
    
    // Magic bytes
    writer.writeByte(0x42);
    writer.writeByte(0x4e);
    
    // Version
    writer.writeByte(0x01);
    
    // Flags
    const flags = encrypt ? 0x01 : 0x00;
    writer.writeByte(flags);
    
    // Opcode
    writer.writeByte(opcode);
    
    // Payload
    const payloadWriter = new ProtocolWriter();
    payloadWriter.writeMap(data);
    let payload = payloadWriter.toBuffer();
    
    if (encrypt) {
      const cipher = new Cipher();
      payload = cipher.encrypt(payload);
    }
    
    writer.writeVarInt(payload.length);
    writer.write(payload);
    
    // Checksum
    const packetData = writer.toBuffer();
    const checksum = Checksum.calculate(packetData);
    writer.writeByte(checksum);
    
    return writer.toBuffer();
  }

  static parse(buffer: Buffer): ParsedPacket {
    const reader = new ProtocolReader(buffer);
    
    // Magic bytes
    const magic1 = reader.readByte();
    const magic2 = reader.readByte();
    if (magic1 !== 0x42 || magic2 !== 0x4e) {
      throw new Error('Invalid packet magic');
    }
    
    // Version
    const version = reader.readByte();
    if (version !== 0x01) {
      throw new Error(`Unsupported version: ${version}`);
    }
    
    // Flags
    const flags = reader.readByte();
    const isEncrypted = (flags & 0x01) !== 0;
    
    // Opcode
    const opcode = reader.readByte() as OPCODE;
    
    // Payload
    const payloadLength = reader.readVarInt();
    let payload = reader.read(payloadLength);
    
    if (isEncrypted) {
      const cipher = new Cipher();
      payload = cipher.decrypt(payload);
    }
    
    // Checksum
    const checksum = reader.readByte();
    const dataToVerify = buffer.slice(0, buffer.length - 1);
    if (!Checksum.verify(dataToVerify, checksum)) {
      throw new Error('Checksum mismatch');
    }
    
    // Parse payload
    const payloadReader = new ProtocolReader(payload);
    const data = payloadReader.readMap() as PacketData;
    
    return { opcode, data, isEncrypted };
  }
}

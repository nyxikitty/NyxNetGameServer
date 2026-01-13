import { OPCODE, PacketData } from '../protocol';

export interface VoiceUser {
  id: number;
  username: string;
  voiceChannel: VoiceChannel | null;
  muted: boolean;
  send: (opcode: OPCODE, data: PacketData) => void;
}

export class VoiceChannel {
  readonly name: string;
  readonly users: Map<number, VoiceUser>;

  constructor(name: string) {
    this.name = name;
    this.users = new Map();
  }

  addUser(user: VoiceUser): void {
    this.users.set(user.id, user);
    user.voiceChannel = this;
  }

  removeUser(user: VoiceUser): void {
    this.users.delete(user.id);
    user.voiceChannel = null;
  }

  broadcast(opcode: OPCODE, data: PacketData, excludeId?: number): void {
    for (const user of this.users.values()) {
      if (user.id !== excludeId) {
        user.send(opcode, data);
      }
    }
  }

  getUserCount(): number {
    return this.users.size;
  }

  toJSON(): any {
    return {
      name: this.name,
      userCount: this.users.size,
      users: Array.from(this.users.values()).map((u) => ({
        id: u.id,
        username: u.username,
        muted: u.muted,
      })),
    };
  }
}

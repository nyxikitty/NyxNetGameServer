import { OPCODE, PacketData } from '../protocol';

export interface ChatUser {
  id: number;
  username: string;
  chatRooms: Set<string>;
  send: (opcode: OPCODE, data: PacketData) => void;
}

export interface ChatMessage {
  userId: number;
  username: string;
  message: string;
  timestamp: number;
}

export class ChatRoom {
  readonly name: string;
  readonly users: Map<number, ChatUser>;
  readonly messageHistory: ChatMessage[];
  private readonly maxHistory: number;

  constructor(name: string, maxHistory: number = 100) {
    this.name = name;
    this.users = new Map();
    this.messageHistory = [];
    this.maxHistory = maxHistory;
  }

  addUser(user: ChatUser): void {
    this.users.set(user.id, user);
    user.chatRooms.add(this.name);
  }

  removeUser(user: ChatUser): void {
    this.users.delete(user.id);
    user.chatRooms.delete(this.name);
  }

  broadcast(opcode: OPCODE, data: PacketData, excludeId?: number): void {
    for (const user of this.users.values()) {
      if (user.id !== excludeId) {
        user.send(opcode, data);
      }
    }
  }

  addMessage(message: ChatMessage): void {
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }
  }

  getUserCount(): number {
    return this.users.size;
  }

  toJSON(): any {
    return {
      name: this.name,
      userCount: this.users.size,
    };
  }
}

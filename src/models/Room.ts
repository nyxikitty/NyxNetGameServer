import { Player } from './Player';
import { OPCODE, PacketData } from '../protocol';

export class Room {
  readonly name: string;
  readonly maxPlayers: number;
  readonly players: Map<number, Player>;
  readonly entities: Map<number, any>;

  constructor(name: string, maxPlayers: number = 10) {
    this.name = name;
    this.maxPlayers = maxPlayers;
    this.players = new Map();
    this.entities = new Map();
  }

  addPlayer(player: Player): boolean {
    if (this.players.size >= this.maxPlayers) {
      return false;
    }
    this.players.set(player.id, player);
    player.room = this;
    return true;
  }

  removePlayer(player: Player): void {
    this.players.delete(player.id);
    player.room = null;
  }

  broadcast(
    opcode: OPCODE,
    data: PacketData,
    sendFunc: (player: Player, opcode: OPCODE, data: PacketData) => void,
    excludeId?: number
  ): void {
    for (const player of this.players.values()) {
      if (player.id !== excludeId) {
        sendFunc(player, opcode, data);
      }
    }
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  toJSON(): any {
    return {
      name: this.name,
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
    };
  }
}
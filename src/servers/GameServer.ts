import { Server, Socket, createServer, connect } from 'net';
import { Packet, OPCODE, SERVER_TYPE, PacketData } from '../protocol';
import { Player, Room } from '../models';

export class GameServer {
  private readonly port: number;
  private readonly nameServerHost: string;
  private readonly nameServerPort: number;
  private server: Server | null = null;
  private nameServerConnection: Socket | null = null;
  private players: Map<number, Player> = new Map();
  private rooms: Map<string, Room> = new Map();
  private nextPlayerId: number = 1;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    port: number,
    nameServerHost: string = 'localhost',
    nameServerPort: number = 8888
  ) {
    this.port = port;
    this.nameServerHost = nameServerHost;
    this.nameServerPort = nameServerPort;
    this.rooms.set('lobby', new Room('lobby', 50));
  }

  async start(): Promise<void> {
    await this.connectToNameServer();

    this.server = createServer((socket) => this.handleConnection(socket));

    this.server.listen(this.port, () => {
      console.log(`[GameServer:${this.port}] Listening on port ${this.port}`);
      console.log(`[GameServer:${this.port}] Role: Game Logic & Rooms`);
      this.registerWithNameServer();
    });

    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 5000);
  }

  private connectToNameServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.nameServerConnection = connect({
        host: this.nameServerHost,
        port: this.nameServerPort,
      }, () => {
        console.log(`[GameServer:${this.port}] Connected to Name Server`);
        resolve();
      });

      this.nameServerConnection.on('error', (err) => {
        console.error(`[GameServer:${this.port}] Name Server error:`, err.message);
        reject(err);
      });
    });
  }

  private registerWithNameServer(): void {
    if (!this.nameServerConnection) return;
    
    const packet = Packet.create(OPCODE.REGISTER_SERVER, {
      type: SERVER_TYPE.GAME,
      host: 'localhost',
      port: this.port,
      capacity: 100,
      metadata: {
        version: '1.0.0',
        rooms: this.rooms.size,
      },
    });
    this.nameServerConnection.write(packet);
  }

  private sendHeartbeat(): void {
    if (this.nameServerConnection) {
      const packet = Packet.create(OPCODE.PING, {
        load: this.players.size,
      });
      this.nameServerConnection.write(packet);
    }
  }

  private handleConnection(socket: Socket): void {
    const playerId = this.nextPlayerId++;
    const player = new Player(playerId, socket);

    this.players.set(playerId, player);

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.length >= 6) {
          try {
            const packet = Packet.parse(buffer);
            this.handlePacket(player, packet);
            buffer = Buffer.alloc(0);
          } catch (err: any) {
            if (err.message === 'Buffer underflow') {
              break;
            } else {
              buffer = Buffer.alloc(0);
              break;
            }
          }
        }
      } catch (err) {
        console.error(`[GameServer:${this.port}] Data error:`, err);
      }
    });

    socket.on('close', () => {
      if (player.room) {
        player.room.removePlayer(player);
      }
      this.players.delete(playerId);
    });

    this.send(player, OPCODE.HANDSHAKE, {
      serverType: SERVER_TYPE.GAME,
      playerId,
      message: 'Game Server Ready',
    });
  }

  private handlePacket(player: Player, packet: any): void {
    const { opcode, data } = packet;

    switch (opcode) {
      case OPCODE.AUTH:
        player.username = (data.username as string) || `Player${player.id}`;
        this.send(player, OPCODE.AUTH, { success: true, username: player.username });
        console.log(`[GameServer:${this.port}] Player authenticated: ${player.username}`);
        break;
      case OPCODE.CREATE_ROOM:
        this.handleCreateRoom(player, data);
        break;
      case OPCODE.JOIN_ROOM:
        this.handleJoinRoom(player, data);
        break;
      case OPCODE.LEAVE_ROOM:
        this.handleLeaveRoom(player);
        break;
      case OPCODE.ROOM_LIST:
        this.handleRoomList(player);
        break;
      case OPCODE.PLAYER_UPDATE:
        this.handlePlayerUpdate(player, data);
        break;
      case OPCODE.RPC_CALL:
        this.handleRPC(player, data);
        break;
      case OPCODE.STATE_UPDATE:
        this.handleStateUpdate(player, data);
        break;
    }
  }

  private handleCreateRoom(player: Player, data: PacketData): void {
    const roomName = (data.roomName as string) || `Room${Date.now()}`;
    
    if (this.rooms.has(roomName)) {
      this.send(player, OPCODE.CREATE_ROOM, { success: false, error: 'Room exists' });
      return;
    }

    const room = new Room(roomName, (data.maxPlayers as number) || 10);
    this.rooms.set(roomName, room);
    room.addPlayer(player);

    this.send(player, OPCODE.CREATE_ROOM, { success: true, roomName });
    console.log(`[GameServer:${this.port}] Room created: ${roomName}`);
  }

  private handleJoinRoom(player: Player, data: PacketData): void {
    const room = this.rooms.get(data.roomName as string);
    
    if (!room) {
      this.send(player, OPCODE.JOIN_ROOM, { success: false, error: 'Room not found' });
      return;
    }

    if (player.room) {
      player.room.removePlayer(player);
    }

    const joined = room.addPlayer(player);
    
    if (joined) {
      this.send(player, OPCODE.JOIN_ROOM, { success: true, roomName: room.name });
      room.broadcast(
        OPCODE.PLAYER_UPDATE,
        {
          playerId: player.id,
          username: player.username,
          action: 'joined',
        },
        (p: Player, op: OPCODE, d: PacketData) => this.send(p, op, d),
        player.id
      );
      console.log(`[GameServer:${this.port}] ${player.username} joined ${room.name}`);
    } else {
      this.send(player, OPCODE.JOIN_ROOM, { success: false, error: 'Room full' });
    }
  }

  private handleLeaveRoom(player: Player): void {
    if (player.room) {
      const roomName = player.room.name;
      player.room.removePlayer(player);
      this.send(player, OPCODE.LEAVE_ROOM, { success: true });
      console.log(`[GameServer:${this.port}] ${player.username} left ${roomName}`);
    }
  }

  private handleRoomList(player: Player): void {
    const rooms = Array.from(this.rooms.values()).map((r) => r.toJSON());
    this.send(player, OPCODE.ROOM_LIST, { rooms });
  }

  private handlePlayerUpdate(player: Player, data: PacketData): void {
    if (!player.room) return;

    if (data.position) {
      player.position = data.position as any;
    }

    player.room.broadcast(
      OPCODE.PLAYER_UPDATE,
      {
        playerId: player.id,
        position: player.position,
      },
      (p: Player, op: OPCODE, d: PacketData) => this.send(p, op, d),
      player.id
    );
  }

  private handleRPC(player: Player, data: PacketData): void {
    if (!player.room) return;

    if (data.targetPlayerId) {
      const target = player.room.players.get(data.targetPlayerId as number);
      if (target) {
        this.send(target, OPCODE.RPC_CALL, {
          fromPlayerId: player.id,
          method: data.method,
          params: data.params,
        });
      }
    } else {
      player.room.broadcast(
        OPCODE.RPC_CALL,
        {
          fromPlayerId: player.id,
          method: data.method,
          params: data.params,
        },
        (p: Player, op: OPCODE, d: PacketData) => this.send(p, op, d),
        player.id
      );
    }
  }

  private handleStateUpdate(player: Player, data: PacketData): void {
    if (!player.room) return;
    player.room.broadcast(
      OPCODE.STATE_UPDATE,
      {
        playerId: player.id,
        state: data.state,
      },
      (p: Player, op: OPCODE, d: PacketData) => this.send(p, op, d),
      player.id
    );
  }

  private send(player: Player, opcode: OPCODE, data: PacketData): void {
    try {
      const packet = Packet.create(opcode, data);
      player.socket.write(packet);
    } catch (err) {
      console.error(`[GameServer:${this.port}] Send error:`, err);
    }
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.nameServerConnection) {
      this.nameServerConnection.end();
    }
    if (this.server) {
      this.server.close();
      console.log(`[GameServer:${this.port}] Server stopped`);
    }
  }
}
import { Server, Socket, createServer, connect } from 'net';
import { Packet, OPCODE, SERVER_TYPE, PacketData } from '../protocol';
import { ChatRoom, ChatUser, ChatMessage } from '../models';

export class ChatServer {
  private readonly port: number;
  private readonly nameServerHost: string;
  private readonly nameServerPort: number;
  private server: Server | null = null;
  private nameServerConnection: Socket | null = null;
  private users: Map<number, ChatUser> = new Map();
  private rooms: Map<string, ChatRoom> = new Map();
  private nextUserId: number = 1;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    port: number = 9100,
    nameServerHost: string = 'localhost',
    nameServerPort: number = 8888
  ) {
    this.port = port;
    this.nameServerHost = nameServerHost;
    this.nameServerPort = nameServerPort;
    
    this.rooms.set('general', new ChatRoom('general'));
    this.rooms.set('help', new ChatRoom('help'));
    this.rooms.set('trade', new ChatRoom('trade'));
  }

  async start(): Promise<void> {
    await this.connectToNameServer();

    this.server = createServer((socket) => this.handleConnection(socket));

    this.server.listen(this.port, () => {
      console.log(`[ChatServer] Listening on port ${this.port}`);
      console.log(`[ChatServer] Role: Text Chat & Messaging`);
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
        console.log('[ChatServer] Connected to Name Server');
        resolve();
      });

      this.nameServerConnection.on('error', (err) => {
        console.error('[ChatServer] Name Server error:', err.message);
        reject(err);
      });
    });
  }

  private registerWithNameServer(): void {
    if (!this.nameServerConnection) return;
    
    const packet = Packet.create(OPCODE.REGISTER_SERVER, {
      type: SERVER_TYPE.CHAT,
      host: 'localhost',
      port: this.port,
      capacity: 1000,
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
        load: this.users.size,
      });
      this.nameServerConnection.write(packet);
    }
  }

  private handleConnection(socket: Socket): void {
    const userId = this.nextUserId++;
    const user: ChatUser = {
      id: userId,
      username: `User${userId}`,
      chatRooms: new Set(),
      send: (opcode: OPCODE, data: PacketData) => {
        try {
          const packet = Packet.create(opcode, data);
          socket.write(packet);
        } catch (err) {
          console.error('[ChatServer] Send error:', err);
        }
      },
    };

    this.users.set(userId, user);

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.length >= 6) {
          try {
            const packet = Packet.parse(buffer);
            this.handlePacket(user, packet);
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
        console.error('[ChatServer] Data error:', err);
      }
    });

    socket.on('close', () => {
      for (const roomName of user.chatRooms) {
        const room = this.rooms.get(roomName);
        if (room) {
          room.removeUser(user);
          room.broadcast(OPCODE.CHAT_USER_LIST, {
            roomName,
            action: 'left',
            userId: user.id,
            username: user.username,
          });
        }
      }
      this.users.delete(userId);
    });

    user.send(OPCODE.HANDSHAKE, {
      serverType: SERVER_TYPE.CHAT,
      userId,
      message: 'Chat Server Ready',
    });
  }

  private handlePacket(user: ChatUser, packet: any): void {
    const { opcode, data } = packet;

    switch (opcode) {
      case OPCODE.AUTH:
        user.username = (data.username as string) || `User${user.id}`;
        user.send(OPCODE.AUTH, { success: true, username: user.username });
        console.log(`[ChatServer] User authenticated: ${user.username}`);
        break;
      case OPCODE.CHAT_ROOM_JOIN:
        this.handleJoinRoom(user, data);
        break;
      case OPCODE.CHAT_ROOM_LEAVE:
        this.handleLeaveRoom(user, data);
        break;
      case OPCODE.CHAT_ROOM_LIST:
        this.handleRoomList(user);
        break;
      case OPCODE.CHAT_MESSAGE:
        this.handleChatMessage(user, data);
        break;
      case OPCODE.CHAT_DIRECT_MESSAGE:
        this.handleDirectMessage(user, data);
        break;
      case OPCODE.CHAT_TYPING:
        this.handleTyping(user, data);
        break;
    }
  }

  private handleJoinRoom(user: ChatUser, data: PacketData): void {
    const { roomName } = data;
    
    if (!this.rooms.has(roomName as string)) {
      this.rooms.set(roomName as string, new ChatRoom(roomName as string));
      console.log(`[ChatServer] Chat room created: ${roomName}`);
    }

    const room = this.rooms.get(roomName as string)!;
    room.addUser(user);

    user.send(OPCODE.CHAT_ROOM_JOIN, {
      success: true,
      roomName,
      history: room.messageHistory,
      users: Array.from(room.users.values()).map((u) => ({
        id: u.id,
        username: u.username,
      })),
    });

    room.broadcast(
      OPCODE.CHAT_USER_LIST,
      {
        roomName,
        action: 'joined',
        userId: user.id,
        username: user.username,
      },
      user.id
    );

    console.log(`[ChatServer] ${user.username} joined chat room: ${roomName}`);
  }

  private handleLeaveRoom(user: ChatUser, data: PacketData): void {
    const { roomName } = data;
    const room = this.rooms.get(roomName as string);
    
    if (!room) return;

    room.removeUser(user);
    user.send(OPCODE.CHAT_ROOM_LEAVE, { success: true, roomName });

    room.broadcast(OPCODE.CHAT_USER_LIST, {
      roomName,
      action: 'left',
      userId: user.id,
      username: user.username,
    });

    console.log(`[ChatServer] ${user.username} left chat room: ${roomName}`);
  }

  private handleRoomList(user: ChatUser): void {
    const rooms = Array.from(this.rooms.values()).map((r) => r.toJSON());
    user.send(OPCODE.CHAT_ROOM_LIST, { rooms });
  }

  private handleChatMessage(user: ChatUser, data: PacketData): void {
    const { roomName, message } = data;
    const room = this.rooms.get(roomName as string);
    
    if (!room || !room.users.has(user.id)) return;

    const chatMessage: ChatMessage = {
      userId: user.id,
      username: user.username,
      message: message as string,
      timestamp: Date.now(),
    };

    room.addMessage(chatMessage);
    room.broadcast(OPCODE.CHAT_MESSAGE, {
      roomName,
      ...chatMessage,
    });

    console.log(`[ChatServer] [${roomName}] ${user.username}: ${message}`);
  }

  private handleDirectMessage(user: ChatUser, data: PacketData): void {
    const { targetUserId, message } = data;
    const targetUser = this.users.get(targetUserId as number);
    
    if (!targetUser) {
      user.send(OPCODE.CHAT_DIRECT_MESSAGE, {
        success: false,
        error: 'User not found',
      });
      return;
    }

    const dmMessage = {
      fromUserId: user.id,
      fromUsername: user.username,
      message,
      timestamp: Date.now(),
    };

    targetUser.send(OPCODE.CHAT_DIRECT_MESSAGE, dmMessage);
    
    user.send(OPCODE.CHAT_DIRECT_MESSAGE, {
      success: true,
      toUserId: targetUserId,
      ...dmMessage,
    });

    console.log(`[ChatServer] [DM] ${user.username} -> User${targetUserId}: ${message}`);
  }

  private handleTyping(user: ChatUser, data: PacketData): void {
    const { roomName, isTyping } = data;
    const room = this.rooms.get(roomName as string);
    
    if (!room) return;

    room.broadcast(
      OPCODE.CHAT_TYPING,
      {
        roomName,
        userId: user.id,
        username: user.username,
        isTyping,
      },
      user.id
    );
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
      console.log('[ChatServer] Server stopped');
    }
  }
}

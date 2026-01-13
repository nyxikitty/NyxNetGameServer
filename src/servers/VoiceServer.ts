import { Server, Socket, createServer, connect } from 'net';
import { Packet, OPCODE, SERVER_TYPE, PacketData } from '../protocol';
import { VoiceChannel, VoiceUser } from '../models';

export class VoiceServer {
  private readonly port: number;
  private readonly nameServerHost: string;
  private readonly nameServerPort: number;
  private server: Server | null = null;
  private nameServerConnection: Socket | null = null;
  private users: Map<number, VoiceUser> = new Map();
  private channels: Map<string, VoiceChannel> = new Map();
  private nextUserId: number = 1;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    port: number = 9200,
    nameServerHost: string = 'localhost',
    nameServerPort: number = 8888
  ) {
    this.port = port;
    this.nameServerHost = nameServerHost;
    this.nameServerPort = nameServerPort;
    
    this.channels.set('general', new VoiceChannel('general'));
    this.channels.set('team1', new VoiceChannel('team1'));
    this.channels.set('team2', new VoiceChannel('team2'));
  }

  async start(): Promise<void> {
    await this.connectToNameServer();

    this.server = createServer((socket) => this.handleConnection(socket));

    this.server.listen(this.port, () => {
      console.log(`[VoiceServer] Listening on port ${this.port}`);
      console.log(`[VoiceServer] Role: Voice Chat Coordination`);
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
        console.log('[VoiceServer] Connected to Name Server');
        resolve();
      });

      this.nameServerConnection.on('error', (err) => {
        console.error('[VoiceServer] Name Server error:', err.message);
        reject(err);
      });
    });
  }

  private registerWithNameServer(): void {
    if (!this.nameServerConnection) return;
    
    const packet = Packet.create(OPCODE.REGISTER_SERVER, {
      type: SERVER_TYPE.VOICE,
      host: 'localhost',
      port: this.port,
      capacity: 500,
      metadata: {
        version: '1.0.0',
        channels: this.channels.size,
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
    const user: VoiceUser = {
      id: userId,
      username: `User${userId}`,
      voiceChannel: null,
      muted: false,
      send: (opcode: OPCODE, data: PacketData) => {
        try {
          const packet = Packet.create(opcode, data);
          socket.write(packet);
        } catch (err) {
          console.error('[VoiceServer] Send error:', err);
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
        console.error('[VoiceServer] Data error:', err);
      }
    });

    socket.on('close', () => {
      if (user.voiceChannel) {
        user.voiceChannel.removeUser(user);
        user.voiceChannel.broadcast(OPCODE.VOICE_USER_LIST, {
          channelName: user.voiceChannel.name,
          action: 'left',
          userId: user.id,
        });
      }
      this.users.delete(userId);
    });

    user.send(OPCODE.HANDSHAKE, {
      serverType: SERVER_TYPE.VOICE,
      userId,
      message: 'Voice Server Ready',
    });
  }

  private handlePacket(user: VoiceUser, packet: any): void {
    const { opcode, data } = packet;

    switch (opcode) {
      case OPCODE.AUTH:
        user.username = (data.username as string) || `User${user.id}`;
        user.send(OPCODE.AUTH, { success: true, username: user.username });
        console.log(`[VoiceServer] User authenticated: ${user.username}`);
        break;
      case OPCODE.VOICE_JOIN_CHANNEL:
        this.handleJoinChannel(user, data);
        break;
      case OPCODE.VOICE_LEAVE_CHANNEL:
        this.handleLeaveChannel(user);
        break;
      case OPCODE.VOICE_DATA:
        this.handleVoiceData(user, data);
        break;
      case OPCODE.VOICE_MUTE:
        this.handleMute(user, true);
        break;
      case OPCODE.VOICE_UNMUTE:
        this.handleMute(user, false);
        break;
      case OPCODE.VOICE_PEER_INFO:
        this.handlePeerInfo(user, data);
        break;
    }
  }

  private handleJoinChannel(user: VoiceUser, data: PacketData): void {
    const { channelName } = data;
    
    if (!this.channels.has(channelName as string)) {
      this.channels.set(channelName as string, new VoiceChannel(channelName as string));
      console.log(`[VoiceServer] Voice channel created: ${channelName}`);
    }

    if (user.voiceChannel) {
      user.voiceChannel.removeUser(user);
    }

    const channel = this.channels.get(channelName as string)!;
    channel.addUser(user);

    const users = Array.from(channel.users.values()).map((u) => ({
      id: u.id,
      username: u.username,
      muted: u.muted,
    }));

    user.send(OPCODE.VOICE_JOIN_CHANNEL, {
      success: true,
      channelName,
      users,
    });

    channel.broadcast(
      OPCODE.VOICE_USER_LIST,
      {
        channelName,
        action: 'joined',
        userId: user.id,
        username: user.username,
        muted: user.muted,
      },
      user.id
    );

    console.log(`[VoiceServer] ${user.username} joined voice channel: ${channelName}`);
  }

  private handleLeaveChannel(user: VoiceUser): void {
    if (!user.voiceChannel) return;

    const channelName = user.voiceChannel.name;
    user.voiceChannel.broadcast(OPCODE.VOICE_USER_LIST, {
      channelName,
      action: 'left',
      userId: user.id,
    });

    user.voiceChannel.removeUser(user);
    user.send(OPCODE.VOICE_LEAVE_CHANNEL, { success: true });

    console.log(`[VoiceServer] ${user.username} left voice channel: ${channelName}`);
  }

  private handleVoiceData(user: VoiceUser, data: PacketData): void {
    if (!user.voiceChannel || user.muted) return;

    const { audioData, targetUserId } = data;

    if (targetUserId) {
      const targetUser = user.voiceChannel.users.get(targetUserId as number);
      if (targetUser) {
        targetUser.send(OPCODE.VOICE_DATA, {
          fromUserId: user.id,
          audioData,
        });
      }
    } else {
      user.voiceChannel.broadcast(
        OPCODE.VOICE_DATA,
        {
          fromUserId: user.id,
          audioData,
        },
        user.id
      );
    }
  }

  private handleMute(user: VoiceUser, muted: boolean): void {
    user.muted = muted;

    const opcode = muted ? OPCODE.VOICE_MUTE : OPCODE.VOICE_UNMUTE;
    user.send(opcode, { success: true, muted });

    if (user.voiceChannel) {
      user.voiceChannel.broadcast(
        opcode,
        {
          userId: user.id,
          muted,
        },
        user.id
      );
    }

    console.log(`[VoiceServer] ${user.username} ${muted ? 'muted' : 'unmuted'}`);
  }

  private handlePeerInfo(user: VoiceUser, data: PacketData): void {
    const { targetUserId, peerInfo } = data;
    
    if (!user.voiceChannel) return;

    const targetUser = user.voiceChannel.users.get(targetUserId as number);
    if (targetUser) {
      targetUser.send(OPCODE.VOICE_PEER_INFO, {
        fromUserId: user.id,
        peerInfo,
      });
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
      console.log('[VoiceServer] Server stopped');
    }
  }
}

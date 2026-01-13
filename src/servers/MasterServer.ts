import { Server, Socket, createServer, connect } from 'net';
import { Packet, OPCODE, SERVER_TYPE, PacketData } from '../protocol';
import { AuthPlugin } from '../auth';
import { Player } from '../models';

interface MatchmakingRequest {
  player: Player;
  gameMode: string;
  minPlayers: number;
  maxPlayers: number;
  requestTime: number;
}

export class MasterServer {
  private readonly port: number;
  private readonly nameServerHost: string;
  private readonly nameServerPort: number;
  private server: Server | null = null;
  private nameServerConnection: Socket | null = null;
  private players: Map<number, Player> = new Map();
  private sessions: Map<number, Player> = new Map();
  private authPlugins: Map<string, AuthPlugin> = new Map();
  private matchmakingQueue: MatchmakingRequest[] = [];
  private nextPlayerId: number = 1;
  private nextSessionId: number = 1;
  private matchmakingInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    port: number = 9000,
    nameServerHost: string = 'localhost',
    nameServerPort: number = 8888
  ) {
    this.port = port;
    this.nameServerHost = nameServerHost;
    this.nameServerPort = nameServerPort;
  }

  registerAuthPlugin(plugin: AuthPlugin): void {
    this.authPlugins.set(plugin.appId, plugin);
    console.log(
      `[MasterServer] Auth plugin registered: ${plugin.name} (${plugin.appId})`
    );
  }

  async start(): Promise<void> {
    await this.connectToNameServer();

    this.server = createServer((socket) => this.handleConnection(socket));

    this.server.listen(this.port, () => {
      console.log(`[MasterServer] Listening on port ${this.port}`);
      console.log(`[MasterServer] Role: Authentication & Matchmaking`);
      console.log(`[MasterServer] Auth plugins loaded: ${this.authPlugins.size}`);
      
      this.registerWithNameServer();
    });

    this.matchmakingInterval = setInterval(() => this.processMatchmaking(), 1000);
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 5000);
  }

  private connectToNameServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.nameServerConnection = connect({
        host: this.nameServerHost,
        port: this.nameServerPort,
      }, () => {
        console.log('[MasterServer] Connected to Name Server');
        resolve();
      });

      this.nameServerConnection.on('error', (err) => {
        console.error('[MasterServer] Name Server connection error:', err.message);
        reject(err);
      });

      let buffer = Buffer.alloc(0);
      this.nameServerConnection.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
      });
    });
  }

  private registerWithNameServer(): void {
    if (!this.nameServerConnection) return;
    
    const packet = Packet.create(OPCODE.REGISTER_SERVER, {
      type: SERVER_TYPE.MASTER,
      host: 'localhost',
      port: this.port,
      capacity: 10000,
      metadata: {
        version: '2.0.0',
        features: ['auth', 'matchmaking', 'auth-plugins'],
        authPlugins: Array.from(this.authPlugins.keys()),
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
    const sessionId = this.nextSessionId++;
    
    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.length >= 6) {
          try {
            const packet = Packet.parse(buffer);
            this.handlePacket(socket, sessionId, packet);
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
        console.error('[MasterServer] Data error:', err);
      }
    });

    socket.on('close', () => {
      const player = this.sessions.get(sessionId);
      if (player) {
        this.players.delete(player.id);
        this.sessions.delete(sessionId);
        console.log(`[MasterServer] Player logged out: ${player.username}`);
      }
    });

    this.send(socket, OPCODE.HANDSHAKE, {
      serverType: SERVER_TYPE.MASTER,
      message: 'Master Server Ready',
      supportedAuthPlugins: Array.from(this.authPlugins.keys()),
    });
  }

  private handlePacket(socket: Socket, sessionId: number, packet: any): void {
    const { opcode, data } = packet;

    switch (opcode) {
      case OPCODE.PLAYER_LOGIN:
        this.handlePlayerLogin(socket, sessionId, data);
        break;
      case OPCODE.PLAYER_LOGOUT:
        this.handlePlayerLogout(sessionId);
        break;
      case OPCODE.GET_GAME_SERVERS:
        this.handleGetGameServers(socket);
        break;
      case OPCODE.MATCHMAKING_REQUEST:
        this.handleMatchmakingRequest(socket, sessionId, data);
        break;
      case OPCODE.AUTH_PLUGIN_VERIFY:
        this.handleAuthPluginVerify(socket, sessionId, data);
        break;
    }
  }

  private async handlePlayerLogin(
    socket: Socket,
    sessionId: number,
    data: PacketData
  ): Promise<void> {
    const { appId, credentials, token } = data;

    const authPlugin = this.authPlugins.get(appId as string);
    
    if (!authPlugin) {
      this.send(socket, OPCODE.PLAYER_LOGIN, {
        success: false,
        error: `No auth plugin for appId: ${appId}`,
        supportedAppIds: Array.from(this.authPlugins.keys()),
      });
      return;
    }

    try {
      let authResult;

      if (token) {
        const userData = await authPlugin.verifyToken(token as string);
        authResult = {
          success: true,
          userId: userData.userId,
          username: userData.username,
          token: token,
          metadata: userData.metadata || {},
        };
      } else {
        authResult = await authPlugin.authenticate(credentials as any);
      }

      if (!authResult.success) {
        this.send(socket, OPCODE.PLAYER_LOGIN, {
          success: false,
          error: authResult.error,
        });
        return;
      }

      const playerId = this.nextPlayerId++;
      const player = new Player(playerId, socket, {
        userId: authResult.userId!,
        username: authResult.username!,
        appId: appId as string,
        token: authResult.token!,
        sessionId,
        loginTime: Date.now(),
        rating: 1000,
        metadata: authResult.metadata,
      });

      this.players.set(playerId, player);
      this.sessions.set(sessionId, player);

      console.log(`[MasterServer] Player logged in: ${player.username} (${appId})`);

      this.send(socket, OPCODE.PLAYER_LOGIN, {
        success: true,
        playerId,
        userId: authResult.userId,
        username: authResult.username,
        token: authResult.token,
        appId: appId,
        metadata: authResult.metadata,
      });
    } catch (err: any) {
      console.error('[MasterServer] Auth error:', err.message);
      this.send(socket, OPCODE.PLAYER_LOGIN, {
        success: false,
        error: err.message,
      });
    }
  }

  private async handleAuthPluginVerify(
    socket: Socket,
    _sessionId: number,
    data: PacketData
  ): Promise<void> {
    const { appId, token } = data;

    const authPlugin = this.authPlugins.get(appId as string);
    if (!authPlugin) {
      this.send(socket, OPCODE.AUTH_PLUGIN_VERIFY, {
        success: false,
        error: 'Invalid appId',
      });
      return;
    }

    try {
      const userData = await authPlugin.verifyToken(token as string);
      
      this.send(socket, OPCODE.AUTH_PLUGIN_VERIFY, {
        success: true,
        userId: userData.userId,
        username: userData.username,
        metadata: userData.metadata,
      });
    } catch (err: any) {
      this.send(socket, OPCODE.AUTH_PLUGIN_VERIFY, {
        success: false,
        error: err.message,
      });
    }
  }

  private handlePlayerLogout(sessionId: number): void {
    const player = this.sessions.get(sessionId);
    if (player) {
      this.players.delete(player.id);
      this.sessions.delete(sessionId);
    }
  }

  private handleGetGameServers(socket: Socket): void {
    if (!this.nameServerConnection) return;
    
    const packet = Packet.create(OPCODE.GET_GAME_SERVERS, {});
    this.nameServerConnection.write(packet);

    this.send(socket, OPCODE.GET_GAME_SERVERS, {
      servers: [],
    });
  }

  private handleMatchmakingRequest(
    socket: Socket,
    sessionId: number,
    data: PacketData
  ): void {
    const player = this.sessions.get(sessionId);
    if (!player) return;

    const { gameMode, minPlayers, maxPlayers } = data;

    this.matchmakingQueue.push({
      player,
      gameMode: (gameMode as string) || 'default',
      minPlayers: (minPlayers as number) || 2,
      maxPlayers: (maxPlayers as number) || 10,
      requestTime: Date.now(),
    });

    console.log(`[MasterServer] Matchmaking request from ${player.username}`);

    this.send(socket, OPCODE.MATCHMAKING_REQUEST, {
      success: true,
      message: 'Added to matchmaking queue',
    });
  }

  private processMatchmaking(): void {
    if (this.matchmakingQueue.length < 2) return;

    const groups = new Map<string, MatchmakingRequest[]>();
    
    for (const request of this.matchmakingQueue) {
      const key = request.gameMode;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(request);
    }

    for (const [gameMode, requests] of groups.entries()) {
      if (requests.length >= requests[0].minPlayers) {
        const match = requests.slice(0, requests[0].maxPlayers);
        
        this.matchmakingQueue = this.matchmakingQueue.filter(
          (r) => !match.includes(r)
        );

        for (const request of match) {
          this.send(request.player.socket, OPCODE.MATCHMAKING_FOUND, {
            gameMode,
            players: match.map((r) => ({
              id: r.player.id,
              username: r.player.username,
            })),
            gameServer: {
              host: 'localhost',
              port: 9001,
            },
          });
        }

        console.log(
          `[MasterServer] Match found: ${match.length} players in ${gameMode}`
        );
      }
    }
  }

  private send(socket: Socket, opcode: OPCODE, data: PacketData): void {
    try {
      const packet = Packet.create(opcode, data);
      socket.write(packet);
    } catch (err) {
      console.error('[MasterServer] Send error:', err);
    }
  }

  stop(): void {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.nameServerConnection) {
      this.nameServerConnection.end();
    }
    if (this.server) {
      this.server.close();
      console.log('[MasterServer] Server stopped');
    }
  }
}
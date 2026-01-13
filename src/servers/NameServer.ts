import { Server, Socket, createServer } from 'net';
import { Packet, OPCODE, SERVER_TYPE, PacketData } from '../protocol';

interface RegisteredServer {
  type: SERVER_TYPE;
  host: string;
  port: number;
  capacity: number;
  currentLoad: number;
  metadata: Record<string, any>;
  lastHeartbeat: number;
  socket: Socket;
}

export class NameServer {
  private readonly port: number;
  private server: Server | null = null;
  private registeredServers: Map<string, RegisteredServer> = new Map();
  private clients: Map<number, Socket> = new Map();
  private nextClientId: number = 1;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(port: number = 8888) {
    this.port = port;
  }

  start(): void {
    this.server = createServer((socket) => this.handleConnection(socket));

    this.server.listen(this.port, () => {
      console.log(`[NameServer] Listening on port ${this.port}`);
      console.log(`[NameServer] Role: Server Discovery & Routing`);
    });

    this.healthCheckInterval = setInterval(() => this.healthCheck(), 5000);
  }

  private handleConnection(socket: Socket): void {
    const clientId = this.nextClientId++;
    this.clients.set(clientId, socket);

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.length >= 6) {
          try {
            const packet = Packet.parse(buffer);
            this.handlePacket(socket, clientId, packet);
            buffer = Buffer.alloc(0);
          } catch (err: any) {
            if (err.message === 'Buffer underflow') {
              break;
            } else {
              console.error('[NameServer] Parse error:', err.message);
              buffer = Buffer.alloc(0);
              break;
            }
          }
        }
      } catch (err) {
        console.error('[NameServer] Data error:', err);
      }
    });

    socket.on('close', () => {
      this.clients.delete(clientId);
      for (const [key, info] of this.registeredServers.entries()) {
        if (info.socket === socket) {
          this.registeredServers.delete(key);
          console.log(
            `[NameServer] Server unregistered: ${info.type} (${info.host}:${info.port})`
          );
        }
      }
    });

    socket.on('error', (err) => {
      console.error('[NameServer] Socket error:', err.message);
    });

    this.send(socket, OPCODE.HANDSHAKE, {
      serverType: SERVER_TYPE.NAME,
      message: 'Name Server Ready',
    });
  }

  private handlePacket(socket: Socket, _clientId: number, packet: any): void {
    const { opcode, data } = packet;

    switch (opcode) {
      case OPCODE.REGISTER_SERVER:
        this.handleRegisterServer(socket, data);
        break;
      case OPCODE.UNREGISTER_SERVER:
        this.handleUnregisterServer(socket, data);
        break;
      case OPCODE.SERVER_LIST:
        this.handleServerList(socket, data);
        break;
      case OPCODE.GET_GAME_SERVERS:
        this.handleGetGameServers(socket);
        break;
      case OPCODE.PING:
        this.handlePing(socket, data);
        break;
    }
  }

  private handleRegisterServer(socket: Socket, data: PacketData): void {
    const { type, host, port, capacity, metadata } = data;
    const key = `${type}:${host}:${port}`;

    this.registeredServers.set(key, {
      type: type as SERVER_TYPE,
      host: host as string,
      port: port as number,
      capacity: (capacity as number) || 100,
      currentLoad: 0,
      metadata: (metadata as Record<string, any>) || {},
      lastHeartbeat: Date.now(),
      socket,
    });

    console.log(`[NameServer] Server registered: ${type} (${host}:${port})`);

    this.send(socket, OPCODE.REGISTER_SERVER, {
      success: true,
      serverId: key,
    });
  }

  private handleUnregisterServer(socket: Socket, data: PacketData): void {
    const { serverId } = data;
    this.registeredServers.delete(serverId as string);

    this.send(socket, OPCODE.UNREGISTER_SERVER, {
      success: true,
    });
  }

  private handlePing(socket: Socket, data: PacketData): void {
    // Update lastHeartbeat for the server that sent this ping
    for (const [_key, info] of this.registeredServers.entries()) {
      if (info.socket === socket) {
        info.lastHeartbeat = Date.now();
        if (data.load !== undefined) {
          info.currentLoad = data.load as number;
        }
        break;
      }
    }
    this.send(socket, OPCODE.PONG, { timestamp: Date.now() });
  }

  private handleServerList(socket: Socket, data: PacketData): void {
    const { type } = data;
    
    const servers = Array.from(this.registeredServers.values())
      .filter((s) => !type || s.type === type)
      .map((s) => ({
        type: s.type,
        host: s.host,
        port: s.port,
        capacity: s.capacity,
        currentLoad: s.currentLoad,
        metadata: s.metadata,
      }));

    this.send(socket, OPCODE.SERVER_LIST, { servers });
  }

  private handleGetGameServers(socket: Socket): void {
    const gameServers = Array.from(this.registeredServers.values())
      .filter((s) => s.type === SERVER_TYPE.GAME)
      .sort((a, b) => a.currentLoad - b.currentLoad)
      .map((s) => ({
        host: s.host,
        port: s.port,
        currentLoad: s.currentLoad,
        capacity: s.capacity,
      }));

    this.send(socket, OPCODE.GET_GAME_SERVERS, {
      servers: gameServers,
    });
  }

  private healthCheck(): void {
    const now = Date.now();
    for (const [key, info] of this.registeredServers.entries()) {
      if (now - info.lastHeartbeat > 15000) {
        console.log(
          `[NameServer] Server timeout: ${info.type} (${info.host}:${info.port})`
        );
        this.registeredServers.delete(key);
      }
    }
  }

  private send(socket: Socket, opcode: OPCODE, data: PacketData): void {
    try {
      const packet = Packet.create(opcode, data);
      socket.write(packet);
    } catch (err) {
      console.error('[NameServer] Send error:', err);
    }
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.server) {
      this.server.close();
      console.log('[NameServer] Server stopped');
    }
  }
}
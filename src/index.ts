import { NameServer } from './servers/NameServer';
import { MasterServer } from './servers/MasterServer';
import { GameServer } from './servers/GameServer';
import { ChatServer } from './servers/ChatServer';
import { VoiceServer } from './servers/VoiceServer';
import { SimpleAuthPlugin, OAuthAuthPlugin, APIKeyAuthPlugin } from './auth';
import { WebSocketServer, WebSocket } from 'ws';
import { connect } from 'net';
import { Packet } from './protocol';

const sleep = (ms: number): Promise<void> => 
  new Promise((resolve) => setTimeout(resolve, ms));

// WebSocket Bridge
class WebSocketBridge {
  private wss: WebSocketServer | null = null;

  constructor(
    private wsPort: number,
    private tcpHost: string,
    private tcpPort: number,
    private name: string
  ) {}

  start(): void {
    this.wss = new WebSocketServer({ port: this.wsPort });

    this.wss.on('connection', (ws: WebSocket) => {
      const tcpSocket = connect({ host: this.tcpHost, port: this.tcpPort });
      let tcpBuffer = Buffer.alloc(0);

      ws.on('message', (data: Buffer | string) => {
        try {
          const jsonData = typeof data === 'string' ? data : data.toString();
          const { opcode, data: packetData } = JSON.parse(jsonData);
          const packet = Packet.create(opcode, packetData);
          tcpSocket.write(packet);
        } catch (err) {
          console.error(`[${this.name}] WS->TCP error:`, err);
        }
      });

      tcpSocket.on('data', (data: Buffer) => {
        try {
          tcpBuffer = Buffer.concat([tcpBuffer, data]);
          while (tcpBuffer.length >= 6) {
            try {
              const packet = Packet.parse(tcpBuffer);
              const jsonPacket = JSON.stringify({ opcode: packet.opcode, data: packet.data });
              if (ws.readyState === WebSocket.OPEN) ws.send(jsonPacket);
              tcpBuffer = Buffer.alloc(0);
            } catch (err: any) {
              if (err.message === 'Buffer underflow') break;
              tcpBuffer = Buffer.alloc(0);
              break;
            }
          }
        } catch (err) {}
      });

      ws.on('close', () => tcpSocket.end());
      tcpSocket.on('close', () => { if (ws.readyState === WebSocket.OPEN) ws.close(); });
      tcpSocket.on('error', () => { if (ws.readyState === WebSocket.OPEN) ws.close(); });
      ws.on('error', () => tcpSocket.end());
    });

    console.log(`[${this.name}] WS:${this.wsPort} -> TCP:${this.tcpPort}`);
  }

  stop(): void {
    if (this.wss) this.wss.close();
  }
}

async function startAll() {
  console.log('');
  console.log('================================================================');
  console.log('  DISTRIBUTED SERVER + WEBSOCKET BRIDGES');
  console.log('================================================================');
  console.log('');

  // Start Name Server
  console.log('[1/8] Starting Name Server...');
  const nameServer = new NameServer(8888);
  nameServer.start();
  await sleep(1000);

  // Start Master Server
  console.log('[2/8] Starting Master Server with Auth Plugins...');
  const masterServer = new MasterServer(9000);
  masterServer.registerAuthPlugin(new SimpleAuthPlugin());
  masterServer.registerAuthPlugin(new OAuthAuthPlugin({
    clientId: 'game-client-123',
    clientSecret: 'super-secret-key',
  }));
  const apiKeyPlugin = new APIKeyAuthPlugin();
  const testKey1 = apiKeyPlugin.createAPIKey('test-app-1', {
    appName: 'Test Game 1',
    permissions: ['read', 'write', 'admin'],
  });
  const testKey2 = apiKeyPlugin.createAPIKey('test-app-2', {
    appName: 'Test Game 2',
    permissions: ['read'],
  });
  masterServer.registerAuthPlugin(apiKeyPlugin);
  await masterServer.start();
  await sleep(1000);

  // Start Game Servers (on different ports for TCP)
  console.log('[3/8] Starting Game Servers (x3)...');
  const gameServer1 = new GameServer(9011); // TCP port
  const gameServer2 = new GameServer(9012);
  const gameServer3 = new GameServer(9013);
  await Promise.all([
    gameServer1.start(),
    gameServer2.start(),
    gameServer3.start()
  ]);
  await sleep(1000);

  // Start Chat Server
  console.log('[4/8] Starting Chat Server...');
  const chatServer = new ChatServer(9110); // TCP port
  await chatServer.start();
  await sleep(1000);

  // Start Voice Server
  console.log('[5/8] Starting Voice Server...');
  const voiceServer = new VoiceServer(9210); // TCP port
  await voiceServer.start();
  await sleep(1000);

  // Start WebSocket Bridges
  console.log('[6/8] Starting WebSocket Bridges...');
  const gameBridge = new WebSocketBridge(9001, 'localhost', 9011, 'Game Bridge');
  const chatBridge = new WebSocketBridge(9100, 'localhost', 9110, 'Chat Bridge');
  const voiceBridge = new WebSocketBridge(9200, 'localhost', 9210, 'Voice Bridge');
  
  gameBridge.start();
  chatBridge.start();
  voiceBridge.start();
  await sleep(500);

  console.log('');
  console.log('================================================================');
  console.log('  ALL SYSTEMS OPERATIONAL');
  console.log('================================================================');
  console.log('');
  console.log('TCP Servers:');
  console.log('  Name Server:     localhost:8888');
  console.log('  Master Server:   localhost:9000');
  console.log('  Game Server 1:   localhost:9011 (TCP)');
  console.log('  Game Server 2:   localhost:9012 (TCP)');
  console.log('  Game Server 3:   localhost:9013 (TCP)');
  console.log('  Chat Server:     localhost:9110 (TCP)');
  console.log('  Voice Server:    localhost:9210 (TCP)');
  console.log('');
  console.log('WebSocket Bridges (for browser clients):');
  console.log('  Game:  ws://localhost:9001  -> tcp://localhost:9011');
  console.log('  Chat:  ws://localhost:9100  -> tcp://localhost:9110');
  console.log('  Voice: ws://localhost:9200  -> tcp://localhost:9210');
  console.log('');
  console.log('Auth Plugins:');
  console.log('  SimpleAuth:      appId: simple-auth-v1');
  console.log('  OAuth:           appId: oauth-v1');
  console.log('  API Key:         appId: apikey-v1');
  console.log('');
  console.log('Test API Keys:');
  console.log(`  ${testKey1.apiKey}`);
  console.log(`    App: ${testKey1.appName}`);
  console.log(`  ${testKey2.apiKey}`);
  console.log(`    App: ${testKey2.appName}`);
  console.log('');
  console.log('🎨 Open client.html in your browser to connect!');
  console.log('================================================================');
  console.log('');

  process.on('SIGINT', () => {
    console.log('\n\nShutting down all systems...\n');
    nameServer.stop();
    masterServer.stop();
    gameServer1.stop();
    gameServer2.stop();
    gameServer3.stop();
    chatServer.stop();
    voiceServer.stop();
    gameBridge.stop();
    chatBridge.stop();
    voiceBridge.stop();
    console.log('All systems stopped\n');
    process.exit(0);
  });
}

startAll().catch(console.error);
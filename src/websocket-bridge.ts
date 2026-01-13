import { WebSocketServer, WebSocket } from 'ws';
import { connect } from 'net';
import { Packet } from './protocol';

interface BridgeConfig {
  wsPort: number;
  tcpHost: string;
  tcpPort: number;
  name: string;
}

class WebSocketBridge {
  private wss: WebSocketServer | null = null;
  private config: BridgeConfig;

  constructor(config: BridgeConfig) {
    this.config = config;
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.config.wsPort });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`[${this.config.name}] WebSocket client connected`);

      // Create TCP connection to actual server
      const tcpSocket = connect({
        host: this.config.tcpHost,
        port: this.config.tcpPort,
      });

      let tcpBuffer = Buffer.alloc(0);

      // WebSocket -> TCP
      ws.on('message', (data: Buffer | string) => {
        try {
          // Client sends JSON, convert to binary protocol
          const jsonData = typeof data === 'string' ? data : data.toString();
          const { opcode, data: packetData } = JSON.parse(jsonData);
          
          const packet = Packet.create(opcode, packetData);
          tcpSocket.write(packet);
        } catch (err) {
          console.error(`[${this.config.name}] Error forwarding to TCP:`, err);
        }
      });

      // TCP -> WebSocket
      tcpSocket.on('data', (data: Buffer) => {
        try {
          tcpBuffer = Buffer.concat([tcpBuffer, data]);

          while (tcpBuffer.length >= 6) {
            try {
              const packet = Packet.parse(tcpBuffer);
              
              // Convert binary packet to JSON for WebSocket
              const jsonPacket = JSON.stringify({
                opcode: packet.opcode,
                data: packet.data,
              });
              
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(jsonPacket);
              }
              
              tcpBuffer = Buffer.alloc(0);
            } catch (err: any) {
              if (err.message === 'Buffer underflow') {
                break;
              } else {
                console.error(`[${this.config.name}] Parse error:`, err.message);
                tcpBuffer = Buffer.alloc(0);
                break;
              }
            }
          }
        } catch (err) {
          console.error(`[${this.config.name}] Error forwarding to WebSocket:`, err);
        }
      });

      // Handle disconnections
      ws.on('close', () => {
        console.log(`[${this.config.name}] WebSocket client disconnected`);
        tcpSocket.end();
      });

      tcpSocket.on('close', () => {
        console.log(`[${this.config.name}] TCP connection closed`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });

      tcpSocket.on('error', (err) => {
        console.error(`[${this.config.name}] TCP error:`, err.message);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });

      ws.on('error', (err: Error) => {
        console.error(`[${this.config.name}] WebSocket error:`, err.message);
        tcpSocket.end();
      });
    });

    console.log(`[${this.config.name}] WebSocket bridge listening on port ${this.config.wsPort}`);
    console.log(`[${this.config.name}] Forwarding to ${this.config.tcpHost}:${this.config.tcpPort}`);
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      console.log(`[${this.config.name}] Bridge stopped`);
    }
  }
}

// Start bridges for all servers
async function startBridges() {
  console.log('');
  console.log('================================================================');
  console.log('  WEBSOCKET BRIDGE SERVER');
  console.log('================================================================');
  console.log('');

  const bridges = [
    new WebSocketBridge({
      wsPort: 9001,
      tcpHost: 'localhost',
      tcpPort: 9011,
      name: 'Game Bridge',
    }),
    new WebSocketBridge({
      wsPort: 9100,
      tcpHost: 'localhost',
      tcpPort: 9110,
      name: 'Chat Bridge',
    }),
    new WebSocketBridge({
      wsPort: 9200,
      tcpHost: 'localhost',
      tcpPort: 9210,
      name: 'Voice Bridge',
    }),
  ];

  bridges.forEach((bridge) => bridge.start());

  console.log('');
  console.log('WebSocket Bridges Active:');
  console.log('  Game:  ws://localhost:9001  -> tcp://localhost:9011');
  console.log('  Chat:  ws://localhost:9100  -> tcp://localhost:9110');
  console.log('  Voice: ws://localhost:9200  -> tcp://localhost:9210');
  console.log('');
  console.log('Open client.html in your browser to connect!');
  console.log('================================================================');
  console.log('');

  process.on('SIGINT', () => {
    console.log('\n\nShutting down bridges...\n');
    bridges.forEach((bridge) => bridge.stop());
    process.exit(0);
  });
}

startBridges().catch(console.error);
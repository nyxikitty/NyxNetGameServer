import { NyxWSServer, NyxWSConnection } from './nyx-ws';
import { connect } from 'net';

export interface BridgeOptions {
  useTcpMode?: boolean;
}

export class WebSocketBridge {
  private wss: NyxWSServer | null = null;

  constructor(
    private wsPort: number,
    private tcpHost: string,
    private tcpPort: number,
    private name: string,
    private options: BridgeOptions = {}
  ) {}

  start(): void {
    this.wss = new NyxWSServer({ port: this.wsPort });

    this.wss.on('connection', (ws: NyxWSConnection) => {
      const tcpSocket = connect({ host: this.tcpHost, port: this.tcpPort });

      if (this.options.useTcpMode) {
        ws.switchToTCP();
      }

      ws.on('message', (data: Buffer | string) => {
        try {
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          tcpSocket.write(buffer);
        } catch (err) {
          console.error(`[${this.name}] WS->TCP error:`, err);
        }
      });

      tcpSocket.on('data', (data: Buffer) => {
        try {
          ws.send(data);
        } catch (err) {
          console.error(`[${this.name}] TCP->WS error:`, err);
        }
      });

      ws.on('close', () => tcpSocket.end());
      tcpSocket.on('close', () => ws.close());
      tcpSocket.on('error', () => ws.close());
    });

    this.wss.listen(this.wsPort, () => {
      const mode = this.options.useTcpMode ? 'TCP' : 'WebSocket';
      console.log(`[${this.name}] WS:${this.wsPort} -> TCP:${this.tcpPort} (${mode} mode)`);
    });
  }

  stop(): void {
    if (this.wss) this.wss.close();
  }
}
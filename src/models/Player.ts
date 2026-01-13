import { Socket } from 'net';
import { Vec3 } from '../protocol';

export interface PlayerData {
  id: number;
  userId?: string;
  username: string;
  appId?: string;
  token?: string;
  sessionId?: number;
  loginTime?: number;
  rating?: number;
  metadata?: Record<string, any>;
}

export class Player {
  readonly id: number;
  readonly socket: Socket;
  userId?: string;
  username: string;
  appId?: string;
  token?: string;
  sessionId?: number;
  loginTime?: number;
  rating: number;
  metadata: Record<string, any>;
  position: Vec3;
  room: any = null;

  constructor(id: number, socket: Socket, data: Partial<PlayerData> = {}) {
    this.id = id;
    this.socket = socket;
    this.userId = data.userId;
    this.username = data.username || `Player${id}`;
    this.appId = data.appId;
    this.token = data.token;
    this.sessionId = data.sessionId;
    this.loginTime = data.loginTime || Date.now();
    this.rating = data.rating || 1000;
    this.metadata = data.metadata || {};
    this.position = { x: 0, y: 0, z: 0 };
  }

  toJSON(): PlayerData {
    return {
      id: this.id,
      userId: this.userId,
      username: this.username,
      appId: this.appId,
      token: this.token,
      sessionId: this.sessionId,
      loginTime: this.loginTime,
      rating: this.rating,
      metadata: this.metadata,
    };
  }
}

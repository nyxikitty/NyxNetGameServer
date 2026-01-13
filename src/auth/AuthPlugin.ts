import { AuthResult } from './AuthResult';

export interface AuthCredentials {
  [key: string]: any;
}

export interface UserData {
  userId: string;
  username: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export abstract class AuthPlugin {
  readonly name: string;
  readonly appId: string;

  constructor(name: string, appId: string) {
    this.name = name;
    this.appId = appId;
  }

  abstract authenticate(credentials: AuthCredentials): Promise<AuthResult>;

  abstract verifyToken(token: string): Promise<UserData>;

  abstract generateToken(userData: UserData): Promise<string>;

  async handleRPC(method: string, _params: any): Promise<any> {
    throw new Error(`Unknown RPC method: ${method}`);
  }
}
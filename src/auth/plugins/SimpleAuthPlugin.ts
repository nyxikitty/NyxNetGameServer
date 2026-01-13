import { AuthPlugin, AuthCredentials, UserData } from '../AuthPlugin';
import { AuthResult } from '../AuthResult';
import { createHash, randomBytes } from 'crypto';

interface SimpleUser {
  userId: string;
  username: string;
  password: string;
  createdAt: number;
  metadata: Record<string, any>;
}

interface TokenData {
  userId: string;
  username: string;
  expiresAt: number;
}

export class SimpleAuthPlugin extends AuthPlugin {
  private users: Map<string, SimpleUser> = new Map();
  private tokens: Map<string, TokenData> = new Map();

  constructor() {
    super('SimpleAuth', 'simple-auth-v1');
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const { username, password } = credentials;

    if (!username || !password) {
      return AuthResult.failure('Username and password required');
    }

    const user = this.users.get(username);
    
    if (!user) {
      // Auto-register new user
      const userId = this.generateUserId();
      const hashedPassword = this.hashPassword(password);
      
      const newUser: SimpleUser = {
        userId,
        username,
        password: hashedPassword,
        createdAt: Date.now(),
        metadata: {},
      };
      
      this.users.set(username, newUser);
      const token = await this.generateToken(newUser);
      
      return AuthResult.success({
        userId,
        username,
        token,
        metadata: { newUser: true },
      });
    }

    const hashedPassword = this.hashPassword(password);
    if (user.password !== hashedPassword) {
      return AuthResult.failure('Invalid password');
    }

    const token = await this.generateToken(user);

    return AuthResult.success({
      userId: user.userId,
      username: user.username,
      token,
      metadata: user.metadata,
    });
  }

  async verifyToken(token: string): Promise<UserData> {
    const userData = this.tokens.get(token);
    if (!userData) {
      throw new Error('Invalid token');
    }

    if (Date.now() > userData.expiresAt) {
      this.tokens.delete(token);
      throw new Error('Token expired');
    }

    return userData;
  }

  async generateToken(userData: UserData): Promise<string> {
    const token = randomBytes(32).toString('hex');
    
    this.tokens.set(token, {
      userId: userData.userId,
      username: userData.username,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });

    return token;
  }

  private generateUserId(): string {
    return `user_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  async handleRPC(method: string, params: any): Promise<any> {
    switch (method) {
      case 'getUser':
        return this.handleGetUser(params);
      case 'updateMetadata':
        return this.handleUpdateMetadata(params);
      default:
        return super.handleRPC(method, params);
    }
  }

  private async handleGetUser(params: any): Promise<any> {
    const { username } = params;
    const user = this.users.get(username);
    
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    return {
      success: true,
      user: {
        userId: user.userId,
        username: user.username,
        metadata: user.metadata,
        createdAt: user.createdAt,
      },
    };
  }

  private async handleUpdateMetadata(params: any): Promise<any> {
    const { username, metadata } = params;
    const user = this.users.get(username);
    
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    user.metadata = { ...user.metadata, ...metadata };
    return { success: true };
  }
}

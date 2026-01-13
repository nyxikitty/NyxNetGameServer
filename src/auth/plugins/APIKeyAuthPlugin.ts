import { AuthPlugin, AuthCredentials, UserData } from '../AuthPlugin';
import { AuthResult } from '../AuthResult';
import { randomBytes } from 'crypto';

interface APIKeyData {
  apiKey: string;
  appId: string;
  appName: string;
  userId: string;
  username: string;
  permissions: string[];
  rateLimit: number;
  requestCount: number;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

interface AppData {
  appId: string;
  name: string;
  keys: string[];
  createdAt: number;
}

interface CreateKeyConfig {
  appName?: string;
  userId?: string;
  username?: string;
  permissions?: string[];
  rateLimit?: number;
}

export class APIKeyAuthPlugin extends AuthPlugin {
  private apiKeys: Map<string, APIKeyData> = new Map();
  private apps: Map<string, AppData> = new Map();

  constructor() {
    super('APIKey', 'apikey-v1');
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const { apiKey, appId } = credentials;

    if (!apiKey || !appId) {
      return AuthResult.failure('API key and App ID required');
    }

    const keyData = this.apiKeys.get(apiKey);
    
    if (!keyData) {
      return AuthResult.failure('Invalid API key');
    }

    if (keyData.appId !== appId) {
      return AuthResult.failure('API key does not match App ID');
    }

    if (keyData.revokedAt) {
      return AuthResult.failure('API key has been revoked');
    }

    if (keyData.requestCount > keyData.rateLimit) {
      return AuthResult.failure('Rate limit exceeded');
    }

    keyData.requestCount++;
    keyData.lastUsedAt = Date.now();

    return AuthResult.success({
      userId: keyData.userId,
      username: keyData.username,
      token: apiKey,
      metadata: {
        appId,
        appName: keyData.appName,
        permissions: keyData.permissions,
      },
    });
  }

  async verifyToken(token: string): Promise<UserData> {
    const keyData = this.apiKeys.get(token);
    if (!keyData || keyData.revokedAt) {
      throw new Error('Invalid or revoked API key');
    }
    return keyData;
  }

  async generateToken(_userData: UserData): Promise<string> {
    throw new Error('Use createAPIKey() to generate API keys');
  }

  createAPIKey(appId: string, config: CreateKeyConfig = {}): {
    apiKey: string;
    appId: string;
    appName: string;
    permissions: string[];
  } {
    const apiKey = `ak_${randomBytes(32).toString('hex')}`;
    
    const keyData: APIKeyData = {
      apiKey,
      appId,
      appName: config.appName || `App ${appId}`,
      userId: config.userId || `app_${appId}`,
      username: config.username || `${appId}_user`,
      permissions: config.permissions || ['read', 'write'],
      rateLimit: config.rateLimit || 1000,
      requestCount: 0,
      createdAt: Date.now(),
      lastUsedAt: null,
      revokedAt: null,
    };

    this.apiKeys.set(apiKey, keyData);
    
    if (!this.apps.has(appId)) {
      this.apps.set(appId, {
        appId,
        name: keyData.appName,
        keys: [apiKey],
        createdAt: Date.now(),
      });
    } else {
      this.apps.get(appId)!.keys.push(apiKey);
    }

    return {
      apiKey,
      appId,
      appName: keyData.appName,
      permissions: keyData.permissions,
    };
  }

  revokeAPIKey(apiKey: string): void {
    const keyData = this.apiKeys.get(apiKey);
    if (keyData) {
      keyData.revokedAt = Date.now();
    }
  }

  async handleRPC(method: string, params: any): Promise<any> {
    switch (method) {
      case 'createKey':
        return this.handleCreateKey(params);
      case 'revokeKey':
        return this.handleRevokeKey(params);
      case 'listKeys':
        return this.handleListKeys(params);
      default:
        return super.handleRPC(method, params);
    }
  }

  private async handleCreateKey(params: any): Promise<any> {
    const { appId, appName, permissions, rateLimit } = params;
    
    if (!appId) {
      return { success: false, error: 'appId required' };
    }

    const keyInfo = this.createAPIKey(appId, {
      appName,
      permissions,
      rateLimit,
    });

    return { success: true, ...keyInfo };
  }

  private async handleRevokeKey(params: any): Promise<any> {
    const { apiKey } = params;
    this.revokeAPIKey(apiKey);
    return { success: true };
  }

  private async handleListKeys(params: any): Promise<any> {
    const { appId } = params;
    const app = this.apps.get(appId);
    
    if (!app) {
      return { success: false, error: 'App not found' };
    }

    const keys = app.keys.map((key) => {
      const keyData = this.apiKeys.get(key)!;
      return {
        apiKey: key,
        appName: keyData.appName,
        permissions: keyData.permissions,
        requestCount: keyData.requestCount,
        createdAt: keyData.createdAt,
        lastUsedAt: keyData.lastUsedAt,
        revoked: !!keyData.revokedAt,
      };
    });

    return { success: true, keys };
  }
}
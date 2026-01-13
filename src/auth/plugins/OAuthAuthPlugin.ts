import { AuthPlugin, AuthCredentials, UserData } from '../AuthPlugin';
import { AuthResult } from '../AuthResult';
import { randomBytes } from 'crypto';

interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
}

interface AuthCode {
  user: UserData;
  expiresAt: number;
}

interface AccessToken {
  userId: string;
  username: string;
  type: string;
  expiresAt: number;
}

export class OAuthAuthPlugin extends AuthPlugin {
  private clientId: string;
  private clientSecret: string;
  private accessTokens: Map<string, AccessToken> = new Map();
  private authCodes: Map<string, AuthCode> = new Map();

  constructor(config: OAuthConfig = {}) {
    super('OAuth', 'oauth-v1');
    this.clientId = config.clientId || 'default-client-id';
    this.clientSecret = config.clientSecret || 'default-secret';
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const { grant_type } = credentials;

    if (grant_type === 'authorization_code') {
      return this.handleAuthCodeGrant(credentials);
    } else if (grant_type === 'client_credentials') {
      return this.handleClientCredentials(credentials);
    } else {
      return AuthResult.failure('Unsupported grant_type');
    }
  }

  private async handleAuthCodeGrant(
    credentials: AuthCredentials
  ): Promise<AuthResult> {
    const { code } = credentials;
    
    const authCode = this.authCodes.get(code);
    if (!authCode) {
      return AuthResult.failure('Invalid authorization code');
    }

    if (Date.now() > authCode.expiresAt) {
      this.authCodes.delete(code);
      return AuthResult.failure('Authorization code expired');
    }

    const accessToken = await this.generateToken(authCode.user);
    this.authCodes.delete(code);

    return AuthResult.success({
      userId: authCode.user.userId,
      username: authCode.user.username,
      token: accessToken,
      metadata: { grant_type: 'authorization_code' },
    });
  }

  private async handleClientCredentials(
    credentials: AuthCredentials
  ): Promise<AuthResult> {
    const { client_id, client_secret } = credentials;

    if (client_id !== this.clientId || client_secret !== this.clientSecret) {
      return AuthResult.failure('Invalid client credentials');
    }

    const serviceUser: UserData = {
      userId: `service_${Date.now()}`,
      username: `service_${client_id}`,
      type: 'service',
    };

    const accessToken = await this.generateToken(serviceUser);

    return AuthResult.success({
      userId: serviceUser.userId,
      username: serviceUser.username,
      token: accessToken,
      metadata: { grant_type: 'client_credentials', type: 'service' },
    });
  }

  async verifyToken(token: string): Promise<UserData> {
    const tokenData = this.accessTokens.get(token);
    if (!tokenData) {
      throw new Error('Invalid access token');
    }

    if (Date.now() > tokenData.expiresAt) {
      this.accessTokens.delete(token);
      throw new Error('Access token expired');
    }

    return tokenData;
  }

  async generateToken(userData: UserData): Promise<string> {
    const token = `oauth_${randomBytes(32).toString('hex')}`;
    
    this.accessTokens.set(token, {
      userId: userData.userId,
      username: userData.username,
      type: userData.type || 'user',
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    return token;
  }

  createAuthCode(user: UserData): string {
    const code = randomBytes(16).toString('hex');
    
    this.authCodes.set(code, {
      user,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    return code;
  }

  async handleRPC(method: string, params: any): Promise<any> {
    switch (method) {
      case 'authorize':
        return this.handleAuthorize(params);
      case 'refreshToken':
        return this.handleRefreshToken(params);
      default:
        return super.handleRPC(method, params);
    }
  }

  private async handleAuthorize(params: any): Promise<any> {
    const { username, client_id, redirect_uri } = params;

    if (client_id !== this.clientId) {
      return { success: false, error: 'Invalid client_id' };
    }

    const user: UserData = {
      userId: `user_${Date.now()}`,
      username,
    };

    const code = this.createAuthCode(user);

    return {
      success: true,
      code,
      redirect_uri: redirect_uri || 'http://localhost:3000/callback',
    };
  }

  private async handleRefreshToken(_params: any): Promise<any> {
    return { success: false, error: 'Not implemented' };
  }
}
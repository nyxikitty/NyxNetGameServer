export interface AuthData {
  userId?: string;
  username?: string;
  metadata?: Record<string, any>;
  token?: string;
}

export class AuthResult {
  readonly success: boolean;
  readonly userId: string | null;
  readonly username: string | null;
  readonly metadata: Record<string, any>;
  readonly token: string | null;
  readonly error: string | null;

  constructor(success: boolean, data: AuthData = {}, error: string | null = null) {
    this.success = success;
    this.userId = data.userId || null;
    this.username = data.username || null;
    this.metadata = data.metadata || {};
    this.token = data.token || null;
    this.error = error;
  }

  static success(data: AuthData): AuthResult {
    return new AuthResult(true, data);
  }

  static failure(error: string): AuthResult {
    return new AuthResult(false, {}, error);
  }
}

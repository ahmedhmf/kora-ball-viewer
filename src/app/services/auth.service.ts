import { Injectable, signal } from '@angular/core';
import { environment } from '@env';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly SESSION_KEY = 'kora_visualizer_auth';

  // Reactive signal for authentication status
  readonly isAuthenticated = signal<boolean>(this.checkExistingSession());

  constructor() {}

  private checkExistingSession(): boolean {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return false;
    }
    return sessionStorage.getItem(this.SESSION_KEY) === 'authenticated';
  }

  /**
   * Cryptographically hashes input password using SHA-256 and compares it
   * against the environment target hash and fallback defaults.
   */
  async verifyPassword(inputPassword: string): Promise<boolean> {
    if (!inputPassword || typeof inputPassword !== 'string') {
      return false;
    }

    try {
      const rawInput = inputPassword;
      const trimmedInput = inputPassword.trim();
      
      // Stripped quotes input if user typed quotes
      let unquotedInput = trimmedInput;
      if ((unquotedInput.startsWith('"') && unquotedInput.endsWith('"')) || (unquotedInput.startsWith("'") && unquotedInput.endsWith("'"))) {
        unquotedInput = unquotedInput.slice(1, -1).trim();
      }

      // Compute hashes
      const hashTrimmed = await this.hashSHA256(trimmedInput);
      const hashRaw = await this.hashSHA256(rawInput);
      const hashUnquoted = await this.hashSHA256(unquotedInput);

      const targetHash = (environment as any).passwordHash?.toLowerCase() || '';
      const defaultHash = (environment as any).defaultHash?.toLowerCase() || 'd602aa475e6b1b662d94cbe37f6f95e7b161e19c4c0a874dd664e01d80c3c247';

      const hashesToTest = [hashTrimmed, hashRaw, hashUnquoted];
      const validHashes = [targetHash, defaultHash].filter(Boolean);

      const isValid = hashesToTest.some((h) => validHashes.includes(h.toLowerCase()));

      if (isValid) {
        this.grantAccess();
        return true;
      }

      return false;
    } catch (err) {
      console.error('Password verification error:', err);
      return false;
    }
  }

  private grantAccess(): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.setItem(this.SESSION_KEY, 'authenticated');
    }
    this.isAuthenticated.set(true);
  }

  /**
   * Locks the application and clears session storage.
   */
  lock(): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.removeItem(this.SESSION_KEY);
    }
    this.isAuthenticated.set(false);
  }

  /**
   * Helper function to compute SHA-256 hash string using Web Crypto API.
   */
  private async hashSHA256(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

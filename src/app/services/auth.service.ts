import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

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
   * against the environment configured target hash.
   */
  async verifyPassword(inputPassword: string): Promise<boolean> {
    if (!inputPassword || typeof inputPassword !== 'string') {
      return false;
    }

    try {
      const hashHex = await this.hashSHA256(inputPassword.trim());
      const isValid = hashHex.toLowerCase() === environment.passwordHash.toLowerCase();

      if (isValid) {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          sessionStorage.setItem(this.SESSION_KEY, 'authenticated');
        }
        this.isAuthenticated.set(true);
      }

      return isValid;
    } catch (err) {
      console.error('Password verification error:', err);
      return false;
    }
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

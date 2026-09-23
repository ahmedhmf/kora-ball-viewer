import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-lock-screen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lock-screen.component.html',
  styleUrl: './lock-screen.component.scss',
})
export class LockScreenComponent {
  @ViewChild('passwordInput') passwordInput!: ElementRef<HTMLInputElement>;

  private authService = inject(AuthService);

  password = '';
  showPassword = false;
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  isShaking = signal(false);

  // Rate limiting anti-brute-force state
  failedAttempts = 0;
  isLockedOut = signal(false);
  cooldownSeconds = signal(0);
  private cooldownTimer: any = null;

  toggleShowPassword(): void {
    this.showPassword = !this.showPassword;
  }

  async onSubmit(): Promise<void> {
    if (this.isLockedOut() || this.isLoading() || !this.password.trim()) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    // Short artificial delay for smooth UX
    await new Promise((res) => setTimeout(res, 300));

    const success = await this.authService.verifyPassword(this.password);
    this.isLoading.set(false);

    if (success) {
      this.password = '';
      this.failedAttempts = 0;
    } else {
      this.failedAttempts++;
      this.triggerShake();

      if (this.failedAttempts >= 4) {
        this.startCooldown(10);
      } else {
        this.errorMessage.set('Incorrect password. Access denied.');
      }
    }
  }

  private triggerShake(): void {
    this.isShaking.set(true);
    setTimeout(() => {
      this.isShaking.set(false);
    }, 500);
  }

  private startCooldown(seconds: number): void {
    this.isLockedOut.set(true);
    this.cooldownSeconds.set(seconds);
    this.errorMessage.set(`Too many failed attempts. Cooldown active.`);

    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
    }

    this.cooldownTimer = setInterval(() => {
      const remaining = this.cooldownSeconds() - 1;
      if (remaining <= 0) {
        clearInterval(this.cooldownTimer);
        this.isLockedOut.set(false);
        this.cooldownSeconds.set(0);
        this.errorMessage.set(null);
        this.failedAttempts = 0;
        setTimeout(() => this.passwordInput?.nativeElement?.focus(), 100);
      } else {
        this.cooldownSeconds.set(remaining);
      }
    }, 1000);
  }
}

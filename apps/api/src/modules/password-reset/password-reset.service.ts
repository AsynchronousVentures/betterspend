import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import bcryptjs from 'bcryptjs';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { authAccounts, passwordResetTokens } from '@betterspend/db';
import { MailService } from '../../common/mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { DEFAULT_SETTINGS } from '@betterspend/shared';

const SALT_ROUNDS = 12;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
  ) {}

  async requestReset(email: string): Promise<{ success: boolean }> {
    // Always return success to avoid leaking whether email exists
    try {
      const user = await this.db.query.users.findFirst({
        where: (u, { eq }) => eq(u.email, email.toLowerCase().trim()),
      });

      if (!user) {
        return { success: true };
      }

      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await this.db.insert(passwordResetTokens).values({
        userId: user.id,
        token,
        expiresAt,
      });

      // Send email (fire-and-forget — don't block response on SMTP)
      const settings: Record<string, string> = user.organizationId
        ? await this.settingsService.getAll(user.organizationId)
        : DEFAULT_SETTINGS;
      const appName = settings['app_name'] || 'BetterSpend';
      const appUrl = settings['app_url'] || process.env['WEB_URL'] || 'http://localhost:3100';
      const smtpHost = settings['smtp_host'] || '';
      const resetLink = `${appUrl}/reset-password?token=${token}`;

      if (smtpHost) {
        const smtpConfig = {
          host: smtpHost,
          port: parseInt(settings['smtp_port'] || '587', 10),
          secure: settings['smtp_secure'] === 'true',
          user: settings['smtp_user'] || '',
          pass: settings['smtp_pass'] || '',
          from: settings['smtp_from'] || `noreply@${smtpHost}`,
          targetPolicy: 'public-only' as const,
        };

        this.mailService
          .sendMail(smtpConfig, {
            to: user.email,
            subject: `[${appName}] Password Reset Request`,
            html: `
              <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
                <h2 style="color:#0f172a">Password Reset Request</h2>
                <p>Hi ${user.name},</p>
                <p>We received a request to reset the password for your ${appName} account.</p>
                <p>Click the button below to reset your password. This link expires in 1 hour.</p>
                <a href="${resetLink}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0">Reset Password</a>
                <p style="color:#64748b;font-size:13px">If you did not request a password reset, you can safely ignore this email.</p>
                <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
                <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
              </div>
            `,
            text: `Password Reset\n\nHi ${user.name},\n\nClick here to reset your password:\n${resetLink}\n\nThis link expires in 1 hour.\n\nIf you did not request a password reset, ignore this email.`,
          })
          .catch((err) => this.logger.error(`Failed to send reset email: ${err}`));
      } else {
        this.logger.log(`Password reset token for ${email}: ${resetLink}`);
      }
    } catch (err) {
      this.logger.error(`requestReset error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { success: true };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const resetToken = await this.db.query.passwordResetTokens.findFirst({
      where: (t, { and, eq, gt }) =>
        and(eq(t.token, token), eq(t.used, false), gt(t.expiresAt, new Date())),
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcryptjs.hash(newPassword, SALT_ROUNDS);

    // Update password in authAccounts (where better-auth stores email+password hashes)
    await this.db
      .update(authAccounts)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(
        and(eq(authAccounts.userId, resetToken.userId), eq(authAccounts.providerId, 'credential')),
      );

    // Mark token as used
    await this.db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.id, resetToken.id));

    this.logger.log(`Password reset successful for userId: ${resetToken.userId}`);
    return { success: true };
  }
}

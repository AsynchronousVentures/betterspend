import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, like } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { Db } from '@betterspend/db';
import { authAccounts, authVerifications, users } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { SettingsService } from '../settings/settings.service';
import { MailService } from '../../common/mail/mail.service';
import { StorageService } from '../../common/storage/storage.service';
import { AUTH_INSTANCE } from '../auth/auth.tokens';
import type { AuthInstance } from '../../auth/auth.instance';

type PendingEmailChange = {
  token: string;
  newEmail: string;
  oldEmail: string;
};

const EMAIL_CHANGE_PREFIX = 'account:email-change:';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
    private readonly settingsService: SettingsService,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
  ) {}

  async getMe(userId: string) {
    const user = await this.findUser(userId);
    return this.serializeAccount(user);
  }

  async updateMe(userId: string, body: { name?: string }) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Display name is required');

    await this.db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return this.getMe(userId);
  }

  async changePassword(authHeader: string | undefined, body: { currentPassword: string; newPassword: string }) {
    const request = new Request(`${process.env.API_URL || `http://localhost:${process.env.API_PORT || 4001}`}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
    });
    const response = await this.auth.handler(request);
    const payload = await response.json().catch(() => ({ message: 'Failed to change password' }));
    if (!response.ok) {
      throw new HttpException(payload?.message || 'Failed to change password', response.status || HttpStatus.BAD_REQUEST);
    }
    return payload;
  }

  async requestEmailChange(userId: string, nextEmailRaw: string) {
    const user = await this.findUser(userId);
    const nextEmail = nextEmailRaw.trim().toLowerCase();

    if (!this.isValidEmail(nextEmail)) {
      throw new BadRequestException('Enter a valid email address');
    }
    if (nextEmail === user.email.toLowerCase()) {
      throw new BadRequestException('New email must be different from the current email');
    }

    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, nextEmail),
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Email is already in use');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const identifier = this.pendingIdentifier(userId);

    await this.db.delete(authVerifications).where(eq(authVerifications.identifier, identifier));
    await this.db.insert(authVerifications).values({
      id: randomUUID(),
      identifier,
      value: JSON.stringify({ token, newEmail: nextEmail, oldEmail: user.email } satisfies PendingEmailChange),
      expiresAt,
    });

    await this.sendEmailChangeVerification(user, nextEmail, token);

    return {
      success: true,
      pendingEmail: nextEmail,
      pendingEmailExpiresAt: expiresAt.toISOString(),
    };
  }

  async verifyEmailChange(token: string) {
    if (!token) throw new BadRequestException('Verification token is required');

    const candidates = await this.db.query.authVerifications.findMany({
      where: (verification, { and, like, gt }) =>
        and(
          like(verification.identifier, `${EMAIL_CHANGE_PREFIX}%`),
          gt(verification.expiresAt, new Date()),
        ),
    });

    const match = candidates.find((candidate) => {
      try {
        const parsed = JSON.parse(candidate.value) as PendingEmailChange;
        return parsed.token === token;
      } catch {
        return false;
      }
    });

    if (!match) {
      throw new BadRequestException('Invalid or expired email verification token');
    }

    const pending = JSON.parse(match.value) as PendingEmailChange;
    const userId = match.identifier.replace(EMAIL_CHANGE_PREFIX, '');
    const user = await this.findUser(userId);
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, pending.newEmail) });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Email is already in use');
    }

    await this.db
      .update(users)
      .set({
        email: pending.newEmail,
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await this.db
      .update(authAccounts)
      .set({ accountId: pending.newEmail, updatedAt: new Date() })
      .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, 'credential')));

    await this.db.delete(authVerifications).where(eq(authVerifications.id, match.id));

    return {
      success: true,
      email: pending.newEmail,
      name: user.name,
    };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Avatar must be an image');
    }

    const user = await this.findUser(userId);
    if (user.image && !this.isRemoteUrl(user.image)) {
      await this.storageService.delete(user.image).catch(() => {});
    }

    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    const key = `avatars/${userId}/${Date.now()}-${safeName}`;
    await this.storageService.upload(key, file.buffer, file.mimetype);

    await this.db
      .update(users)
      .set({ image: key, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return this.getMe(userId);
  }

  async removeAvatar(userId: string) {
    const user = await this.findUser(userId);
    if (user.image && !this.isRemoteUrl(user.image)) {
      await this.storageService.delete(user.image).catch(() => {});
    }

    await this.db
      .update(users)
      .set({ image: null, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return this.getMe(userId);
  }

  private async findUser(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async serializeAccount(user: typeof users.$inferSelect) {
    const pending = await this.db.query.authVerifications.findFirst({
      where: (verification, { and, eq, gt }) =>
        and(
          eq(verification.identifier, this.pendingIdentifier(user.id)),
          gt(verification.expiresAt, new Date()),
        ),
    });

    let pendingEmail: string | null = null;
    let pendingEmailExpiresAt: string | null = null;
    if (pending) {
      try {
        const parsed = JSON.parse(pending.value) as PendingEmailChange;
        pendingEmail = parsed.newEmail;
        pendingEmailExpiresAt = pending.expiresAt.toISOString();
      } catch {
        pendingEmail = null;
        pendingEmailExpiresAt = null;
      }
    }

    return {
      name: user.name,
      email: user.email,
      avatarUrl: await this.resolveAvatarUrl(user.image, user.email),
      hasCustomImage: Boolean(user.image),
      pendingEmail,
      pendingEmailExpiresAt,
    };
  }

  private async resolveAvatarUrl(image: string | null, email: string) {
    if (!image) return this.gravatarUrl(email);
    if (this.isRemoteUrl(image)) return image;
    try {
      return await this.storageService.getPresignedUrl(image);
    } catch {
      return this.gravatarUrl(email);
    }
  }

  private gravatarUrl(email: string) {
    const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
    return `https://www.gravatar.com/avatar/${hash}?d=mp&s=160`;
  }

  private isRemoteUrl(value: string) {
    return value.startsWith('http://') || value.startsWith('https://');
  }

  private pendingIdentifier(userId: string) {
    return `${EMAIL_CHANGE_PREFIX}${userId}`;
  }

  private isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private async sendEmailChangeVerification(
    user: typeof users.$inferSelect,
    nextEmail: string,
    token: string,
  ) {
    const settings = await this.settingsService.getAll(user.organizationId);
    const appName = settings['app_name'] || 'BetterSpend';
    const appUrl = settings['app_url'] || process.env['WEB_URL'] || 'http://localhost:3100';
    const smtpHost = settings['smtp_host'] || '';
    const verifyLink = `${appUrl}/account/verify-email?token=${token}`;

    if (!smtpHost) {
      this.logger.log(`Email change verification for ${nextEmail}: ${verifyLink}`);
      return;
    }

    const smtpConfig = {
      host: smtpHost,
      port: parseInt(settings['smtp_port'] || '587', 10),
      secure: settings['smtp_secure'] === 'true',
      user: settings['smtp_user'] || '',
      pass: settings['smtp_pass'] || '',
      from: settings['smtp_from'] || `noreply@${smtpHost}`,
    };

    await this.mailService.sendMail(smtpConfig, {
      to: nextEmail,
      subject: `[${appName}] Confirm your new email address`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0f172a">Confirm your new email</h2>
          <p>Hi ${user.name},</p>
          <p>We received a request to change the email address on your ${appName} account to <strong>${nextEmail}</strong>.</p>
          <p>Click the button below to confirm the change.</p>
          <a href="${verifyLink}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0">Verify Email Change</a>
          <p style="color:#64748b;font-size:13px">If you did not request this change, you can ignore this email.</p>
        </div>
      `,
      text: `Confirm your new email\n\nHi ${user.name},\n\nVerify your email change here:\n${verifyLink}\n\nIf you did not request this change, you can ignore this email.`,
    });
  }
}

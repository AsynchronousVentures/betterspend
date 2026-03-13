import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

// QBO OAuth 2.0 endpoints
const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// Xero OAuth 2.0 endpoints
const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(private readonly settingsService: SettingsService) {}

  private get apiUrl(): string {
    return process.env.API_URL || 'http://localhost:4001';
  }

  // Build OAuth authorize URL for QBO
  getQboAuthUrl(organizationId: string): string {
    const clientId = process.env.QBO_CLIENT_ID || '';
    const redirectUri = `${this.apiUrl}/api/v1/gl/oauth/qbo/callback`;
    const state = Buffer.from(JSON.stringify({ organizationId })).toString('base64');
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `${QBO_AUTH_URL}?${params}`;
  }

  // Build OAuth authorize URL for Xero
  getXeroAuthUrl(organizationId: string): string {
    const clientId = process.env.XERO_CLIENT_ID || '';
    const redirectUri = `${this.apiUrl}/api/v1/gl/oauth/xero/callback`;
    const state = Buffer.from(JSON.stringify({ organizationId })).toString('base64');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'accounting.transactions accounting.contacts accounting.settings offline_access',
      state,
    });
    return `${XERO_AUTH_URL}?${params}`;
  }

  // Exchange auth code for tokens (QBO)
  async exchangeQboCode(organizationId: string, code: string, realmId: string): Promise<void> {
    const clientId = process.env.QBO_CLIENT_ID || '';
    const clientSecret = process.env.QBO_CLIENT_SECRET || '';
    const redirectUri = `${this.apiUrl}/api/v1/gl/oauth/qbo/callback`;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post(
      QBO_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      },
    );

    await this.settingsService.updateMany(organizationId, {
      qbo_access_token: res.data.access_token,
      qbo_refresh_token: res.data.refresh_token,
      qbo_realm_id: realmId,
      qbo_token_expires_at: String(Date.now() + (res.data.expires_in as number) * 1000),
      qbo_connected: 'true',
    });

    this.logger.log(`QBO OAuth tokens stored for org ${organizationId}, realmId=${realmId}`);
  }

  // Exchange auth code for tokens (Xero)
  async exchangeXeroCode(organizationId: string, code: string): Promise<void> {
    const clientId = process.env.XERO_CLIENT_ID || '';
    const clientSecret = process.env.XERO_CLIENT_SECRET || '';
    const redirectUri = `${this.apiUrl}/api/v1/gl/oauth/xero/callback`;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post(
      XERO_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    // Get Xero tenant ID from connections list
    let tenantId = '';
    try {
      const connectionsRes = await axios.get<Array<{ tenantId: string }>>('https://api.xero.com/connections', {
        headers: { Authorization: `Bearer ${res.data.access_token as string}` },
      });
      tenantId = connectionsRes.data?.[0]?.tenantId ?? '';
    } catch (err) {
      this.logger.warn(`Could not fetch Xero tenant ID: ${String(err)}`);
    }

    await this.settingsService.updateMany(organizationId, {
      xero_access_token: res.data.access_token,
      xero_refresh_token: res.data.refresh_token,
      xero_tenant_id: tenantId,
      xero_token_expires_at: String(Date.now() + (res.data.expires_in as number) * 1000),
      xero_connected: 'true',
    });

    this.logger.log(`Xero OAuth tokens stored for org ${organizationId}, tenantId=${tenantId}`);
  }

  // Get valid QBO access token (refreshes if needed)
  async getQboToken(organizationId: string): Promise<{ accessToken: string; realmId: string } | null> {
    const all = await this.settingsService.getAll(organizationId);
    if (all['qbo_connected'] !== 'true') return null;

    const expiresAt = parseInt(all['qbo_token_expires_at'] ?? '0', 10);
    if (Date.now() > expiresAt - 60_000) {
      await this.refreshQboToken(organizationId, all['qbo_refresh_token'] ?? '');
      const fresh = await this.settingsService.getAll(organizationId);
      return { accessToken: fresh['qbo_access_token'] ?? '', realmId: fresh['qbo_realm_id'] ?? '' };
    }
    return { accessToken: all['qbo_access_token'] ?? '', realmId: all['qbo_realm_id'] ?? '' };
  }

  // Get valid Xero access token (refreshes if needed)
  async getXeroToken(organizationId: string): Promise<{ accessToken: string; tenantId: string } | null> {
    const all = await this.settingsService.getAll(organizationId);
    if (all['xero_connected'] !== 'true') return null;

    const expiresAt = parseInt(all['xero_token_expires_at'] ?? '0', 10);
    if (Date.now() > expiresAt - 60_000) {
      await this.refreshXeroToken(organizationId, all['xero_refresh_token'] ?? '');
      const fresh = await this.settingsService.getAll(organizationId);
      return { accessToken: fresh['xero_access_token'] ?? '', tenantId: fresh['xero_tenant_id'] ?? '' };
    }
    return { accessToken: all['xero_access_token'] ?? '', tenantId: all['xero_tenant_id'] ?? '' };
  }

  private async refreshQboToken(organizationId: string, refreshToken: string): Promise<void> {
    const clientId = process.env.QBO_CLIENT_ID || '';
    const clientSecret = process.env.QBO_CLIENT_SECRET || '';
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post(
      QBO_TOKEN_URL,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      },
    );
    await this.settingsService.updateMany(organizationId, {
      qbo_access_token: res.data.access_token,
      qbo_refresh_token: res.data.refresh_token,
      qbo_token_expires_at: String(Date.now() + (res.data.expires_in as number) * 1000),
    });
    this.logger.log(`QBO tokens refreshed for org ${organizationId}`);
  }

  private async refreshXeroToken(organizationId: string, refreshToken: string): Promise<void> {
    const clientId = process.env.XERO_CLIENT_ID || '';
    const clientSecret = process.env.XERO_CLIENT_SECRET || '';
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post(
      XERO_TOKEN_URL,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
    await this.settingsService.updateMany(organizationId, {
      xero_access_token: res.data.access_token,
      xero_refresh_token: res.data.refresh_token,
      xero_token_expires_at: String(Date.now() + (res.data.expires_in as number) * 1000),
    });
    this.logger.log(`Xero tokens refreshed for org ${organizationId}`);
  }

  async disconnectQbo(organizationId: string): Promise<void> {
    await this.settingsService.updateMany(organizationId, {
      qbo_connected: 'false',
      qbo_access_token: '',
      qbo_refresh_token: '',
      qbo_realm_id: '',
      qbo_token_expires_at: '',
    });
    this.logger.log(`QBO disconnected for org ${organizationId}`);
  }

  async disconnectXero(organizationId: string): Promise<void> {
    await this.settingsService.updateMany(organizationId, {
      xero_connected: 'false',
      xero_access_token: '',
      xero_refresh_token: '',
      xero_tenant_id: '',
      xero_token_expires_at: '',
    });
    this.logger.log(`Xero disconnected for org ${organizationId}`);
  }

  async getConnectionStatus(organizationId: string): Promise<{
    qbo: boolean;
    xero: boolean;
    qboRealmId?: string;
    xeroTenantId?: string;
    qboConfigured: boolean;
    xeroConfigured: boolean;
    qboConnectionMode: 'platform';
    xeroConnectionMode: 'platform';
  }> {
    const all = await this.settingsService.getAll(organizationId);
    return {
      qbo: all['qbo_connected'] === 'true',
      xero: all['xero_connected'] === 'true',
      qboRealmId: all['qbo_realm_id'] || undefined,
      xeroTenantId: all['xero_tenant_id'] || undefined,
      qboConfigured: Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET),
      xeroConfigured: Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET),
      qboConnectionMode: 'platform',
      xeroConnectionMode: 'platform',
    };
  }
}

import { GlController } from './gl.controller';

describe('GlController Xero OAuth input boundary', () => {
  function setup() {
    const oauthService = {
      getXeroPendingTenants: jest.fn(async () => []),
      selectXeroTenant: jest.fn(async () => undefined),
    };
    const controller = new GlController({} as never, {} as never, oauthService as never);
    return { controller, oauthService };
  }

  it('parses and normalizes the pending-grant query before calling the service', async () => {
    const { controller, oauthService } = setup();

    await controller.getXeroConnections(
      { grantId: ' grant-1 ' },
      'organization-1',
      'user-1',
      'session-1',
    );

    expect(oauthService.getXeroPendingTenants).toHaveBeenCalledWith(
      'grant-1',
      'organization-1',
      'user-1',
      'session-1',
    );
  });

  it('rejects malformed grant and tenant input before service calls', async () => {
    const { controller, oauthService } = setup();

    expect(() =>
      controller.getXeroConnections({}, 'organization-1', 'user-1', 'session-1'),
    ).toThrow();
    expect(() =>
      controller.selectXeroConnection(
        { grantId: 'grant-1', tenantId: ['tenant-1'] },
        'organization-1',
        'user-1',
        'session-1',
      ),
    ).toThrow();
    expect(oauthService.getXeroPendingTenants).not.toHaveBeenCalled();
    expect(oauthService.selectXeroTenant).not.toHaveBeenCalled();
  });

  it('parses and normalizes the selected tenant body before calling the service', async () => {
    const { controller, oauthService } = setup();

    await controller.selectXeroConnection(
      { grantId: ' grant-1 ', tenantId: ' tenant-1 ' },
      'organization-1',
      'user-1',
      'session-1',
    );

    expect(oauthService.selectXeroTenant).toHaveBeenCalledWith(
      'grant-1',
      'tenant-1',
      'organization-1',
      'user-1',
      'session-1',
    );
  });
});

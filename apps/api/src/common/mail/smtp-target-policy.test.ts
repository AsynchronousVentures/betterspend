import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSafeSmtpTarget,
  SmtpTargetPolicyError,
  type SmtpDnsLookup,
} from './smtp-target-policy';

const unexpectedLookup: SmtpDnsLookup = async () => {
  throw new Error('literal IP addresses must not use DNS');
};

test('SMTP target policy rejects literal private and metadata addresses', async () => {
  for (const host of ['127.0.0.1', '169.254.169.254', '[::1]', '::ffff:169.254.169.254']) {
    await assert.rejects(resolveSafeSmtpTarget(host, 587, unexpectedLookup), SmtpTargetPolicyError);
  }
});

test('SMTP target policy normalizes a public hostname and returns a pinned address', async () => {
  let lookupHostname = '';
  const target = await resolveSafeSmtpTarget(' SMTP.Example.COM. ', 587, async (hostname) => {
    lookupHostname = hostname;
    return [
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '93.184.216.34', family: 4 },
    ];
  });

  assert.equal(lookupHostname, 'smtp.example.com');
  assert.deepEqual(target, {
    hostname: 'smtp.example.com',
    address: '93.184.216.34',
    family: 4,
    port: 587,
  });
});

test('SMTP target policy rejects empty, malformed, and mixed DNS answer sets', async () => {
  const answerSets = [
    [],
    [{ address: 'not-an-ip', family: 4 as const }],
    [{ address: '93.184.216.34', family: 6 as const }],
    [
      { address: '93.184.216.34', family: 4 as const },
      { address: '10.0.0.8', family: 4 as const },
    ],
    [
      { address: '2606:4700:4700::1111', family: 6 as const },
      { address: '::ffff:169.254.169.254', family: 6 as const },
    ],
  ];

  for (const answers of answerSets) {
    await assert.rejects(
      resolveSafeSmtpTarget('smtp.example.com', 587, async () => answers),
      SmtpTargetPolicyError,
    );
  }
});

test('SMTP target policy permits only standard SMTP relay and submission ports', async () => {
  for (const port of [25, 465, 587, 2525]) {
    const target = await resolveSafeSmtpTarget('93.184.216.34', port, unexpectedLookup);
    assert.equal(target.port, port);
  }

  for (const port of [0, 443, 1025, 65536, 587.5, Number.NaN]) {
    await assert.rejects(
      resolveSafeSmtpTarget('93.184.216.34', port, unexpectedLookup),
      SmtpTargetPolicyError,
    );
  }
});

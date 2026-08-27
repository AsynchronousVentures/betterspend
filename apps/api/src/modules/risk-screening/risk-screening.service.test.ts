import assert from 'node:assert/strict';
import test from 'node:test';
import { createSanctionsRequestOptions, parseSdnCsv } from './risk-screening.service';

const sanctionsUrl = new URL('https://sanctionslistservice.ofac.treas.gov/api/download/SDN.CSV');
const pinned = {
  address: '93.184.216.34',
  family: 4,
} satisfies Parameters<typeof createSanctionsRequestOptions>[1];

test('returns the pinned address array when Node requests all lookup results', async () => {
  const lookup = createSanctionsRequestOptions(sanctionsUrl, pinned).lookup;
  assert.ok(lookup);

  await new Promise<void>((resolve, reject) => {
    lookup('sanctionslistservice.ofac.treas.gov', { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      assert.deepEqual(addresses, [pinned]);
      resolve();
    });
  });
});

test('identifies BetterSpend to the OFAC download endpoint', () => {
  const options = createSanctionsRequestOptions(sanctionsUrl, pinned);

  assert.deepEqual(options.headers, {
    Accept: 'text/csv',
    'User-Agent': 'BetterSpend-Sanctions-Ingest/1.0',
  });
});

test('accepts numeric vessel names and ignores the OFAC end-of-file marker', () => {
  const csv =
    '23156,"7-28","vessel","IRAN-EO13902",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \r\n\x1A';

  const result = parseSdnCsv(csv);

  assert.equal(result.skipped, 0);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.externalId, '23156');
  assert.equal(result.entries[0]?.entityName, '7-28');
  assert.equal(result.entries[0]?.entryType, 'vessel');
});

import { createHash } from 'node:crypto';
import { contractClauses, contractExtractions } from '@betterspend/db';
import JSZip from 'jszip';
import { ContractsService } from './contracts.service';
import {
  ContractDocumentExtractionError,
  ContractDocumentExtractorService,
} from './contract-document-extractor';

const organizationId = '00000000-0000-4000-8000-000000000001';
const contractId = '00000000-0000-4000-8000-000000000002';
const obligationId = '00000000-0000-4000-8000-000000000003';
const ownerId = '00000000-0000-4000-8000-000000000004';
const extractionId = '00000000-0000-4000-8000-000000000007';

function selectQuery(rows: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        for: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe('ContractsService obligation input validation', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an invalid notification lead day value: %s',
    async (notificationLeadDays) => {
      const transaction = jest.fn();
      const service = new ContractsService(
        { transaction } as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.updateObligation('contract-1', 'org-1', 'user-1', 'obligation-1', {
          notificationLeadDays,
        } as never),
      ).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});

it('rejects a non-string intelligence documentId at the runtime request boundary', async () => {
  const findFirst = jest.fn();
  const service = new ContractsService(
    { query: { contracts: { findFirst } } } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await expect(
    service.processIntelligence(contractId, organizationId, ownerId, {
      documentId: { forged: true },
    } as never),
  ).rejects.toMatchObject({ status: 400 });
  expect(findFirst).not.toHaveBeenCalled();
});

it('rejects an obligation owner that is not a user in the contract organization', async () => {
  const lockedContract = {
    id: contractId,
    organizationId,
    vendorId: null,
  };
  const transaction = {
    select: jest
      .fn()
      .mockReturnValueOnce(selectQuery([lockedContract]))
      .mockReturnValueOnce(selectQuery([])),
    update: jest.fn(),
  };
  const db = {
    transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const service = new ContractsService(db as never, {} as never, {} as never, {} as never);

  await expect(
    service.updateObligation(contractId, organizationId, ownerId, obligationId, {
      ownerId,
    }),
  ).rejects.toThrow('obligation owner');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('rejects extraction before persisting obligations when the contract owner is outside the organization', async () => {
  const creatorId = '00000000-0000-4000-8000-000000000005';
  const lockedContract = {
    id: contractId,
    organizationId,
    vendorId: null,
    ownerId,
    createdBy: creatorId,
    title: 'Supplier agreement',
    description: null,
    internalNotes: null,
    terms: null,
    type: 'service',
    endDate: null,
    autoRenew: false,
    renewalNoticeDays: 30,
    clauses: [],
    obligations: [],
    extractions: [],
    lines: [],
    amendments: [],
    vendor: null,
    owner: null,
    createdByUser: null,
    softwareLicenses: [],
  };
  const insert = jest.fn();
  const transaction = {
    select: jest
      .fn()
      .mockReturnValueOnce(selectQuery([lockedContract]))
      .mockReturnValueOnce(selectQuery([])),
    insert,
  };
  const db = {
    query: {
      contracts: {
        findFirst: jest.fn().mockResolvedValue(lockedContract),
      },
    },
    transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const service = new ContractsService(db as never, {} as never, {} as never, {} as never);

  await expect(
    service.processIntelligence(contractId, organizationId, creatorId, {
      documentText: 'The supplier must provide a certificate of insurance.',
    }),
  ).rejects.toThrow('obligation owner');
  expect(insert).not.toHaveBeenCalled();
});

it('fails closed for a selected binary document without falling back to contract terms', async () => {
  const documentId = '00000000-0000-4000-8000-000000000006';
  const contract = {
    id: contractId,
    organizationId,
    vendorId: null,
    ownerId,
    createdBy: ownerId,
    title: 'Supplier agreement',
    description: null,
    internalNotes: null,
    terms: 'Fallback terms must never be extracted when a document is selected.',
    type: 'service',
    endDate: null,
    autoRenew: false,
    renewalNoticeDays: 30,
    clauses: [],
    obligations: [],
    extractions: [],
    lines: [],
    amendments: [],
    vendor: null,
    owner: null,
    createdByUser: null,
    softwareLicenses: [],
  };
  const documentExtractor = {
    extract: jest.fn().mockRejectedValue(new ContractDocumentExtractionError('malformed')),
  };
  const documentsService = {
    getDocumentContent: jest.fn().mockResolvedValue({
      document: {
        id: documentId,
        organizationId,
        entityType: 'contract',
        entityId: contractId,
        filename: 'agreement.pdf',
        contentType: 'application/pdf',
        sizeBytes: 128,
        storageKey: 'agreement.pdf',
      },
      buffer: Buffer.from('%PDF-1.7'),
    }),
  };
  const transaction = jest.fn();
  const db = {
    query: { contracts: { findFirst: jest.fn().mockResolvedValue(contract) } },
    transaction,
  };
  const service = new ContractsService(
    db as never,
    {} as never,
    {} as never,
    documentsService as never,
    documentExtractor as never,
  );

  await expect(
    service.processIntelligence(contractId, organizationId, ownerId, { documentId }),
  ).rejects.toThrow('Selected contract document could not be parsed');

  expect(documentsService.getDocumentContent).toHaveBeenCalledWith(
    organizationId,
    documentId,
    { entityType: 'contract', entityId: contractId },
    expect.any(Number),
  );
  expect(documentExtractor.extract).toHaveBeenCalledWith({
    buffer: Buffer.from('%PDF-1.7'),
    contentType: 'application/pdf',
    filename: 'agreement.pdf',
  });
  expect(transaction).not.toHaveBeenCalled();
});

it('persists immutable provenance for a successfully processed DOCX document', async () => {
  const documentId = '00000000-0000-4000-8000-000000000006';
  const documentBuffer = await makeDocxBuffer('Payment terms: Net 30.');
  const contract = {
    id: contractId,
    organizationId,
    vendorId: null,
    ownerId,
    createdBy: ownerId,
    title: 'Supplier agreement',
    description: null,
    internalNotes: null,
    terms: null,
    type: 'service',
    endDate: null,
    autoRenew: false,
    renewalNoticeDays: 30,
    clauses: [],
    obligations: [],
    extractions: [],
    lines: [],
    amendments: [],
    vendor: null,
    owner: null,
    createdByUser: null,
    softwareLicenses: [],
  };
  let extractionValues: Record<string, unknown> | undefined;
  const transaction = {
    select: jest
      .fn()
      .mockReturnValueOnce(selectQuery([contract]))
      .mockReturnValueOnce(selectQuery([{ id: ownerId }])),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn((values: Record<string, unknown> | Array<Record<string, unknown>>) => ({
        returning: jest.fn().mockImplementation(async () => {
          if (table === contractExtractions) {
            extractionValues = values as Record<string, unknown>;
            return [{ id: extractionId, ...(values as Record<string, unknown>) }];
          }
          if (table === contractClauses) {
            return (values as Array<Record<string, unknown>>).map((value, index) => ({
              id: `00000000-0000-4000-8000-00000000010${index}`,
              ...value,
            }));
          }
          throw new Error('Unexpected process-intelligence insert');
        }),
      })),
    })),
  };
  const db = {
    query: { contracts: { findFirst: jest.fn().mockResolvedValue(contract) } },
    transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const documentsService = {
    getDocumentContent: jest.fn().mockResolvedValue({
      document: {
        id: documentId,
        organizationId,
        entityType: 'contract',
        entityId: contractId,
        filename: 'agreement.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: documentBuffer.length,
        storageKey: 'contracts/agreement.docx',
      },
      buffer: documentBuffer,
    }),
  };
  const service = new ContractsService(
    db as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    documentsService as never,
    new ContractDocumentExtractorService(),
  );

  await service.processIntelligence(contractId, organizationId, ownerId, { documentId });

  expect(extractionValues).toMatchObject({
    organizationId,
    contractId,
    documentId,
    sourceType: 'document',
    sourceName: 'agreement.docx',
    extractedText: 'Payment terms: Net 30.',
    extractedFields: {
      paymentTerms: 'NET 30',
      provenance: {
        version: 1,
        documentId,
        contentSha256: createHash('sha256').update(documentBuffer).digest('hex'),
        parserVersion: 'native-contract-document-parser-v2',
        extractionVersion: 'contract-intelligence-regex-v1',
        normalizationVersion: 'contract-text-normalization-v1',
        kind: 'docx',
        segments: [
          {
            sourceReference: `document:${documentId}#docx:section:unheaded:1`,
            startOffset: 0,
            endOffset: 22,
            quote: 'Payment terms: Net 30.',
          },
        ],
      },
    },
  });
});

it('rejects a selected document returned from another organization', async () => {
  const documentId = '00000000-0000-4000-8000-000000000006';
  const contract = {
    id: contractId,
    organizationId,
    vendorId: null,
    ownerId,
    createdBy: ownerId,
    title: 'Supplier agreement',
    description: null,
    internalNotes: null,
    terms: null,
    type: 'service',
    endDate: null,
    autoRenew: false,
    renewalNoticeDays: 30,
    clauses: [],
    obligations: [],
    extractions: [],
    lines: [],
    amendments: [],
    vendor: null,
    owner: null,
    createdByUser: null,
    softwareLicenses: [],
  };
  const documentExtractor = {
    extract: jest.fn().mockResolvedValue({
      kind: 'docx',
      text: 'Payment terms: Net 30.',
      segments: [],
    }),
  };
  const documentsService = {
    getDocumentContent: jest.fn().mockResolvedValue({
      document: {
        id: documentId,
        organizationId: '00000000-0000-4000-8000-000000000099',
        entityType: 'contract',
        entityId: contractId,
        filename: 'agreement.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 128,
        storageKey: 'other-org/agreement.docx',
      },
      buffer: Buffer.from('cross-organization bytes'),
    }),
  };
  const transaction = jest.fn();
  const db = {
    query: { contracts: { findFirst: jest.fn().mockResolvedValue(contract) } },
    transaction,
  };
  const service = new ContractsService(
    db as never,
    {} as never,
    {} as never,
    documentsService as never,
    documentExtractor as never,
  );

  await expect(
    service.processIntelligence(contractId, organizationId, ownerId, { documentId }),
  ).rejects.toThrow(`Document ${documentId} not found for this contract`);
  expect(documentExtractor.extract).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
});

it('rejects review fields that attempt to replace immutable document provenance', async () => {
  const provenance = {
    version: 1,
    documentId: '00000000-0000-4000-8000-000000000006',
    contentSha256: 'a'.repeat(64),
    parserVersion: 'native-contract-document-parser-v2',
    extractionVersion: 'contract-intelligence-regex-v1',
    normalizationVersion: 'contract-text-normalization-v1',
    kind: 'docx',
    segments: [
      {
        sourceReference: 'document:00000000-0000-4000-8000-000000000006#docx:section:Terms:1',
        startOffset: 0,
        endOffset: 12,
        quote: 'Payment terms',
      },
    ],
  };
  const contract = {
    id: contractId,
    organizationId,
    vendorId: null,
    clauses: [],
    obligations: [],
    extractions: [],
    lines: [],
    amendments: [],
    softwareLicenses: [],
  };
  const extraction = {
    id: extractionId,
    organizationId,
    contractId,
    extractedFields: { paymentTerms: 'NET 30', provenance },
  };
  const update = jest.fn(() => ({
    set: jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) })),
  }));
  const transaction = {
    select: jest
      .fn()
      .mockReturnValueOnce(selectQuery([contract]))
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([extraction]) }),
      }),
    update,
  };
  const db = {
    query: { contracts: { findFirst: jest.fn().mockResolvedValue(contract) } },
    transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const service = new ContractsService(
    db as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
  );

  await expect(
    service.reviewExtraction(contractId, organizationId, ownerId, extractionId, {
      decision: 'rejected',
      fields: {
        provenance: null,
        contentSha256: 'forged',
        segments: [],
        sourceUrl: 'https://attacker.example/provenance',
      },
    }),
  ).rejects.toThrow('Unsupported extraction review fields');
  expect(update).not.toHaveBeenCalled();
});

it('merges reviewable fields without changing persisted document provenance', async () => {
  const provenance = {
    version: 1,
    documentId: '00000000-0000-4000-8000-000000000006',
    contentSha256: 'b'.repeat(64),
    parserVersion: 'native-contract-document-parser-v2',
    extractionVersion: 'contract-intelligence-regex-v1',
    normalizationVersion: 'contract-text-normalization-v1',
    kind: 'docx',
    segments: [
      {
        sourceReference: 'document:00000000-0000-4000-8000-000000000006#docx:section:Terms:1',
        startOffset: 0,
        endOffset: 12,
        quote: 'Payment terms',
      },
    ],
  };
  const contract = {
    id: contractId,
    organizationId,
    vendorId: null,
    clauses: [],
    obligations: [],
    extractions: [],
    lines: [],
    amendments: [],
    softwareLicenses: [],
  };
  const extraction = {
    id: extractionId,
    organizationId,
    contractId,
    extractedFields: {
      paymentTerms: 'NET 30',
      liabilityCap: 'fees paid in the prior year',
      provenance,
    },
  };
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const transaction = {
    select: jest
      .fn()
      .mockReturnValueOnce(selectQuery([contract]))
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([extraction]) }),
      }),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((values: Record<string, unknown>) => ({
        where: jest.fn().mockImplementation(async () => {
          updates.push({ table, values });
          return [];
        }),
      })),
    })),
  };
  const db = {
    query: { contracts: { findFirst: jest.fn().mockResolvedValue(contract) } },
    transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const service = new ContractsService(
    db as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
  );

  await service.reviewExtraction(contractId, organizationId, ownerId, extractionId, {
    decision: 'rejected',
    fields: {
      paymentTerms: 'NET 45',
      governingLaw: 'Colorado',
      liabilityCap: null,
    },
  });

  expect(updates[0]?.values.extractedFields).toEqual({
    paymentTerms: 'NET 45',
    governingLaw: 'Colorado',
    liabilityCap: null,
    provenance,
  });
});

async function makeDocxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    { date: new Date('2020-01-01T00:00:00.000Z') },
  );
  return zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
}

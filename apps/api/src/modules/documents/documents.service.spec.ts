import { DocumentsService } from './documents.service';

it('uses distinct storage identities for concurrent same-name uploads', async () => {
  const keys: string[] = [];
  const storage = {
    upload: jest.fn(async (key: string) => {
      keys.push(key);
    }),
  };
  const db = {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{}]) }),
    }),
  };
  const service = new DocumentsService(db as never, storage as never);
  const file = {
    originalname: 'contract.docx',
    buffer: Buffer.from('content'),
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 7,
  } as Express.Multer.File;

  await Promise.all([
    service.upload('org', 'user', file, 'contract', 'one'),
    service.upload('org', 'user', file, 'contract', 'two'),
  ]);

  expect(keys).toHaveLength(2);
  expect(new Set(keys)).toHaveProperty('size', 2);
});

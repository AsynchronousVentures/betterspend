import JSZip from 'jszip';
import {
  CONTRACT_DOCUMENT_MAX_BYTES,
  CONTRACT_DOCUMENT_MAX_DOCX_SECTIONS,
  CONTRACT_DOCUMENT_MAX_TEXT_BYTES,
  ContractDocumentExtractorService,
  resolveDocumentSourceReference,
  type ContractDocumentExtractionFailure,
} from './contract-document-extractor';

jest.setTimeout(30_000);

describe('ContractDocumentExtractorService', () => {
  const extractor = new ContractDocumentExtractorService();

  it('fails closed for PDFs until sandboxed native extraction is available', async () => {
    await expect(
      extractor.extract({
        buffer: makePdf(['PDF content must not be parsed in this slice.']),
        contentType: 'application/pdf',
        filename: 'agreement.pdf',
      }),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('extracts DOCX headings and paragraphs with stable section references', async () => {
    const result = await extractor.extract({
      buffer: await makeDocx([
        { text: 'Commercial terms', style: 'Heading1' },
        { text: 'Payment is due within thirty days.' },
        { text: 'Renewal', style: 'Heading2' },
        { text: 'This agreement automatically renews.' },
      ]),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'agreement.docx',
    });

    expect(result.kind).toBe('docx');
    expect(result.text).toBe(
      'Commercial terms\n\nPayment is due within thirty days.\n\nRenewal\n\nThis agreement automatically renews.',
    );
    expect(result.segments.map(({ sourceReference }) => sourceReference)).toEqual([
      'docx:section:Commercial terms:1',
      'docx:section:Commercial terms:2',
      'docx:section:Commercial terms > Renewal:3',
      'docx:section:Commercial terms > Renewal:4',
    ]);
    expect(result.segments.at(-1)).toMatchObject({
      startOffset: 63,
      endOffset: 99,
    });
    expectNormalizedSegmentOffsets(result);
  });

  it('rejects an oversized upload before document kind handling', async () => {
    await expect(
      extractor.extract({
        buffer: Buffer.alloc(CONTRACT_DOCUMENT_MAX_BYTES + 1),
        contentType: 'application/pdf',
        filename: 'agreement.pdf',
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
  });

  const docxFailureCases: Array<
    [string, () => Buffer | Promise<Buffer>, ContractDocumentExtractionFailure]
  > = [
    ['malformed DOCX archive', () => Buffer.from('not a zip archive'), 'malformed'],
    [
      'valid archive whose decompressed entry exceeds the limit',
      async () =>
        makeDocx([{ text: 'Valid content' }], {
          extraFiles: { 'word/media/large.bin': Buffer.alloc(10 * 1024 * 1024 + 1, 0x61) },
        }),
      'limit_exceeded',
    ],
    [
      'forged-size archive with declared metadata mismatch',
      async () =>
        makeDocx([{ text: 'Valid content' }], {
          extraFiles: { 'word/media/large.bin': Buffer.alloc(10 * 1024 * 1024 + 1, 0x61) },
          mutate: (buffer) => setZipEntrySizes(buffer, 'word/media/large.bin', 1),
        }),
      'malformed',
    ],
    [
      'tiny compressed bomb with forged small declared size',
      async () =>
        makeDocx([{ text: 'Valid content' }], {
          extraFiles: { 'word/media/bomb.bin': Buffer.alloc(1024 * 1024, 0x61) },
          mutate: (buffer) => setZipEntrySizes(buffer, 'word/media/bomb.bin', 1),
        }),
      'malformed',
    ],
    [
      'over-section DOCX',
      async () =>
        makeDocx(
          Array.from({ length: CONTRACT_DOCUMENT_MAX_DOCX_SECTIONS + 1 }, () => ({
            text: 'Section',
          })),
        ),
      'limit_exceeded',
    ],
    [
      'over-text DOCX',
      async () => makeDocx([{ text: 'a'.repeat(CONTRACT_DOCUMENT_MAX_TEXT_BYTES + 1_000_000) }]),
      'limit_exceeded',
    ],
  ];

  it.each(docxFailureCases)('fails closed for %s', async (_label, makeBuffer, code) => {
    await expect(
      extractor.extract({
        buffer: await makeBuffer(),
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'agreement.docx',
      }),
    ).rejects.toMatchObject({
      code,
    });
  });

  it('rejects encrypted DOCX entries before extracting XML', async () => {
    const buffer = await makeDocx([{ text: 'Encrypted' }]);
    setCentralDirectoryFlag(buffer, 'word/document.xml', 0x1);

    await expect(
      extractor.extract({
        buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'agreement.docx',
      }),
    ).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('rejects a decompressed entry when matching local and central CRC metadata is forged', async () => {
    const buffer = await makeDocx([{ text: 'CRC-protected content' }]);
    forgeZipEntryCrc(buffer, 'word/document.xml');

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects unsupported document types', async () => {
    await expect(
      extractor.extract({
        buffer: Buffer.from('legacy binary document'),
        contentType: 'application/msword',
        filename: 'agreement.doc',
      }),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it.each([
    ['ZIP64 end record', Buffer.from([0x50, 0x4b, 0x06, 0x06])],
    ['ZIP64 locator', Buffer.from([0x50, 0x4b, 0x06, 0x07])],
  ])('rejects a %s even when ordinary EOCD fields are present', async (_label, signature) => {
    const buffer = appendZipComment(await makeDocx([{ text: 'Content' }]), signature);

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it.each([
    ['local', (buffer: Buffer) => injectZip64Extra(buffer, 'local')],
    ['central', (buffer: Buffer) => injectZip64Extra(buffer, 'central')],
  ])('rejects a ZIP64 extra field in the %s header', async (_label, mutate) => {
    const buffer = await makeSingleFileZip(
      'word/document.xml',
      '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    );
    const mutated = mutate(buffer);

    await expect(extractor.extract(asDocxInput(mutated))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it.each([
    ['parent traversal', '../x/styles.xml'],
    ['backslash', 'word\\styles.xml'],
    ['absolute path', '/foo/styles.xml'],
    ['dot path segment', 'word/./abcd.xml'],
    ['empty path segment', 'word//style.xml'],
    ['drive path', 'C:/x/styles.xml'],
  ])('rejects a %s ZIP entry name', async (_label, unsafeName) => {
    const buffer = await makeDocx([{ text: 'Content' }]);
    setZipEntryName(buffer, 'word/styles.xml', unsafeName);

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects duplicate ZIP entry names before extraction', async () => {
    const buffer = duplicateCentralDirectoryEntry(
      await makeDocx([{ text: 'Content' }]),
      'word/document.xml',
    );

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects overlapping local data ranges', async () => {
    const buffer = await makeDocx([{ text: 'Content' }]);
    setOverlappingCompressedSize(buffer, 'word/styles.xml', 'word/document.xml');

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects a local header offset outside the archive data area', async () => {
    const buffer = await makeDocx([{ text: 'Content' }]);
    setCentralDirectoryLocalOffset(buffer, 'word/document.xml', getCentralDirectoryOffset(buffer));

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects Unix symlink entries', async () => {
    const buffer = await makeDocx([{ text: 'Content' }]);
    setZipEntrySymlink(buffer, 'word/styles.xml');

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects unsupported ZIP compression methods', async () => {
    const buffer = await makeDocx([{ text: 'Content' }]);
    setZipEntryCompressionMethod(buffer, 'word/styles.xml', 12);

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it.each([
    ['macro project', 'word/vbaProject.bin'],
    ['VBA data', 'word/vbaData.xml'],
    ['ActiveX', 'word/activeX/control.bin'],
    ['custom UI', 'word/customUI/customUI.xml'],
    ['embedded active content', 'word/embeddings/oleObject1.bin'],
  ])('rejects %s entries', async (_label, filename) => {
    const buffer = await makeDocx([{ text: 'Content' }], {
      extraFiles: { [filename]: Buffer.from('active content') },
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects external relationships with whitespace around the attribute equals sign', async () => {
    const buffer = await makeDocx([{ text: 'Content' }], {
      relationshipsXml:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode = \'External\' Target = \'https://example.test/contract\'/>' +
        '</Relationships>',
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects external relationship targets even when TargetMode is not external', async () => {
    const buffer = await makeDocx([{ text: 'Content' }], {
      relationshipsXml:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode = "Internal" Target = "https://example.test/contract"/>' +
        '</Relationships>',
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects DTDs and entity declarations instead of resolving them', async () => {
    const buffer = await makeDocx([{ text: 'Content' }], {
      documentXml:
        '<!DOCTYPE w:document [<!ENTITY contract "secret">]>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>&contract;</w:t></w:r></w:p></w:body></w:document>',
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it.each([
    [
      'an XML declaration without a version',
      '<?xml encoding="UTF-8"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'a non-XML whitespace character in the XML declaration',
      '<?xml\u00a0version="1.0"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'a non-XML whitespace character between attributes',
      '<w:document\u00a0xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'an empty QName local part',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:/></w:body></w:document>',
    ],
    [
      'an empty QName attribute local part',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body bad:="value"><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'a QName with multiple colons',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><bad:many:parts/></w:body></w:document>',
    ],
    [
      'a digit-start element QName local part',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:1/></w:body></w:document>',
    ],
    [
      'a digit-start attribute QName local part',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body w:1="value"><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'invalid punctuation in an element QName',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:bad!/></w:body></w:document>',
    ],
    [
      'a digit-start end-tag QName local part',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>Content</w:t></w:r></w:1></w:body></w:document>',
    ],
    [
      'a non-document root',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:p><w:r><w:t>Content</w:t></w:r></w:p></w:styles>',
    ],
    [
      'a document root in the wrong namespace',
      '<w:document xmlns:w="urn:not-wordprocessingml">' +
        '<w:body><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'a forbidden character-data terminator',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>foo]]>bar</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'an invalid XML comment',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><!--invalid--comment--><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'a forbidden control character in an XML comment',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><!--invalid\u0001comment--><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'a hexadecimal character reference with trailing junk',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>&#x41g;</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'a decimal character reference with whitespace',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>&# 65;</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'a character reference outside the XML scalar range',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>&#x110000;</w:t></w:r></w:p></w:body></w:document>',
    ],
    [
      'an overlong entity reference split across decompression chunks',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body><w:p><w:r><w:t>${'a'.repeat(16_380)}&${'name'.repeat(20)};</w:t></w:r></w:p></w:body></w:document>`,
    ],
  ])('rejects word/document.xml with %s', async (_label, documentXml) => {
    const buffer = await makeDocx([{ text: 'unused' }], { documentXml });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects an archive without the required OOXML package declarations', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it.each([
    [
      '[Content_Types].xml',
      '<Types xmlns="urn:evil"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<Relationships xmlns="urn:evil"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
  ])('rejects the required %s root in the wrong namespace', async (name, xml) => {
    const buffer = await makeDocx([{ text: 'Content' }], {
      extraFiles: { [name]: Buffer.from(xml) },
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it.each([
    [
      'a rebound content-types child',
      {
        extraFiles: {
          '[Content_Types].xml': Buffer.from(
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
              '<Override xmlns="urn:evil" PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
              '</Types>',
          ),
        },
      },
    ],
    [
      'a rebound root relationship child',
      {
        extraFiles: {
          '_rels/.rels': Buffer.from(
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship xmlns="urn:evil" Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
              '</Relationships>',
          ),
        },
      },
    ],
    [
      'a styles root in the wrong namespace',
      { extraFiles: { 'word/styles.xml': Buffer.from('<styles xmlns="urn:evil"/>') } },
    ],
    [
      'a rebound styles child',
      {
        extraFiles: {
          'word/styles.xml': Buffer.from(
            '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
              '<w:style xmlns:w="urn:evil" w:styleId="Heading1"/>' +
              '</w:styles>',
          ),
        },
      },
    ],
    [
      'a document relationships root in the wrong namespace',
      { relationshipsXml: '<Relationships xmlns="urn:evil"/>' },
    ],
    [
      'a rebound document relationship child',
      {
        relationshipsXml:
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship xmlns="urn:evil" Id="rId1" Type="urn:test" Target="target.xml"/>' +
          '</Relationships>',
      },
    ],
  ])('rejects %s', async (_label, options) => {
    const buffer = await makeDocx([{ text: 'Content' }], options);
    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects undeclared namespace prefixes', async () => {
    const buffer = await makeDocx([{ text: 'unused' }], {
      documentXml:
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><bad:element/><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('bounds highly compressible text-node amplification', async () => {
    const nodes = '<w:t>x</w:t>'.repeat(100_001);
    const buffer = await makeDocx([{ text: 'unused' }], {
      documentXml:
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body><w:p><w:r>${nodes}</w:r></w:p></w:body></w:document>`,
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
  });

  it('fails fast when compact XML exceeds the character-reference budget', async () => {
    const references = '&amp;'.repeat(100_001);
    const buffer = await makeDocx([{ text: 'unused' }], {
      documentXml:
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body><w:p><w:r><w:t>${references}</w:t></w:r></w:p></w:body></w:document>`,
    });
    const startedAt = Date.now();

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('enforces the XML reference budget across custom XML parts', async () => {
    const references = '&amp;'.repeat(50_001);
    const buffer = await makeDocx([{ text: 'Content' }], {
      extraFiles: {
        'customXml/item1.xml': Buffer.from(`<root>${references}</root>`),
        'customXml/item2.xml': Buffer.from(`<root>${references}</root>`),
      },
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
  });

  it('accepts multiple XML parts under the shared extraction budgets', async () => {
    const references = '&amp;'.repeat(10);
    const buffer = await makeDocx([{ text: 'Content' }], {
      extraFiles: {
        'customXml/item1.xml': Buffer.from(`<root>${references}</root>`),
        'customXml/item2.xml': Buffer.from(`<root>${references}</root>`),
      },
    });

    await expect(extractor.extract(asDocxInput(buffer))).resolves.toMatchObject({
      text: 'Content',
    });
  });

  it.each([
    ['the xml prefix', 'xmlns:xml="urn:evil"'],
    [
      'the XML namespace URI under another prefix',
      'xmlns:bad="http://www.w3.org/XML/1998/namespace"',
    ],
    ['the xmlns prefix', 'xmlns:xmlns="urn:evil"'],
    ['the xmlns namespace URI', 'xmlns:bad="http://www.w3.org/2000/xmlns/"'],
  ])('rejects rebinding %s', async (_label, declaration) => {
    const buffer = await makeDocx([{ text: 'unused' }], {
      documentXml:
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ${declaration}>` +
        '<w:body><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:body></w:document>',
    });

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects trailing bytes after a raw deflate stream', async () => {
    const buffer = appendDeflateTrailingBytes(
      await makeDocx([{ text: 'Content' }]),
      'word/document.xml',
      Buffer.from('trailing-garbage'),
    );

    await expect(extractor.extract(asDocxInput(buffer))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('does not resolve a nonempty candidate to a blank provenance segment', () => {
    expect(
      resolveDocumentSourceReference(
        'document-id',
        {
          kind: 'docx',
          text: 'A clause',
          segments: [
            { text: '', sourceReference: 'docx:section:blank:1', startOffset: 0, endOffset: 0 },
          ],
        },
        'A clause',
      ),
    ).toBe('document:document-id#docx:unresolved');
  });

  it('chooses the exact evidence section instead of an earlier tiny substring', () => {
    expect(
      resolveDocumentSourceReference(
        'document-id',
        {
          kind: 'docx',
          text: 'a\n\nPayment terms: Net 30.',
          segments: [
            { text: 'a', sourceReference: 'docx:section:tiny:1', startOffset: 0, endOffset: 1 },
            {
              text: 'Payment terms: Net 30.',
              sourceReference: 'docx:section:payment:2',
              startOffset: 3,
              endOffset: 25,
            },
          ],
        },
        'Payment terms: Net 30.',
      ),
    ).toBe('document:document-id#docx:section:payment:2');
  });

  it('chooses the most-specific section containing legitimate evidence', () => {
    expect(
      resolveDocumentSourceReference(
        'document-id',
        {
          kind: 'docx',
          text: 'Long payment terms include Net 30.\n\nNet 30 applies.',
          segments: [
            {
              text: 'Long payment terms include Net 30.',
              sourceReference: 'docx:section:long:1',
              startOffset: 0,
              endOffset: 34,
            },
            {
              text: 'Net 30 applies.',
              sourceReference: 'docx:section:specific:2',
              startOffset: 36,
              endOffset: 51,
            },
          ],
        },
        'Net 30',
      ),
    ).toBe('document:document-id#docx:section:specific:2');
  });
});

function makePdf(pageTexts: readonly string[]): Buffer {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageReferences = pageTexts.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageTexts.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pageTexts.forEach((pageText, index) => {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    const content = Array.from({ length: Math.ceil(pageText.length / 100) || 1 }, (_, chunk) => {
      const value = pageText.slice(chunk * 100, (chunk + 1) * 100);
      return value ? `BT /F1 12 Tf 36 760 Td (${escapePdf(value)}) Tj ET` : '';
    })
      .filter(Boolean)
      .join('\n');
    objects[pageObject] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] =
      `<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}\nendstream`;
  });

  const chunks = [Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'binary')];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = offset;
    const object = Buffer.from(
      `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`,
      'binary',
    );
    chunks.push(object);
    offset += object.length;
  }

  const xrefOffset = offset;
  const xref =
    `xref\n0 ${objects.length}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((value) => `${String(value).padStart(10, '0')} 00000 n \n`)
      .join('');
  chunks.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'binary',
    ),
  );
  return Buffer.concat(chunks);
}

async function makeDocx(
  paragraphs: readonly { text: string; style?: 'Heading1' | 'Heading2' }[],
  options: {
    extraFiles?: Record<string, Buffer>;
    documentXml?: string;
    relationshipsXml?: string;
    mutate?: (buffer: Buffer) => void;
  } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    options.relationshipsXml ??
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
  );
  zip.file(
    'word/styles.xml',
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`,
  );
  const body = paragraphs
    .map(
      ({ text, style }) =>
        `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}` +
        `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
    )
    .join('');
  zip.file(
    'word/document.xml',
    options.documentXml ??
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  for (const [name, data] of Object.entries(options.extraFiles ?? {})) zip.file(name, data);
  const buffer = await zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
  options.mutate?.(buffer);
  return buffer;
}

function asDocxInput(buffer: Buffer): {
  buffer: Buffer;
  contentType: string;
  filename: string;
} {
  return {
    buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filename: 'agreement.docx',
  };
}

async function makeSingleFileZip(filename: string, data: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(filename, data);
  return zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
}

function appendZipComment(buffer: Buffer, comment: Buffer): Buffer {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) throw new Error('EOCD not found');
  const header = Buffer.from(buffer);
  header.writeUInt16LE(comment.length, eocdOffset + 20);
  return Buffer.concat([header, comment]);
}

function setCentralDirectoryFlag(buffer: Buffer, filename: string, mask: number): void {
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = buffer.indexOf(signature);
  while (offset >= 0) {
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength);
    if (name === filename) {
      buffer.writeUInt16LE(buffer.readUInt16LE(offset + 8) | mask, offset + 8);
      return;
    }
    offset = buffer.indexOf(signature, offset + 4);
  }
  throw new Error(`Central directory entry not found: ${filename}`);
}

function injectZip64Extra(buffer: Buffer, location: 'local' | 'central'): Buffer {
  const extra = Buffer.from([0x01, 0x00, 0x00, 0x00]);
  const eocdOffset = getEndOfCentralDirectoryOffset(buffer);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (location === 'local') {
    const filenameLength = buffer.readUInt16LE(26);
    const extraLength = buffer.readUInt16LE(28);
    const insertionOffset = 30 + filenameLength + extraLength;
    const mutated = insertBytes(buffer, insertionOffset, extra);
    mutated.writeUInt16LE(extraLength + extra.length, 28);
    const mutatedEocdOffset = getEndOfCentralDirectoryOffset(mutated);
    mutated.writeUInt32LE(centralDirectoryOffset + extra.length, mutatedEocdOffset + 16);
    return mutated;
  }

  const centralFilenameLength = buffer.readUInt16LE(centralDirectoryOffset + 28);
  const centralExtraLength = buffer.readUInt16LE(centralDirectoryOffset + 30);
  const insertionOffset = centralDirectoryOffset + 46 + centralFilenameLength + centralExtraLength;
  const mutated = insertBytes(buffer, insertionOffset, extra);
  mutated.writeUInt16LE(centralExtraLength + extra.length, centralDirectoryOffset + 30);
  const mutatedEocdOffset = getEndOfCentralDirectoryOffset(mutated);
  mutated.writeUInt32LE(
    buffer.readUInt32LE(eocdOffset + 12) + extra.length,
    mutatedEocdOffset + 12,
  );
  return mutated;
}

function setZipEntryName(buffer: Buffer, currentName: string, replacementName: string): void {
  const currentNameBytes = Buffer.from(currentName, 'utf8');
  const replacementNameBytes = Buffer.from(replacementName, 'utf8');
  if (currentNameBytes.length !== replacementNameBytes.length) {
    throw new Error('ZIP test names must have equal byte lengths');
  }
  const central = findCentralEntry(buffer, currentName);
  replacementNameBytes.copy(buffer, central.offset + 46);
  const localOffset = buffer.readUInt32LE(central.offset + 42);
  replacementNameBytes.copy(buffer, localOffset + 30);
}

function duplicateCentralDirectoryEntry(buffer: Buffer, filename: string): Buffer {
  const entry = findCentralEntry(buffer, filename);
  const eocdOffset = getEndOfCentralDirectoryOffset(buffer);
  const duplicate = Buffer.from(buffer.subarray(entry.offset, entry.end));
  const mutated = insertBytes(buffer, eocdOffset, duplicate);
  const mutatedEocdOffset = eocdOffset + duplicate.length;
  mutated.writeUInt16LE(mutated.readUInt16LE(mutatedEocdOffset + 8) + 1, mutatedEocdOffset + 8);
  mutated.writeUInt16LE(mutated.readUInt16LE(mutatedEocdOffset + 10) + 1, mutatedEocdOffset + 10);
  mutated.writeUInt32LE(
    mutated.readUInt32LE(mutatedEocdOffset + 12) + duplicate.length,
    mutatedEocdOffset + 12,
  );
  return mutated;
}

function setOverlappingCompressedSize(
  buffer: Buffer,
  targetName: string,
  followingName: string,
): void {
  const target = findCentralEntry(buffer, targetName);
  const following = findCentralEntry(buffer, followingName);
  const localOffset = buffer.readUInt32LE(target.offset + 42);
  const followingLocalOffset = buffer.readUInt32LE(following.offset + 42);
  const filenameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + filenameLength + extraLength;
  const compressedSize = followingLocalOffset - dataStart + 1;
  if (compressedSize <= 0 || compressedSize > 0xffffffff) {
    throw new Error('ZIP test entries do not overlap');
  }
  buffer.writeUInt32LE(compressedSize, target.offset + 20);
  buffer.writeUInt32LE(compressedSize, localOffset + 18);
}

function appendDeflateTrailingBytes(buffer: Buffer, filename: string, trailing: Buffer): Buffer {
  const central = findCentralEntry(buffer, filename);
  const localOffset = buffer.readUInt32LE(central.offset + 42);
  const filenameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const compressedSize = buffer.readUInt32LE(localOffset + 18);
  const dataEnd = localOffset + 30 + filenameLength + extraLength + compressedSize;
  const oldCentralDirectoryOffset = getCentralDirectoryOffset(buffer);
  const oldEocdOffset = getEndOfCentralDirectoryOffset(buffer);
  const mutated = Buffer.concat([buffer.subarray(0, dataEnd), trailing, buffer.subarray(dataEnd)]);
  const shiftedCentralEntryOffset = central.offset + trailing.length;
  const shiftedEocdOffset = oldEocdOffset + trailing.length;
  mutated.writeUInt32LE(compressedSize + trailing.length, localOffset + 18);
  mutated.writeUInt32LE(compressedSize + trailing.length, shiftedCentralEntryOffset + 20);
  mutated.writeUInt32LE(oldCentralDirectoryOffset + trailing.length, shiftedEocdOffset + 16);
  return mutated;
}

function setCentralDirectoryLocalOffset(buffer: Buffer, filename: string, offset: number): void {
  const entry = findCentralEntry(buffer, filename);
  buffer.writeUInt32LE(offset, entry.offset + 42);
}

function setZipEntrySymlink(buffer: Buffer, filename: string): void {
  const entry = findCentralEntry(buffer, filename);
  buffer.writeUInt16LE((3 << 8) | 20, entry.offset + 4);
  buffer.writeUInt32LE(0xa0000000, entry.offset + 38);
}

function setZipEntryCompressionMethod(buffer: Buffer, filename: string, method: number): void {
  const entry = findCentralEntry(buffer, filename);
  const localOffset = buffer.readUInt32LE(entry.offset + 42);
  buffer.writeUInt16LE(method, entry.offset + 10);
  buffer.writeUInt16LE(method, localOffset + 8);
}

function getCentralDirectoryOffset(buffer: Buffer): number {
  return buffer.readUInt32LE(getEndOfCentralDirectoryOffset(buffer) + 16);
}

function getEndOfCentralDirectoryOffset(buffer: Buffer): number {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const offset = buffer.lastIndexOf(signature);
  if (offset < 0) throw new Error('EOCD not found');
  return offset;
}

function findCentralEntry(buffer: Buffer, filename: string): { offset: number; end: number } {
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const centralDirectoryOffset = getCentralDirectoryOffset(buffer);
  const eocdOffset = getEndOfCentralDirectoryOffset(buffer);
  let offset = centralDirectoryOffset;
  while (offset < eocdOffset) {
    if (buffer.readUInt32LE(offset) !== signature.readUInt32LE(0)) {
      throw new Error(`Central directory entry not found: ${filename}`);
    }
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + filenameLength + extraLength + commentLength;
    const name = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength);
    if (name === filename) return { offset, end };
    offset = end;
  }
  throw new Error(`Central directory entry not found: ${filename}`);
}

function insertBytes(buffer: Buffer, offset: number, bytes: Buffer): Buffer {
  return Buffer.concat([buffer.subarray(0, offset), bytes, buffer.subarray(offset)]);
}

function setZipEntrySizes(buffer: Buffer, filename: string, uncompressedSize: number): void {
  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const localSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let centralOffset = buffer.indexOf(centralSignature);
  while (centralOffset >= 0) {
    const filenameLength = buffer.readUInt16LE(centralOffset + 28);
    const name = buffer.toString('utf8', centralOffset + 46, centralOffset + 46 + filenameLength);
    if (name === filename) {
      const localOffset = buffer.readUInt32LE(centralOffset + 42);
      if (buffer.readUInt32LE(localOffset) !== localSignature.readUInt32LE(0)) {
        throw new Error(`Local entry not found: ${filename}`);
      }
      const localFlags = buffer.readUInt16LE(localOffset + 6);
      const localFilenameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const compressedSize = buffer.readUInt32LE(centralOffset + 20);
      const dataEnd = localOffset + 30 + localFilenameLength + localExtraLength + compressedSize;
      buffer.writeUInt32LE(uncompressedSize, centralOffset + 24);
      buffer.writeUInt32LE(uncompressedSize, localOffset + 22);
      if (localFlags & 0x8) {
        const descriptorHasSignature = buffer.readUInt32LE(dataEnd) === 0x08074b50;
        const descriptorOffset = dataEnd + (descriptorHasSignature ? 12 : 8);
        buffer.writeUInt32LE(uncompressedSize, descriptorOffset);
      }
      return;
    }
    centralOffset = buffer.indexOf(centralSignature, centralOffset + 4);
  }
  throw new Error(`Central directory entry not found: ${filename}`);
}

function forgeZipEntryCrc(buffer: Buffer, filename: string): void {
  const entry = findCentralEntry(buffer, filename);
  const localOffset = buffer.readUInt32LE(entry.offset + 42);
  const forgedCrc = (buffer.readUInt32LE(entry.offset + 16) ^ 0xffffffff) >>> 0;
  buffer.writeUInt32LE(forgedCrc, entry.offset + 16);
  buffer.writeUInt32LE(forgedCrc, localOffset + 14);
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function expectNormalizedSegmentOffsets(document: {
  text: string;
  segments: readonly { text: string; startOffset: number; endOffset: number }[];
}): void {
  for (const segment of document.segments) {
    expect(document.text.slice(segment.startOffset, segment.endOffset)).toBe(segment.text);
  }
}

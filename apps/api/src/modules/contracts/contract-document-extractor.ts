import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { Readable } from 'node:stream';
import { crc32, createInflateRaw } from 'node:zlib';
import yauzl from 'yauzl';

export const CONTRACT_DOCUMENT_EXTRACTOR = Symbol('CONTRACT_DOCUMENT_EXTRACTOR');

export const CONTRACT_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
export const CONTRACT_DOCUMENT_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const CONTRACT_DOCUMENT_MAX_DOCX_SECTIONS = 1_000;
export const CONTRACT_DOCUMENT_PARSER_VERSION = 'native-contract-document-parser-v2';
export const CONTRACT_DOCUMENT_EXTRACTION_VERSION = 'contract-intelligence-regex-v1';
export const CONTRACT_DOCUMENT_NORMALIZATION_VERSION = 'contract-text-normalization-v1';

const MAX_DOCX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2_000;
const MAX_DOCX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
const MAX_DOCX_HEADING_PATH_LENGTH = 120;
const MAX_DOCX_STYLES = 2_000;
const MAX_XML_TOKEN_BYTES = 256 * 1024;
const MAX_XML_ENTITY_LENGTH = 32;
const MAX_XML_DEPTH = 256;
const MAX_XML_TOKENS = 200_000;
const MAX_XML_TEXT_NODES = 100_000;
const MAX_XML_REFERENCES = 100_000;

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WORDPROCESSINGML_MAIN_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PACKAGE_CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types';
const PACKAGE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const INTERPRETED_WORD_ELEMENT_NAMES = new Map([
  ['body', 'body'],
  ['br', 'br'],
  ['cr', 'cr'],
  ['del', 'del'],
  ['deltext', 'delText'],
  ['document', 'document'],
  ['p', 'p'],
  ['ppr', 'pPr'],
  ['pstyle', 'pStyle'],
  ['r', 'r'],
  ['t', 't'],
  ['tab', 'tab'],
]);

const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const ZIP_ENCRYPTED_FLAG = 0x1;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x8;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_UTF8_FLAG = 0x800;
const ZIP_DEFLATE_OPTION_FLAGS = 0x6;
const ZIP_ALLOWED_GENERAL_PURPOSE_FLAGS =
  ZIP_ENCRYPTED_FLAG | ZIP_DATA_DESCRIPTOR_FLAG | ZIP_UTF8_FLAG | ZIP_DEFLATE_OPTION_FLAGS;
const ZIP_SUPPORTED_COMPRESSION_METHODS = new Set([0, 8]);

const MACRO_ENTRY_NAMES = new Set(['word/vbaproject.bin', 'word/vbadata.xml']);

export type ContractDocumentKind = 'pdf' | 'docx';

export interface ContractDocumentSegment {
  text: string;
  sourceReference: string;
  startOffset: number;
  endOffset: number;
}

export interface ContractDocumentText {
  kind: ContractDocumentKind;
  text: string;
  segments: readonly ContractDocumentSegment[];
}

export interface ContractDocumentProvenance {
  version: 1;
  documentId: string;
  contentSha256: string;
  parserVersion: string;
  extractionVersion: string;
  normalizationVersion: string;
  kind: ContractDocumentKind;
  segments: readonly (Pick<
    ContractDocumentSegment,
    'sourceReference' | 'startOffset' | 'endOffset'
  > & { quote: string })[];
}

export interface ContractDocumentExtractor {
  extract(input: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  }): Promise<ContractDocumentText>;
}

export type ContractDocumentExtractionFailure =
  'unsupported' | 'too_large' | 'encrypted' | 'malformed' | 'empty' | 'limit_exceeded';

/**
 * Safe, user-facing parser failure. Provider/parser details intentionally stay
 * behind this seam so they cannot leak into an API response or audit payload.
 */
export class ContractDocumentExtractionError extends Error {
  constructor(readonly code: ContractDocumentExtractionFailure) {
    super(`Contract document extraction failed: ${code}`);
    this.name = 'ContractDocumentExtractionError';
  }
}

/**
 * Build the stable provenance payload stored with a contract extraction.
 * Offsets are JavaScript string offsets into the extraction's normalized text.
 */
export function createContractDocumentProvenance(
  documentId: string,
  contentSha256: string,
  document: ContractDocumentText,
): ContractDocumentProvenance {
  return {
    version: 1,
    documentId,
    contentSha256,
    parserVersion: CONTRACT_DOCUMENT_PARSER_VERSION,
    extractionVersion: CONTRACT_DOCUMENT_EXTRACTION_VERSION,
    normalizationVersion: CONTRACT_DOCUMENT_NORMALIZATION_VERSION,
    kind: document.kind,
    segments: document.segments.map((segment) => ({
      sourceReference: prefixDocumentSourceReference(documentId, segment.sourceReference),
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
      quote: segment.text,
    })),
  };
}

/**
 * Point a generated clause or obligation at its first matching document
 * segment. The full ordered segment list remains in the extraction payload.
 */
export function resolveDocumentSourceReference(
  documentId: string,
  document: ContractDocumentText,
  candidateText: string,
): string {
  const candidate = normalizeProvenanceText(candidateText);
  const normalizedSegments = document.segments.map((segment, index) => ({
    segment,
    index,
    normalizedText: normalizeProvenanceText(segment.text),
  }));
  const exact = normalizedSegments.find(
    ({ normalizedText }) => Boolean(candidate) && normalizedText === candidate,
  );
  const containing = normalizedSegments
    .filter(({ normalizedText }) => Boolean(candidate) && normalizedText.includes(candidate))
    .sort(
      (left, right) =>
        left.normalizedText.length - right.normalizedText.length || left.index - right.index,
    )[0];
  const segment = exact?.segment ?? containing?.segment;

  return prefixDocumentSourceReference(
    documentId,
    segment?.sourceReference ?? `${document.kind}:unresolved`,
  );
}

export function sha256DocumentContent(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function prefixDocumentSourceReference(documentId: string, sourceReference: string): string {
  return `document:${documentId}#${sourceReference}`;
}

@Injectable()
export class ContractDocumentExtractorService implements ContractDocumentExtractor {
  async extract(input: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  }): Promise<ContractDocumentText> {
    if (!Buffer.isBuffer(input.buffer)) {
      throw new ContractDocumentExtractionError('malformed');
    }
    assertInputSize(input.buffer);

    const kind = detectKind(input.contentType, input.filename);
    if (kind === 'pdf') {
      throw new ContractDocumentExtractionError('unsupported');
    }

    return extractDocxArchive(input.buffer);
  }
}

function assertInputSize(buffer: Buffer): void {
  if (buffer.length === 0) throw new ContractDocumentExtractionError('empty');
  if (buffer.length > CONTRACT_DOCUMENT_MAX_BYTES) {
    throw new ContractDocumentExtractionError('too_large');
  }
}

function detectKind(contentType: string, filename: string): ContractDocumentKind {
  const normalizedContentType =
    typeof contentType === 'string'
      ? contentType.split(';', 1)[0]?.trim().toLowerCase()
      : undefined;
  const normalizedFilename = typeof filename === 'string' ? filename.trim().toLowerCase() : '';

  if (normalizedFilename.endsWith('.pdf') || normalizedContentType === 'application/pdf') {
    return 'pdf';
  }
  if (normalizedFilename.endsWith('.docm') || normalizedFilename.endsWith('.dotm')) {
    throw new ContractDocumentExtractionError('unsupported');
  }
  if (normalizedFilename.endsWith('.docx') || normalizedContentType === DOCX_CONTENT_TYPE) {
    return 'docx';
  }

  throw new ContractDocumentExtractionError('unsupported');
}

async function extractDocxArchive(buffer: Buffer): Promise<ContractDocumentText> {
  const archive = readZipEndOfCentralDirectory(buffer);
  if (!archive.entries.some((entry) => entry.normalizedName === 'word/document.xml')) {
    throw new ContractDocumentExtractionError('malformed');
  }

  const headingStyles = new Map<string, string>();
  let documentParser: DocxDocumentParser | undefined;
  let stylesParser: DocxStylesParser | undefined;
  let entriesSeen = 0;
  let totalUncompressedBytes = 0;
  const packageState = { contentTypesValid: false, rootRelationshipValid: false };
  const xmlBudget: XmlExtractionBudget = { tokens: 0, textNodes: 0, references: 0 };

  const zipFile = await openZip(buffer);
  try {
    if (zipFile.entryCount !== archive.entryCount) {
      throw new ContractDocumentExtractionError('malformed');
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(
          error instanceof ContractDocumentExtractionError
            ? error
            : new ContractDocumentExtractionError('malformed'),
        );
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        if (
          entriesSeen !== archive.entryCount ||
          !documentParser ||
          !packageState.contentTypesValid ||
          !packageState.rootRelationshipValid
        ) {
          reject(new ContractDocumentExtractionError('malformed'));
          return;
        }
        try {
          stylesParser?.finish();
          documentParser.finish(headingStyles);
          resolve();
        } catch (error: unknown) {
          reject(
            error instanceof ContractDocumentExtractionError
              ? error
              : new ContractDocumentExtractionError('malformed'),
          );
        }
      };

      zipFile.on('error', fail);
      zipFile.on('end', finish);
      zipFile.on('entry', (entry) => {
        void processZipEntry(
          buffer,
          zipFile,
          entry,
          archive.entries[entriesSeen],
          (parser) => {
            documentParser = parser;
          },
          (parser) => {
            stylesParser = parser;
          },
          headingStyles,
          packageState,
          xmlBudget,
          (bytes) => {
            totalUncompressedBytes += bytes;
            if (totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
              throw new ContractDocumentExtractionError('limit_exceeded');
            }
          },
        )
          .then(() => {
            entriesSeen += 1;
            zipFile.readEntry();
          })
          .catch(fail);
      });

      zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }

  if (!documentParser) throw new ContractDocumentExtractionError('malformed');
  return documentParser.result();
}

async function processZipEntry(
  archiveBuffer: Buffer,
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  expected: ZipEntryMetadata | undefined,
  setDocumentParser: (parser: DocxDocumentParser) => void,
  setStylesParser: (parser: DocxStylesParser) => void,
  headingStyles: Map<string, string>,
  packageState: { contentTypesValid: boolean; rootRelationshipValid: boolean },
  xmlBudget: XmlExtractionBudget,
  accountBytes: (bytes: number) => void,
): Promise<void> {
  if (!expected || !sameZipEntry(entry, expected)) {
    throw new ContractDocumentExtractionError('malformed');
  }
  await validateCompressedPayload(archiveBuffer, expected);

  const normalizedName = expected.normalizedName;
  let scanner: XmlTokenizer | undefined;
  if (normalizedName === 'word/document.xml') {
    const parser = new DocxDocumentParser();
    setDocumentParser(parser);
    scanner = createXmlScanner(normalizedName, xmlBudget, parser);
  } else if (normalizedName === 'word/styles.xml') {
    const parser = new DocxStylesParser(headingStyles);
    setStylesParser(parser);
    scanner = createXmlScanner(normalizedName, xmlBudget, parser);
  } else if (normalizedName === '[content_types].xml') {
    scanner = createXmlScanner(normalizedName, xmlBudget, new ContentTypesParser(packageState));
  } else if (normalizedName === '_rels/.rels') {
    scanner = createXmlScanner(
      normalizedName,
      xmlBudget,
      new RootRelationshipsParser(packageState),
    );
  } else if (normalizedName === 'word/_rels/document.xml.rels') {
    scanner = createXmlScanner(normalizedName, xmlBudget, new PackageRelationshipsParser());
  } else if (isXmlEntry(normalizedName)) {
    scanner = createXmlScanner(normalizedName, xmlBudget);
  }

  let actualUncompressedBytes = 0;
  let actualCrc32 = 0;
  const stream = await openEntryStream(entry, zipFile);
  try {
    for await (const chunk of stream) {
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      actualUncompressedBytes += chunkBuffer.length;
      actualCrc32 = crc32(chunkBuffer, actualCrc32);
      if (actualUncompressedBytes > MAX_DOCX_ENTRY_BYTES) {
        throw new ContractDocumentExtractionError('limit_exceeded');
      }
      scanner?.push(chunkBuffer);
    }
  } catch (error: unknown) {
    if (error instanceof ContractDocumentExtractionError) throw error;
    throw new ContractDocumentExtractionError('malformed');
  } finally {
    stream.destroy();
  }

  scanner?.finish();
  if (actualUncompressedBytes !== expected.uncompressedSize || actualCrc32 !== expected.crc32) {
    throw new ContractDocumentExtractionError('malformed');
  }
  accountBytes(actualUncompressedBytes);
}

function createXmlScanner(
  normalizedEntryName: string,
  budget: XmlExtractionBudget,
  documentHandler?: XmlHandler,
): XmlTokenizer {
  const policy = new XmlPolicyHandler(normalizedEntryName);
  return new XmlTokenizer(
    {
      start: (token) => {
        policy.start(token);
        documentHandler?.start(token);
      },
      end: (name) => documentHandler?.end(name),
      text: (value) => documentHandler?.text(value),
    },
    budget,
  );
}

interface XmlAttribute {
  name: string;
  localName: string;
  value: string;
  namespaceUri?: string;
}

interface XmlStartToken {
  name: string;
  localName: string;
  attributes: readonly XmlAttribute[];
  selfClosing: boolean;
  namespaceUri?: string;
}

interface XmlHandler {
  start(token: XmlStartToken): void;
  end(name: string): void;
  text(value: string): void;
}

interface XmlExtractionBudget {
  tokens: number;
  textNodes: number;
  references: number;
}

class XmlPolicyHandler {
  constructor(private readonly normalizedEntryName: string) {}

  start(token: XmlStartToken): void {
    const elementName = token.localName.toLowerCase();
    if (
      elementName === 'vbaproject' ||
      elementName === 'vbadata' ||
      elementName === 'activex' ||
      elementName === 'customui'
    ) {
      throw new ContractDocumentExtractionError('malformed');
    }

    const attributes = new Map<string, string>();
    for (const attribute of token.attributes) {
      const name = attribute.localName.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      attributes.set(name, value);
      if (
        value.includes('macroenabled') ||
        value.includes('vbaproject') ||
        value.includes('vbadata') ||
        value.includes('activex') ||
        value.includes('customui')
      ) {
        throw new ContractDocumentExtractionError('malformed');
      }
    }

    const targetMode = attributes.get('targetmode');
    const target = attributes.get('target');
    if (
      targetMode === 'external' ||
      (target !== undefined && isExternalRelationshipTarget(target))
    ) {
      throw new ContractDocumentExtractionError('malformed');
    }

    if (
      this.normalizedEntryName.endsWith('.rels') &&
      elementName === 'relationship' &&
      targetMode === 'external'
    ) {
      throw new ContractDocumentExtractionError('malformed');
    }
  }
}

class ContentTypesParser implements XmlHandler {
  private rootSeen = false;

  constructor(private readonly state: { contentTypesValid: boolean }) {}

  start(token: XmlStartToken): void {
    if (!this.rootSeen) {
      validatePackageRoot(token, 'Types', PACKAGE_CONTENT_TYPES_NAMESPACE);
      this.rootSeen = true;
      return;
    }
    if (
      (token.localName === 'override' || token.localName === 'default') &&
      token.namespaceUri !== PACKAGE_CONTENT_TYPES_NAMESPACE
    ) {
      throw new ContractDocumentExtractionError('malformed');
    }
    if (token.localName !== 'override') return;
    const values = Object.fromEntries(
      token.attributes.map(({ localName, value }) => [localName, value]),
    );
    if (
      values.partname === '/word/document.xml' &&
      values.contenttype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    ) {
      this.state.contentTypesValid = true;
    }
  }
  end(): void {}
  text(): void {}
}

class RootRelationshipsParser implements XmlHandler {
  private rootSeen = false;

  constructor(private readonly state: { rootRelationshipValid: boolean }) {}

  start(token: XmlStartToken): void {
    if (!this.rootSeen) {
      validatePackageRoot(token, 'Relationships', PACKAGE_RELATIONSHIPS_NAMESPACE);
      this.rootSeen = true;
      return;
    }
    if (token.localName !== 'relationship') return;
    if (token.namespaceUri !== PACKAGE_RELATIONSHIPS_NAMESPACE) {
      throw new ContractDocumentExtractionError('malformed');
    }
    const values = Object.fromEntries(
      token.attributes.map(({ localName, value }) => [localName, value]),
    );
    if (
      values.type ===
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' &&
      values.target === 'word/document.xml' &&
      values.targetmode === undefined
    ) {
      this.state.rootRelationshipValid = true;
    }
  }
  end(): void {}
  text(): void {}
}

class PackageRelationshipsParser implements XmlHandler {
  private rootSeen = false;

  start(token: XmlStartToken): void {
    if (!this.rootSeen) {
      validatePackageRoot(token, 'Relationships', PACKAGE_RELATIONSHIPS_NAMESPACE);
      this.rootSeen = true;
      return;
    }
    if (
      token.localName === 'relationship' &&
      token.namespaceUri !== PACKAGE_RELATIONSHIPS_NAMESPACE
    ) {
      throw new ContractDocumentExtractionError('malformed');
    }
  }
  end(): void {}
  text(): void {}
}

function validatePackageRoot(
  token: XmlStartToken,
  expectedLocalName: string,
  expectedNamespace: string,
): void {
  const { localName } = splitXmlQualifiedName(token.name);
  if (localName !== expectedLocalName || token.namespaceUri !== expectedNamespace) {
    throw new ContractDocumentExtractionError('malformed');
  }
}

class XmlTokenizer {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private input = '';
  private entityTail = '';
  private readonly stack: string[] = [];
  private sawRoot = false;
  private closedRoot = false;
  private xmlDeclarationSeen = false;
  private xmlDeclarationPositionAvailable = true;
  private characterDataSuffix = '';
  private readonly namespaceScopes: ReadonlyMap<string, string>[] = [];

  constructor(
    private readonly handler: XmlHandler,
    private readonly budget: XmlExtractionBudget,
  ) {}

  push(chunk: Buffer): void {
    try {
      this.input += this.decoder.decode(chunk, { stream: true });
    } catch {
      throw new ContractDocumentExtractionError('malformed');
    }
    this.processInput(false);
  }

  finish(): void {
    try {
      this.input += this.decoder.decode();
    } catch {
      throw new ContractDocumentExtractionError('malformed');
    }
    this.processInput(true);
    if (this.input || this.entityTail || this.stack.length || !this.sawRoot) {
      throw new ContractDocumentExtractionError('malformed');
    }
  }

  private processInput(final: boolean): void {
    while (this.input) {
      const tagStart = this.input.indexOf('<');
      if (tagStart < 0) {
        this.emitText(this.input, final);
        this.input = '';
        return;
      }
      if (tagStart > 0) {
        this.emitText(this.input.slice(0, tagStart), false);
        this.input = this.input.slice(tagStart);
        continue;
      }

      if (this.input.startsWith('<!--')) {
        this.accountToken();
        const commentEnd = this.input.indexOf('-->');
        if (commentEnd < 0) {
          this.assertTokenSize();
          return;
        }
        const comment = this.input.slice(4, commentEnd);
        if (
          comment.includes('--') ||
          comment.endsWith('-') ||
          containsInvalidXmlCharacters(comment)
        ) {
          throw new ContractDocumentExtractionError('malformed');
        }
        this.characterDataSuffix = '';
        this.xmlDeclarationPositionAvailable = false;
        this.input = this.input.slice(commentEnd + 3);
        continue;
      }

      const tokenEnd = findXmlTokenEnd(this.input);
      if (tokenEnd < 0) {
        this.assertTokenSize();
        return;
      }
      const token = this.input.slice(0, tokenEnd + 1);
      this.input = this.input.slice(tokenEnd + 1);
      this.processToken(token);
    }

    if (final && this.entityTail) {
      throw new ContractDocumentExtractionError('malformed');
    }
  }

  private assertTokenSize(): void {
    if (Buffer.byteLength(this.input, 'utf8') > MAX_XML_TOKEN_BYTES) {
      throw new ContractDocumentExtractionError('limit_exceeded');
    }
  }

  private processToken(token: string): void {
    this.accountToken();
    this.characterDataSuffix = '';
    if (token.startsWith('<!')) {
      throw new ContractDocumentExtractionError('malformed');
    }
    if (token.startsWith('<?')) {
      this.processProcessingInstruction(token);
      return;
    }
    if (token.startsWith('</')) {
      const name = parseXmlEndTag(token);
      if (this.stack.at(-1) !== name) {
        throw new ContractDocumentExtractionError('malformed');
      }
      this.handler.end(name);
      this.stack.pop();
      this.namespaceScopes.pop();
      if (this.stack.length === 0) this.closedRoot = true;
      return;
    }

    const parsedStart = parseXmlStartTag(token, () => this.accountReference());
    const namespaceScope = validateNamespaceBindings(parsedStart, this.namespaceScopes.at(-1));
    const start = resolveXmlNamespaces(parsedStart, namespaceScope);
    this.xmlDeclarationPositionAvailable = false;
    if (this.closedRoot) throw new ContractDocumentExtractionError('malformed');
    if (!this.sawRoot) this.sawRoot = true;
    this.handler.start(start);
    if (!start.selfClosing) {
      this.stack.push(start.name);
      this.namespaceScopes.push(namespaceScope);
      if (this.stack.length > MAX_XML_DEPTH) {
        throw new ContractDocumentExtractionError('limit_exceeded');
      }
      return;
    }
    this.handler.end(start.name);
    if (!this.stack.length) this.closedRoot = true;
  }

  private processProcessingInstruction(token: string): void {
    if (!token.endsWith('?>')) {
      throw new ContractDocumentExtractionError('malformed');
    }
    if (this.xmlDeclarationSeen || this.sawRoot || !this.xmlDeclarationPositionAvailable) {
      throw new ContractDocumentExtractionError('malformed');
    }
    validateXmlDeclaration(token, () => this.accountReference());
    this.xmlDeclarationSeen = true;
    this.xmlDeclarationPositionAvailable = false;
  }

  private emitText(rawValue: string, final: boolean): void {
    if (rawValue) {
      this.budget.textNodes += 1;
      if (this.budget.textNodes > MAX_XML_TEXT_NODES) {
        throw new ContractDocumentExtractionError('limit_exceeded');
      }
    }
    if ((this.characterDataSuffix + rawValue).includes(']]>')) {
      throw new ContractDocumentExtractionError('malformed');
    }
    this.characterDataSuffix = final ? '' : (this.characterDataSuffix + rawValue).slice(-2);
    if (!this.sawRoot && rawValue) this.xmlDeclarationPositionAvailable = false;
    const value = this.entityTail + rawValue;
    this.entityTail = '';
    let cursor = 0;
    const decoded: string[] = [];
    while (cursor < value.length) {
      const ampersand = value.indexOf('&', cursor);
      if (ampersand < 0) {
        decoded.push(value.slice(cursor));
        break;
      }
      decoded.push(value.slice(cursor, ampersand));
      const semicolon = value.indexOf(';', ampersand + 1);
      if (semicolon < 0) {
        const tail = value.slice(ampersand);
        if (tail.length > MAX_XML_ENTITY_LENGTH) {
          throw new ContractDocumentExtractionError('malformed');
        }
        this.entityTail = tail;
        if (final) throw new ContractDocumentExtractionError('malformed');
        break;
      }
      if (semicolon - ampersand > MAX_XML_ENTITY_LENGTH) {
        throw new ContractDocumentExtractionError('malformed');
      }
      this.accountReference();
      decoded.push(decodeXmlEntity(value.slice(ampersand + 1, semicolon)));
      cursor = semicolon + 1;
    }
    this.emitDecodedText(decoded.join(''));
  }

  private emitDecodedText(value: string): void {
    if (!value) return;
    if (containsInvalidXmlCharacters(value)) {
      throw new ContractDocumentExtractionError('malformed');
    }
    if (!this.sawRoot && hasNonXmlWhitespace(value)) {
      throw new ContractDocumentExtractionError('malformed');
    }
    if (this.closedRoot && hasNonXmlWhitespace(value)) {
      throw new ContractDocumentExtractionError('malformed');
    }
    this.handler.text(value);
  }

  private accountToken(): void {
    this.budget.tokens += 1;
    if (this.budget.tokens > MAX_XML_TOKENS) {
      throw new ContractDocumentExtractionError('limit_exceeded');
    }
  }

  private accountReference(): void {
    this.budget.references += 1;
    if (this.budget.references > MAX_XML_REFERENCES) {
      throw new ContractDocumentExtractionError('limit_exceeded');
    }
  }
}

class DocxDocumentParser implements XmlHandler {
  private readonly stack: string[] = [];
  private readonly paragraphs: Array<{ text: string; styleId?: string }> = [];
  private currentParagraph: { text: string; styleId?: string } | undefined;
  private paragraphCount = 0;
  private textBytes = 0;
  private parsed: ContractDocumentText | undefined;
  private wordPrefix: string | undefined;
  private rootSeen = false;
  private deletedDepth = 0;
  private textDepth = 0;

  start(token: XmlStartToken): void {
    if (!this.rootSeen) {
      this.wordPrefix = validateWordDocumentRoot(token);
      this.rootSeen = true;
    } else {
      validateWordElementNamespace(token, this.wordPrefix);
    }
    const localName = token.localName.toLowerCase();
    if (localName === 'del' || localName === 'deltext') this.deletedDepth += 1;
    if (localName === 't') this.textDepth += 1;
    if (localName === 'p') {
      if (this.currentParagraph) throw new ContractDocumentExtractionError('malformed');
      this.paragraphCount += 1;
      if (this.paragraphCount > CONTRACT_DOCUMENT_MAX_DOCX_SECTIONS) {
        throw new ContractDocumentExtractionError('limit_exceeded');
      }
      this.currentParagraph = { text: '' };
    } else if (localName === 'pstyle' && this.currentParagraph) {
      const styleId = token.attributes.find(
        (attribute) => attribute.localName.toLowerCase() === 'val',
      )?.value;
      if (styleId) this.currentParagraph.styleId = styleId;
    } else if (this.currentParagraph && this.deletedDepth === 0) {
      if (localName === 'tab') this.appendText('\t');
      if (localName === 'br' || localName === 'cr') this.appendText('\n');
    }

    this.stack.push(token.name);
  }

  end(name: string): void {
    if (name !== this.stack.at(-1)) throw new ContractDocumentExtractionError('malformed');
    const localName = localXmlName(name);
    if (localName === 'p') {
      if (!this.currentParagraph) throw new ContractDocumentExtractionError('malformed');
      const text = normalizeText(this.currentParagraph.text);
      if (text) this.paragraphs.push({ text, styleId: this.currentParagraph.styleId });
      this.currentParagraph = undefined;
    }
    if (localName === 'del' || localName === 'deltext') this.deletedDepth -= 1;
    if (localName === 't') this.textDepth -= 1;
    this.stack.pop();
  }

  text(value: string): void {
    if (this.currentParagraph && this.deletedDepth === 0 && this.textDepth > 0) {
      this.appendText(value);
    }
  }

  finish(headingStyles: ReadonlyMap<string, string>): void {
    if (!this.rootSeen || this.currentParagraph || this.stack.length) {
      throw new ContractDocumentExtractionError('malformed');
    }
    if (!this.paragraphs.length) throw new ContractDocumentExtractionError('empty');

    const segments: ContractDocumentSegment[] = [];
    const headings: Array<string | undefined> = [];
    let text = '';
    for (const paragraph of this.paragraphs) {
      const startOffset = text ? text.length + 2 : 0;
      text = appendSegment(text, paragraph.text);
      assertTextSize(text);

      const level = headingLevel(paragraph.styleId, headingStyles);
      if (level !== undefined) {
        headings[level - 1] = paragraph.text;
        headings.length = level;
      }
      const headingPath = headings
        .filter((heading): heading is string => Boolean(heading))
        .join(' > ');
      const safeHeadingPath =
        (headingPath || 'unheaded')
          .replace(/[^\p{L}\p{N}._ >-]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_DOCX_HEADING_PATH_LENGTH) || 'unheaded';
      const ordinal = segments.length + 1;
      segments.push({
        text: paragraph.text,
        sourceReference: `docx:section:${safeHeadingPath}:${ordinal}`,
        startOffset,
        endOffset: text.length,
      });
    }

    if (!text) throw new ContractDocumentExtractionError('empty');
    this.parsed = { kind: 'docx', text, segments };
  }

  result(): ContractDocumentText {
    if (!this.parsed) throw new ContractDocumentExtractionError('malformed');
    return this.parsed;
  }

  private appendText(value: string): void {
    const valueBytes = Buffer.byteLength(value, 'utf8');
    if (this.textBytes + valueBytes > CONTRACT_DOCUMENT_MAX_TEXT_BYTES) {
      throw new ContractDocumentExtractionError('limit_exceeded');
    }
    this.currentParagraph!.text += value;
    this.textBytes += valueBytes;
  }
}

class DocxStylesParser implements XmlHandler {
  private readonly stack: string[] = [];
  private currentStyle: { id: string; name?: string } | undefined;
  private rootSeen = false;

  constructor(private readonly headingStyles: Map<string, string>) {}

  start(token: XmlStartToken): void {
    const localName = token.localName.toLowerCase();
    if (!this.rootSeen) {
      if (localName !== 'styles' || token.namespaceUri !== WORDPROCESSINGML_MAIN_NAMESPACE) {
        throw new ContractDocumentExtractionError('malformed');
      }
      this.rootSeen = true;
    } else if (token.namespaceUri !== WORDPROCESSINGML_MAIN_NAMESPACE) {
      throw new ContractDocumentExtractionError('malformed');
    }
    if (localName === 'style') {
      const id = token.attributes.find(
        (attribute) => attribute.localName.toLowerCase() === 'styleid',
      )?.value;
      if (id) {
        if (this.headingStyles.size >= MAX_DOCX_STYLES) {
          throw new ContractDocumentExtractionError('limit_exceeded');
        }
        this.currentStyle = { id };
      }
    } else if (localName === 'name' && this.currentStyle) {
      const name = token.attributes.find(
        (attribute) => attribute.localName.toLowerCase() === 'val',
      )?.value;
      if (name) this.currentStyle.name = name;
    }
    this.stack.push(token.name);
  }

  end(name: string): void {
    if (name !== this.stack.at(-1)) throw new ContractDocumentExtractionError('malformed');
    if (localXmlName(name) === 'style' && this.currentStyle) {
      if (this.currentStyle.name) {
        this.headingStyles.set(this.currentStyle.id, this.currentStyle.name);
      }
      this.currentStyle = undefined;
    }
    this.stack.pop();
  }

  text(): void {}

  finish(): void {
    if (!this.rootSeen || this.stack.length || this.currentStyle) {
      throw new ContractDocumentExtractionError('malformed');
    }
  }
}

function headingLevel(
  styleId: string | undefined,
  headingStyles: ReadonlyMap<string, string>,
): number | undefined {
  const values = [styleId, styleId ? headingStyles.get(styleId) : undefined];
  for (const value of values) {
    const match = value
      ?.toLowerCase()
      .replace(/\s+/g, '')
      .match(/^heading([1-6])$/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function appendSegment(text: string, segment: string): string {
  return text ? `${text}\n\n${segment}` : segment;
}

function assertTextSize(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > CONTRACT_DOCUMENT_MAX_TEXT_BYTES) {
    throw new ContractDocumentExtractionError('limit_exceeded');
  }
}

function normalizeText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeProvenanceText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function localXmlName(name: string): string {
  const separator = name.indexOf(':');
  return (separator < 0 ? name : name.slice(separator + 1)).toLowerCase();
}

function validateWordDocumentRoot(token: XmlStartToken): string | undefined {
  const { prefix, localName } = splitXmlQualifiedName(token.name);
  if (localName !== 'document') {
    throw new ContractDocumentExtractionError('malformed');
  }
  const namespaceAttributeName = prefix ? `xmlns:${prefix}` : 'xmlns';
  const namespace = token.attributes.find(
    (attribute) => attribute.name === namespaceAttributeName,
  )?.value;
  if (namespace !== WORDPROCESSINGML_MAIN_NAMESPACE) {
    throw new ContractDocumentExtractionError('malformed');
  }
  return prefix;
}

function validateWordElementNamespace(token: XmlStartToken, wordPrefix: string | undefined): void {
  const { prefix, localName } = splitXmlQualifiedName(token.name);
  const interpretedName = INTERPRETED_WORD_ELEMENT_NAMES.get(localName.toLowerCase());
  if (interpretedName && (localName !== interpretedName || prefix !== wordPrefix)) {
    throw new ContractDocumentExtractionError('malformed');
  }

  const namespaceAttributeName = wordPrefix ? `xmlns:${wordPrefix}` : 'xmlns';
  const redeclaredNamespace = token.attributes.find(
    (attribute) => attribute.name === namespaceAttributeName,
  )?.value;
  if (
    redeclaredNamespace !== undefined &&
    redeclaredNamespace !== WORDPROCESSINGML_MAIN_NAMESPACE
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
}

function splitXmlQualifiedName(name: string): { prefix: string | undefined; localName: string } {
  const separator = name.indexOf(':');
  if (separator < 0) {
    if (!isSupportedXmlNcName(name)) throw new ContractDocumentExtractionError('malformed');
    return { prefix: undefined, localName: name };
  }
  if (separator === 0 || separator !== name.lastIndexOf(':')) {
    throw new ContractDocumentExtractionError('malformed');
  }
  const prefix = name.slice(0, separator);
  const localName = name.slice(separator + 1);
  if (!isSupportedXmlNcName(prefix) || !isSupportedXmlNcName(localName)) {
    throw new ContractDocumentExtractionError('malformed');
  }
  return { prefix, localName };
}

function isSupportedXmlNcName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(value);
}

function validateNamespaceBindings(
  token: XmlStartToken,
  parent: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> {
  const scope = new Map(parent ?? [['xml', 'http://www.w3.org/XML/1998/namespace']]);
  for (const attribute of token.attributes) {
    if (attribute.name === 'xmlns') {
      validateReservedNamespaceBinding('', attribute.value);
      scope.set('', attribute.value);
    } else if (attribute.name.startsWith('xmlns:')) {
      const prefix = attribute.name.slice(6);
      validateReservedNamespaceBinding(prefix, attribute.value);
      scope.set(prefix, attribute.value);
    }
  }
  const elementPrefix = splitXmlQualifiedName(token.name).prefix;
  if (elementPrefix === 'xmlns' || (elementPrefix && !scope.has(elementPrefix))) {
    throw new ContractDocumentExtractionError('malformed');
  }
  for (const attribute of token.attributes) {
    const prefix = splitXmlQualifiedName(attribute.name).prefix;
    if (prefix && prefix !== 'xmlns' && !scope.has(prefix)) {
      throw new ContractDocumentExtractionError('malformed');
    }
  }
  return scope;
}

function validateReservedNamespaceBinding(prefix: string, namespaceUri: string): void {
  const xmlNamespace = 'http://www.w3.org/XML/1998/namespace';
  const xmlnsNamespace = 'http://www.w3.org/2000/xmlns/';
  if (
    prefix === 'xmlns' ||
    namespaceUri === xmlnsNamespace ||
    (prefix === 'xml' && namespaceUri !== xmlNamespace) ||
    (prefix !== 'xml' && namespaceUri === xmlNamespace)
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
}

function resolveXmlNamespaces(
  token: XmlStartToken,
  scope: ReadonlyMap<string, string>,
): XmlStartToken {
  const elementPrefix = splitXmlQualifiedName(token.name).prefix ?? '';
  return {
    ...token,
    namespaceUri: scope.get(elementPrefix),
    attributes: token.attributes.map((attribute) => {
      const prefix = splitXmlQualifiedName(attribute.name).prefix;
      return {
        ...attribute,
        namespaceUri:
          attribute.name === 'xmlns' || prefix === 'xmlns'
            ? 'http://www.w3.org/2000/xmlns/'
            : prefix
              ? scope.get(prefix)
              : undefined,
      };
    }),
  };
}

function decodeXmlEntity(entity: string): string {
  if (entity === 'amp') return '&';
  if (entity === 'lt') return '<';
  if (entity === 'gt') return '>';
  if (entity === 'quot') return '"';
  if (entity === 'apos') return "'";

  let codePoint: number;
  if (/^#x[0-9a-fA-F]+$/u.test(entity)) {
    codePoint = Number.parseInt(entity.slice(2), 16);
  } else if (/^#[0-9]+$/u.test(entity)) {
    codePoint = Number.parseInt(entity.slice(1), 10);
  } else {
    throw new ContractDocumentExtractionError('malformed');
  }
  if (!isXmlCodePoint(codePoint)) {
    throw new ContractDocumentExtractionError('malformed');
  }
  return String.fromCodePoint(codePoint);
}

function containsInvalidXmlCharacters(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/u.test(value);
}

function isXmlCodePoint(value: number): boolean {
  return (
    Number.isInteger(value) &&
    (value === 0x9 ||
      value === 0xa ||
      value === 0xd ||
      (value >= 0x20 && value <= 0xd7ff) ||
      (value >= 0xe000 && value <= 0xfffd) ||
      (value >= 0x10000 && value <= 0x10ffff))
  );
}

function findXmlTokenEnd(input: string): number {
  let quote: string | undefined;
  for (let index = 1; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function validateXmlDeclaration(token: string, accountReference: () => void): void {
  if (!token.startsWith('<?xml') || !isXmlWhitespace(token[5] ?? '') || token.includes('&')) {
    throw new ContractDocumentExtractionError('malformed');
  }

  const declaration = parseXmlStartTag(`<xml${token.slice(5, -2)}>`, accountReference);
  const attributes = declaration.attributes;
  if (
    declaration.selfClosing ||
    attributes[0]?.name !== 'version' ||
    attributes[0].value !== '1.0'
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }

  let cursor = 1;
  if (attributes[cursor]?.name === 'encoding') {
    if (!/^utf-8$/iu.test(attributes[cursor].value)) {
      throw new ContractDocumentExtractionError('malformed');
    }
    cursor += 1;
  }
  if (attributes[cursor]?.name === 'standalone') {
    if (attributes[cursor].value !== 'yes' && attributes[cursor].value !== 'no') {
      throw new ContractDocumentExtractionError('malformed');
    }
    cursor += 1;
  }
  if (cursor !== attributes.length) {
    throw new ContractDocumentExtractionError('malformed');
  }
}

function parseXmlStartTag(token: string, accountReference: () => void): XmlStartToken {
  let cursor = 1;
  const name = readXmlName(token, cursor);
  cursor += name.length;
  const attributes: XmlAttribute[] = [];
  const seenAttributes = new Set<string>();
  const seenLocalAttributes = new Set<string>();
  let selfClosing = false;

  while (cursor < token.length - 1) {
    const whitespaceStart = cursor;
    while (isXmlWhitespace(token[cursor] ?? '')) cursor += 1;
    if (cursor === token.length - 1) break;
    if (token[cursor] === '/') {
      if (cursor !== token.length - 2) {
        throw new ContractDocumentExtractionError('malformed');
      }
      selfClosing = true;
      cursor += 1;
      break;
    }
    if (cursor === whitespaceStart && attributes.length > 0) {
      throw new ContractDocumentExtractionError('malformed');
    }

    const attributeName = readXmlName(token, cursor);
    cursor += attributeName.length;
    while (isXmlWhitespace(token[cursor] ?? '')) cursor += 1;
    if (token[cursor] !== '=') throw new ContractDocumentExtractionError('malformed');
    cursor += 1;
    while (isXmlWhitespace(token[cursor] ?? '')) cursor += 1;
    const quote = token[cursor];
    if (quote !== '"' && quote !== "'") {
      throw new ContractDocumentExtractionError('malformed');
    }
    cursor += 1;
    const valueStart = cursor;
    const valueEnd = token.indexOf(quote, valueStart);
    if (valueEnd < 0) throw new ContractDocumentExtractionError('malformed');
    const value = decodeXmlAttributeValue(token.slice(valueStart, valueEnd), accountReference);
    const normalizedName = attributeName.toLowerCase();
    const normalizedLocalName = localXmlName(attributeName);
    if (seenAttributes.has(normalizedName) || seenLocalAttributes.has(normalizedLocalName)) {
      throw new ContractDocumentExtractionError('malformed');
    }
    seenAttributes.add(normalizedName);
    seenLocalAttributes.add(normalizedLocalName);
    attributes.push({
      name: attributeName,
      localName: localXmlName(attributeName),
      value,
    });
    cursor = valueEnd + 1;
  }

  if (!selfClosing && token[token.length - 2] === '/') {
    throw new ContractDocumentExtractionError('malformed');
  }
  if (cursor !== token.length - 1) {
    throw new ContractDocumentExtractionError('malformed');
  }
  return {
    name,
    localName: localXmlName(name),
    attributes,
    selfClosing,
  };
}

function parseXmlEndTag(token: string): string {
  const value = token.slice(2, -1);
  const name = readXmlName(value, 0);
  if (trimXmlWhitespace(value) !== name || !value.startsWith(name)) {
    throw new ContractDocumentExtractionError('malformed');
  }
  return name;
}

function readXmlName(value: string, start: number): string {
  const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(value.slice(start));
  if (!match?.[0]) throw new ContractDocumentExtractionError('malformed');
  splitXmlQualifiedName(match[0]);
  return match[0];
}

function isXmlWhitespace(value: string): boolean {
  return value === ' ' || value === '\t' || value === '\r' || value === '\n';
}

function hasNonXmlWhitespace(value: string): boolean {
  return [...value].some((character) => !isXmlWhitespace(character));
}

function trimXmlWhitespace(value: string): string {
  let end = value.length;
  while (end > 0 && isXmlWhitespace(value[end - 1] ?? '')) end -= 1;
  return value.slice(0, end);
}

function decodeXmlAttributeValue(value: string, accountReference: () => void): string {
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    const ampersand = value.indexOf('&', cursor);
    if (ampersand < 0) {
      result += value.slice(cursor);
      break;
    }
    result += value.slice(cursor, ampersand);
    const semicolon = value.indexOf(';', ampersand + 1);
    if (semicolon < 0 || semicolon - ampersand > MAX_XML_ENTITY_LENGTH) {
      throw new ContractDocumentExtractionError('malformed');
    }
    accountReference();
    result += decodeXmlEntity(value.slice(ampersand + 1, semicolon));
    cursor = semicolon + 1;
  }
  if (/[<\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(result)) {
    throw new ContractDocumentExtractionError('malformed');
  }
  return result;
}

function isExternalRelationshipTarget(target: string): boolean {
  return (
    target.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(target) ||
    /(?:^|[/\\])(?:activex|customui|embeddings|vba|oleobject)(?:[/\\]|$)/iu.test(target)
  );
}

function isXmlEntry(name: string): boolean {
  return name.endsWith('.xml') || name.endsWith('.rels');
}

interface ZipArchiveMetadata {
  entryCount: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  entries: readonly ZipEntryMetadata[];
}

interface ZipEntryMetadata {
  name: string;
  normalizedName: string;
  nameBytes: Buffer;
  versionMadeBy: number;
  versionNeededToExtract: number;
  generalPurposeBitFlag: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  externalFileAttributes: number;
  relativeOffsetOfLocalHeader: number;
  dataRange: { start: number; end: number; dataStart: number; dataEnd: number };
}

function readZipEndOfCentralDirectory(buffer: Buffer): ZipArchiveMetadata {
  if (buffer.length < 22) throw new ContractDocumentExtractionError('malformed');
  rejectZip64Signatures(buffer);

  const eocdOffsets: number[] = [];
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) eocdOffsets.push(offset);
  }
  if (eocdOffsets.length !== 1) throw new ContractDocumentExtractionError('malformed');

  const eocdOffset = eocdOffsets[0]!;
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount === 0xffff ||
    entryCount > MAX_DOCX_ENTRIES ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw entryCount > MAX_DOCX_ENTRIES
      ? new ContractDocumentExtractionError('limit_exceeded')
      : new ContractDocumentExtractionError('malformed');
  }
  if (centralDirectorySize > MAX_DOCX_CENTRAL_DIRECTORY_BYTES) {
    throw new ContractDocumentExtractionError('limit_exceeded');
  }
  if (
    centralDirectoryOffset > eocdOffset ||
    centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }

  const entries = parseCentralDirectory(buffer, {
    entryCount,
    centralDirectoryOffset,
    centralDirectorySize,
  });
  return { entryCount, centralDirectoryOffset, centralDirectorySize, entries };
}

function rejectZip64Signatures(buffer: Buffer): void {
  if (
    hasZipSignature(buffer, ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) ||
    hasZipSignature(buffer, ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE)
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
}

function hasZipSignature(buffer: Buffer, signature: number): boolean {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32LE(signature, 0);
  return buffer.includes(bytes);
}

function parseCentralDirectory(
  buffer: Buffer,
  archive: Pick<
    ZipArchiveMetadata,
    'entryCount' | 'centralDirectoryOffset' | 'centralDirectorySize'
  >,
): readonly ZipEntryMetadata[] {
  const entries: ZipEntryMetadata[] = [];
  const names = new Set<string>();
  const ranges: Array<{ start: number; end: number }> = [];
  const centralDirectoryEnd = archive.centralDirectoryOffset + archive.centralDirectorySize;
  let cursor = archive.centralDirectoryOffset;

  for (let index = 0; index < archive.entryCount; index += 1) {
    ensureBufferRange(buffer, cursor, 46);
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ContractDocumentExtractionError('malformed');
    }
    const versionMadeBy = buffer.readUInt16LE(cursor + 4);
    const versionNeededToExtract = buffer.readUInt16LE(cursor + 6);
    const generalPurposeBitFlag = buffer.readUInt16LE(cursor + 8);
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const crc32 = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const filenameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const diskNumber = buffer.readUInt16LE(cursor + 34);
    const externalFileAttributes = buffer.readUInt32LE(cursor + 38);
    const relativeOffsetOfLocalHeader = buffer.readUInt32LE(cursor + 42);
    const recordLength = 46 + filenameLength + extraLength + commentLength;
    ensureBufferRange(buffer, cursor, recordLength);
    if (cursor + recordLength > centralDirectoryEnd) {
      throw new ContractDocumentExtractionError('malformed');
    }

    const nameBytes = Buffer.from(buffer.subarray(cursor + 46, cursor + 46 + filenameLength));
    const name = decodeZipName(nameBytes, generalPurposeBitFlag);
    const normalizedName = normalizeZipName(name);
    if (names.has(normalizedName)) throw new ContractDocumentExtractionError('malformed');
    names.add(normalizedName);
    validateZipEntryMetadata({
      versionMadeBy,
      versionNeededToExtract,
      generalPurposeBitFlag,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      externalFileAttributes,
      name,
    });
    if (diskNumber !== 0) throw new ContractDocumentExtractionError('malformed');
    parseExtraFields(
      buffer.subarray(cursor + 46 + filenameLength, cursor + 46 + filenameLength + extraLength),
    );

    const dataRange = readLocalDataRange(buffer, archive.centralDirectoryOffset, {
      name,
      nameBytes,
      versionNeededToExtract,
      generalPurposeBitFlag,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      externalFileAttributes,
      relativeOffsetOfLocalHeader,
    });
    if (ranges.some((range) => dataRange.start < range.end && range.start < dataRange.end)) {
      throw new ContractDocumentExtractionError('malformed');
    }
    ranges.push(dataRange);
    entries.push({
      name,
      normalizedName,
      nameBytes,
      versionMadeBy,
      versionNeededToExtract,
      generalPurposeBitFlag,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      externalFileAttributes,
      relativeOffsetOfLocalHeader,
      dataRange,
    });
    cursor += recordLength;
  }
  if (cursor !== centralDirectoryEnd) throw new ContractDocumentExtractionError('malformed');
  return entries;
}

function validateZipEntryMetadata(entry: {
  versionMadeBy: number;
  versionNeededToExtract: number;
  generalPurposeBitFlag: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  externalFileAttributes: number;
  name: string;
}): void {
  if (entry.generalPurposeBitFlag & ZIP_ENCRYPTED_FLAG) {
    throw new ContractDocumentExtractionError('encrypted');
  }
  if (
    entry.generalPurposeBitFlag & ~ZIP_ALLOWED_GENERAL_PURPOSE_FLAGS ||
    (entry.compressionMethod === 0 && entry.generalPurposeBitFlag & ZIP_DEFLATE_OPTION_FLAGS) ||
    !ZIP_SUPPORTED_COMPRESSION_METHODS.has(entry.compressionMethod)
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
  if (
    entry.versionNeededToExtract >= 45 ||
    entry.compressedSize === 0xffffffff ||
    entry.uncompressedSize === 0xffffffff
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
  if (
    entry.compressedSize > MAX_DOCX_ENTRY_BYTES ||
    entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES
  ) {
    throw new ContractDocumentExtractionError('limit_exceeded');
  }
  validateZipEntryName(entry.name);
  if (isZipSymlink(entry.versionMadeBy, entry.externalFileAttributes)) {
    throw new ContractDocumentExtractionError('malformed');
  }
  if (isForbiddenActiveEntry(entry.name)) {
    throw new ContractDocumentExtractionError('malformed');
  }
}

function validateZipEntryName(name: string): void {
  if (
    !name ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/u.test(name) ||
    name.includes('//')
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
  const parts = name.split('/');
  if (
    parts.some(
      (part, index) => part === '..' || part === '.' || (!part && index < parts.length - 1),
    )
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
  if ([...name].some((character) => character.charCodeAt(0) < 0x20 || character === '\u007f')) {
    throw new ContractDocumentExtractionError('malformed');
  }
}

function normalizeZipName(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

function isForbiddenActiveEntry(name: string): boolean {
  const normalizedName = normalizeZipName(name);
  if (MACRO_ENTRY_NAMES.has(normalizedName)) return true;
  const parts = normalizedName.split('/');
  if (
    parts.some(
      (part) =>
        part === 'activex' ||
        part === 'customui' ||
        part === 'embeddings' ||
        part === 'vba' ||
        part.startsWith('vba'),
    )
  ) {
    return true;
  }
  return (
    /^word\/(?:oleobject|activex|customui|vba)/u.test(normalizedName) ||
    (normalizedName.startsWith('word/') && normalizedName.endsWith('.bin'))
  );
}

function parseExtraFields(extra: Buffer): void {
  let cursor = 0;
  while (cursor < extra.length) {
    if (cursor + 4 > extra.length) throw new ContractDocumentExtractionError('malformed');
    const id = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + length > extra.length) throw new ContractDocumentExtractionError('malformed');
    if (id === ZIP64_EXTRA_FIELD_ID) {
      throw new ContractDocumentExtractionError('malformed');
    }
    cursor += length;
  }
}

function readLocalDataRange(
  buffer: Buffer,
  centralDirectoryOffset: number,
  entry: Pick<
    ZipEntryMetadata,
    | 'name'
    | 'nameBytes'
    | 'versionNeededToExtract'
    | 'generalPurposeBitFlag'
    | 'compressionMethod'
    | 'crc32'
    | 'compressedSize'
    | 'uncompressedSize'
    | 'externalFileAttributes'
    | 'relativeOffsetOfLocalHeader'
  >,
): { start: number; end: number; dataStart: number; dataEnd: number } {
  const localHeaderOffset = entry.relativeOffsetOfLocalHeader;
  if (
    !Number.isSafeInteger(localHeaderOffset) ||
    localHeaderOffset < 0 ||
    localHeaderOffset + 30 > centralDirectoryOffset
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
  ensureBufferRange(buffer, localHeaderOffset, 30);
  if (buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new ContractDocumentExtractionError('malformed');
  }

  const localVersionNeededToExtract = buffer.readUInt16LE(localHeaderOffset + 4);
  const localFlags = buffer.readUInt16LE(localHeaderOffset + 6);
  const localCompressionMethod = buffer.readUInt16LE(localHeaderOffset + 8);
  const localCrc32 = buffer.readUInt32LE(localHeaderOffset + 14);
  const localCompressedSize = buffer.readUInt32LE(localHeaderOffset + 18);
  const localUncompressedSize = buffer.readUInt32LE(localHeaderOffset + 22);
  const filenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const localHeaderLength = 30 + filenameLength + extraLength;
  ensureBufferRange(buffer, localHeaderOffset, localHeaderLength);
  if (localHeaderOffset + localHeaderLength > centralDirectoryOffset) {
    throw new ContractDocumentExtractionError('malformed');
  }

  const localNameBytes = buffer.subarray(
    localHeaderOffset + 30,
    localHeaderOffset + 30 + filenameLength,
  );
  const localName = decodeZipName(localNameBytes, localFlags);
  if (
    localVersionNeededToExtract >= 45 ||
    localFlags !== entry.generalPurposeBitFlag ||
    localCompressionMethod !== entry.compressionMethod ||
    !localNameBytes.equals(entry.nameBytes) ||
    localName !== entry.name
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
  parseExtraFields(
    buffer.subarray(localHeaderOffset + 30 + filenameLength, localHeaderOffset + localHeaderLength),
  );
  if (
    !(entry.generalPurposeBitFlag & ZIP_DATA_DESCRIPTOR_FLAG) &&
    (localCrc32 !== entry.crc32 ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize)
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
  if (
    entry.generalPurposeBitFlag & ZIP_DATA_DESCRIPTOR_FLAG &&
    ((localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
      (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize))
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }

  const dataStart = localHeaderOffset + localHeaderLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd < dataStart || dataEnd > centralDirectoryOffset) {
    throw new ContractDocumentExtractionError('malformed');
  }
  let rangeEnd = dataEnd;
  if (entry.generalPurposeBitFlag & ZIP_DATA_DESCRIPTOR_FLAG) {
    ensureBufferRange(buffer, dataEnd, 12);
    const descriptorHasSignature = buffer.readUInt32LE(dataEnd) === ZIP_DATA_DESCRIPTOR_SIGNATURE;
    const descriptorStart = descriptorHasSignature ? dataEnd + 4 : dataEnd;
    const descriptorLength = descriptorHasSignature ? 16 : 12;
    ensureBufferRange(buffer, dataEnd, descriptorLength);
    if (dataEnd + descriptorLength > centralDirectoryOffset) {
      throw new ContractDocumentExtractionError('malformed');
    }
    const descriptorCrc32 = buffer.readUInt32LE(descriptorStart);
    const descriptorCompressedSize = buffer.readUInt32LE(descriptorStart + 4);
    const descriptorUncompressedSize = buffer.readUInt32LE(descriptorStart + 8);
    if (
      descriptorCrc32 !== entry.crc32 ||
      descriptorCompressedSize !== entry.compressedSize ||
      descriptorUncompressedSize !== entry.uncompressedSize
    ) {
      throw new ContractDocumentExtractionError('malformed');
    }
    rangeEnd = dataEnd + descriptorLength;
  }
  return { start: localHeaderOffset, end: rangeEnd, dataStart, dataEnd };
}

async function validateCompressedPayload(buffer: Buffer, entry: ZipEntryMetadata): Promise<void> {
  if (entry.compressionMethod !== 8) return;
  const inflater = createInflateRaw();
  let actualBytes = 0;
  let actualCrc32 = 0;
  try {
    inflater.end(buffer.subarray(entry.dataRange.dataStart, entry.dataRange.dataEnd));
    for await (const chunk of inflater) {
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      actualBytes += chunkBuffer.length;
      if (actualBytes > entry.uncompressedSize || actualBytes > MAX_DOCX_ENTRY_BYTES) {
        throw new ContractDocumentExtractionError('malformed');
      }
      actualCrc32 = crc32(chunkBuffer, actualCrc32);
    }
    if (
      inflater.bytesWritten !== entry.compressedSize ||
      actualBytes !== entry.uncompressedSize ||
      actualCrc32 !== entry.crc32
    ) {
      throw new ContractDocumentExtractionError('malformed');
    }
  } catch (error: unknown) {
    inflater.destroy();
    if (error instanceof ContractDocumentExtractionError) throw error;
    throw new ContractDocumentExtractionError('malformed');
  }
}

function ensureBufferRange(buffer: Buffer, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    throw new ContractDocumentExtractionError('malformed');
  }
}

function decodeZipName(bytes: Buffer, flags: number): string {
  try {
    if (!(flags & ZIP_UTF8_FLAG)) return bytes.toString('utf8');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ContractDocumentExtractionError('malformed');
  }
}

function isZipSymlink(versionMadeBy: number, externalFileAttributes: number): boolean {
  const madeByPlatform = versionMadeBy >> 8;
  const mode = externalFileAttributes >>> 16;
  return madeByPlatform === 3 && (mode & 0xf000) === 0xa000;
}

function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        validateEntrySizes: false,
        decodeStrings: true,
        strictFileNames: true,
      },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(new ContractDocumentExtractionError('malformed'));
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

function sameZipEntry(entry: yauzl.Entry, expected: ZipEntryMetadata): boolean {
  return (
    entry.fileName === expected.name &&
    entry.versionMadeBy === expected.versionMadeBy &&
    entry.versionNeededToExtract === expected.versionNeededToExtract &&
    entry.generalPurposeBitFlag === expected.generalPurposeBitFlag &&
    entry.compressionMethod === expected.compressionMethod &&
    entry.crc32 === expected.crc32 &&
    entry.compressedSize === expected.compressedSize &&
    entry.uncompressedSize === expected.uncompressedSize &&
    entry.externalFileAttributes === expected.externalFileAttributes &&
    entry.relativeOffsetOfLocalHeader === expected.relativeOffsetOfLocalHeader
  );
}

function openEntryStream(entry: yauzl.Entry, zipFile: yauzl.ZipFile): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new ContractDocumentExtractionError('malformed'));
        return;
      }
      resolve(stream);
    });
  });
}

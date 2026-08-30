import type { QboExternalEntityMapping } from '@betterspend/shared';

export type MappingSection = 'accounts' | 'departments' | 'projects' | 'vendors';

export interface LocalMappingRecord {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

export interface LocalMappingRow extends LocalMappingRecord {
  mapping: QboExternalEntityMapping | null;
  suggestion: QboExternalEntityMapping | null;
}

export function normalizeMappingText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function mappingCode(mapping: QboExternalEntityMapping): string | null {
  const payload = mapping.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  for (const key of ['AcctNum', 'DisplayName', 'Name']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return null;
}

export function mappingRows(
  localRecords: LocalMappingRecord[],
  mappings: QboExternalEntityMapping[],
): LocalMappingRow[] {
  const activeCatalog = mappings.filter((mapping) => mapping.isActive && !mapping.isDeleted);
  const available = activeCatalog
    .filter((mapping) => mapping.localId === null)
    .sort(
      (left, right) =>
        left.externalEntity.localeCompare(right.externalEntity) || left.id.localeCompare(right.id),
    );
  const suggestions = new Map<string, QboExternalEntityMapping>();
  const availableIds = new Set(available.map((mapping) => mapping.id));
  const linkedLocalIds = new Set(
    activeCatalog.flatMap((mapping) => (mapping.localId ? [mapping.localId] : [])),
  );
  const openLocals = localRecords
    .filter((local) => !linkedLocalIds.has(local.id))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  interface CandidateBucket {
    candidates: QboExternalEntityMapping[];
    cursor: number;
  }

  const byCode = new Map<string, CandidateBucket>();
  const byName = new Map<string, CandidateBucket>();

  function indexCandidate(index: Map<string, CandidateBucket>, key: string, mapping: QboExternalEntityMapping) {
    if (!key) return;
    const bucket = index.get(key);
    if (bucket) {
      bucket.candidates.push(mapping);
    } else {
      index.set(key, { candidates: [mapping], cursor: 0 });
    }
  }

  function takeCandidate(index: Map<string, CandidateBucket>, key: string) {
    const bucket = index.get(key);
    while (bucket && bucket.cursor < bucket.candidates.length) {
      const candidate = bucket.candidates[bucket.cursor++];
      if (candidate && availableIds.delete(candidate.id)) return candidate;
    }
    return null;
  }

  for (const mapping of available) {
    indexCandidate(byCode, normalizeMappingText(mappingCode(mapping)), mapping);
    indexCandidate(byName, normalizeMappingText(mapping.displayName), mapping);
  }

  for (const local of openLocals) {
    const candidate = takeCandidate(byCode, normalizeMappingText(local.code));
    if (candidate) suggestions.set(local.id, candidate);
  }
  for (const local of openLocals) {
    if (suggestions.has(local.id)) continue;
    const candidate = takeCandidate(byName, normalizeMappingText(local.name));
    if (candidate) suggestions.set(local.id, candidate);
  }

  return localRecords
    .map((local) => {
      const mapping = activeCatalog.find((candidate) => candidate.localId === local.id) ?? null;
      const suggestion = mapping ? null : (suggestions.get(local.id) ?? null);
      return { ...local, mapping, suggestion };
    })
    .sort((left, right) => {
      if (Boolean(left.mapping) !== Boolean(right.mapping)) return left.mapping ? 1 : -1;
      if (left.active !== right.active) return left.active ? -1 : 1;
      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    });
}

export function catalogSearchText(mapping: QboExternalEntityMapping): string {
  return normalizeMappingText(
    [mapping.displayName, mappingCode(mapping), mapping.externalId].filter(Boolean).join(' '),
  );
}

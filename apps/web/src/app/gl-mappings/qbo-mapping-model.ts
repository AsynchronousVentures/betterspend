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

function matchRank(local: LocalMappingRecord, external: QboExternalEntityMapping): number {
  const localName = normalizeMappingText(local.name);
  const localCode = normalizeMappingText(local.code);
  const externalName = normalizeMappingText(external.displayName);
  const externalCode = normalizeMappingText(mappingCode(external));

  if (localCode && localCode === externalCode) return 2;
  if (localName && localName === externalName) return 1;
  return 0;
}

export function mappingCode(mapping: QboExternalEntityMapping): string | null {
  if (!mapping.payload || typeof mapping.payload !== 'object' || Array.isArray(mapping.payload)) {
    return null;
  }
  const payload = mapping.payload as Record<string, unknown>;
  for (const key of ['AcctNum', 'DisplayName', 'Name']) {
    if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key].trim();
  }
  return null;
}

export function mappingRows(
  localRecords: LocalMappingRecord[],
  mappings: QboExternalEntityMapping[],
): LocalMappingRow[] {
  const activeCatalog = mappings.filter((mapping) => mapping.isActive && !mapping.isDeleted);
  const available = activeCatalog.filter((mapping) => mapping.localId === null);
  const suggestions = new Map<string, QboExternalEntityMapping>();
  const availableIds = new Set(available.map((mapping) => mapping.id));

  const suggestionPairs = localRecords
    .filter((local) => !activeCatalog.some((mapping) => mapping.localId === local.id))
    .flatMap((local) =>
      available.map((mapping) => ({ local, mapping, rank: matchRank(local, mapping) })),
    )
    .filter((pair) => pair.rank > 0)
    .sort(
      (left, right) =>
        right.rank - left.rank ||
        left.local.name.localeCompare(right.local.name) ||
        left.local.id.localeCompare(right.local.id) ||
        left.mapping.externalEntity.localeCompare(right.mapping.externalEntity) ||
        left.mapping.id.localeCompare(right.mapping.id),
    );

  for (const pair of suggestionPairs) {
    if (suggestions.has(pair.local.id) || !availableIds.has(pair.mapping.id)) continue;
    suggestions.set(pair.local.id, pair.mapping);
    availableIds.delete(pair.mapping.id);
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
      return left.name.localeCompare(right.name);
    });
}

export function catalogSearchText(mapping: QboExternalEntityMapping): string {
  return normalizeMappingText(
    [mapping.displayName, mappingCode(mapping), mapping.externalId].filter(Boolean).join(' '),
  );
}

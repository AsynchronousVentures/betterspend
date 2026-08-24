import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

type Journal = {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

type Snapshot = {
  id: string;
  prevId: string;
};

const migrationsDirectory = path.resolve(__dirname, 'migrations');
const metadataDirectory = path.join(migrationsDirectory, 'meta');

function fail(message: string): never {
  throw new Error(`Invalid migration history: ${message}`);
}

async function main(): Promise<void> {
  const journal = JSON.parse(
    await readFile(path.join(metadataDirectory, '_journal.json'), 'utf8'),
  ) as Journal;
  const files = await readdir(migrationsDirectory);
  const sqlTags = files
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.slice(0, -'.sql'.length))
    .sort();
  const journalTags = journal.entries.map((entry) => entry.tag).sort();

  if (JSON.stringify(sqlTags) !== JSON.stringify(journalTags)) {
    fail('SQL files and journal entries do not match. Generate and commit them together.');
  }

  for (const [position, entry] of journal.entries.entries()) {
    if (entry.idx !== position) {
      fail(`journal entry ${entry.tag} has idx ${entry.idx}; expected ${position}`);
    }
    const previous = journal.entries[position - 1];
    if (previous && entry.when <= previous.when) {
      fail(`journal timestamp for ${entry.tag} must be later than ${previous.tag}`);
    }
  }

  const snapshotFiles = (await readdir(metadataDirectory)).filter((file) =>
    file.endsWith('_snapshot.json'),
  );
  const snapshots = await Promise.all(
    snapshotFiles.map(async (file) => ({
      file,
      snapshot: JSON.parse(await readFile(path.join(metadataDirectory, file), 'utf8')) as Snapshot,
    })),
  );
  const snapshotsById = new Map(snapshots.map(({ file, snapshot }) => [snapshot.id, file]));
  if (snapshotsById.size !== snapshots.length) fail('snapshot IDs must be unique');

  const childrenByParent = new Map<string, string[]>();
  for (const { file, snapshot } of snapshots) {
    if (
      snapshot.prevId !== '00000000-0000-0000-0000-000000000000' &&
      !snapshotsById.has(snapshot.prevId)
    ) {
      fail(`${file} points to missing parent snapshot ${snapshot.prevId}`);
    }
    const children = childrenByParent.get(snapshot.prevId) ?? [];
    children.push(file);
    childrenByParent.set(snapshot.prevId, children);
  }
  for (const [parent, children] of childrenByParent) {
    if (children.length > 1)
      fail(`snapshot ${parent} has multiple children: ${children.join(', ')}`);
  }

  const latest = journal.entries.at(-1);
  if (!latest) fail('journal is empty');
  const expectedSnapshot = `${latest.tag.split('_', 1)[0]}_snapshot.json`;
  if (!snapshotFiles.includes(expectedSnapshot)) {
    fail(`latest migration ${latest.tag} is missing ${expectedSnapshot}`);
  }

  console.log(`Migration history is consistent (${journal.entries.length} migrations).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

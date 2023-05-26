import { expect, test } from '@jest/globals';
import { migrateDocument } from './document';
import { Document } from './editor/types';
import { unstable as Automerge } from '@automerge/automerge';
import * as fs from 'fs';

function testMigrate(baseName: string) {
  const doc = Automerge.load(fs.readFileSync(`testData/${baseName}.dat`, null));
  const golden = JSON.parse(fs.readFileSync(`testData/${baseName}.json`, 'utf8'));

  const migrated = migrateDocument(doc as Automerge.Doc<Document>);

  expect(JSON.parse(JSON.stringify(migrated))).toStrictEqual(golden);
}

test('migrateV1', () => {
  testMigrate('docV1');
});

test('migrateV2', () => {
  testMigrate('docV2');
});

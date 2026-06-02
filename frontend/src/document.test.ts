import { expect, test } from '@jest/globals';
import { migrateDocument } from './document';
import { Document } from './editor/types';
import { next as Automerge } from '@automerge/automerge';
import * as fs from 'fs';
import { getSpeakerIDs } from './utils/document';

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

test('getSpeakerIDs keeps existing speaker color order stable', () => {
  const doc: Document = {
    children: [
      {
        type: 'paragraph',
        speaker: 'speaker-b',
        lang: 'en',
        children: [{ text: 'hello' }],
      },
      {
        type: 'paragraph',
        speaker: 'speaker-a',
        lang: 'en',
        children: [{ text: 'world' }],
      },
      {
        type: 'paragraph',
        speaker: 'speaker-c',
        lang: 'en',
        children: [{ text: 'again' }],
      },
    ],
    speaker_names: {
      'speaker-a': 'Alice',
      'speaker-b': 'Bob',
      'speaker-c': 'Charlie',
    },
    version: 3,
  };

  expect(getSpeakerIDs(doc)).toStrictEqual(['speaker-a', 'speaker-b', 'speaker-c']);
});

test('getSpeakerIDs appends unnamed speakers after known ones', () => {
  const doc: Document = {
    children: [
      {
        type: 'paragraph',
        speaker: 'speaker-a',
        lang: 'en',
        children: [{ text: 'hello' }],
      },
      {
        type: 'paragraph',
        speaker: 'speaker-z',
        lang: 'en',
        children: [{ text: 'world' }],
      },
      {
        type: 'paragraph',
        speaker: null,
        lang: 'en',
        children: [{ text: 'again' }],
      },
    ],
    speaker_names: {
      'speaker-a': 'Alice',
    },
    version: 3,
  };

  expect(getSpeakerIDs(doc)).toStrictEqual(['speaker-a', 'speaker-z']);
});

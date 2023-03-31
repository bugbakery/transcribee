import { Descendant, Editor, Transforms, Element } from 'slate';
import * as Automerge from '@automerge/automerge';
import { JSONTree } from 'react-json-tree';
import { getBase16Theme } from 'react-base16-styling';
import { Document } from './types';

export type DebugPanelProps = {
  value: Descendant[];
  doc: Automerge.Doc<Document>;
  editor: Editor;
};

export function DebugPanel({ value, doc, editor }: DebugPanelProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 h-96 p-8">
      <div className="w-full h-full p-4 text-sm bg-white border-black border-2 shadow-brutal rounded-lg overflow-auto">
        <JSONTree data={value} theme={getBase16Theme('summerfruit:inverted')} />
      </div>

      <div className="absolute top-12 right-12 flex flex-col gap-2">
        <Button
          onClick={() => {
            const update = Automerge.save(doc);
            console.log(update);
          }}
        >
          Log document to console
        </Button>
        <Button
          onClick={() => {
            // exampleElement has to be copied so slate does not produce duplicate keys
            Transforms.insertNodes(editor, { ...exampleElement }, { at: [0] });
          }}
        >
          Insert elements
        </Button>
      </div>
    </div>
  );
}

function Button(props: JSX.IntrinsicElements['button']) {
  return (
    <button
      className={
        'py-2 px-4 border-2 border-black text-sm font-medium rounded-md hover:bg-slate-100 ' +
        props.className
      }
      {...props}
    />
  );
}

const exampleElement: Element = {
  type: 'paragraph',
  lang: 'de',
  speaker: 0,
  alternative_speakers: [0, 1, 2],
  children: [
    { text: 'hallo ', start: 0.33, end: 0.75, conf: 1 },
    { text: 'und ', start: 0.75, end: 0.87, conf: 1 },
    { text: 'herzlich ', start: 0.87, end: 1.2, conf: 1 },
    { text: 'willkommen ', start: 1.2, end: 1.71, conf: 1 },
    { text: 'zum ', start: 1.71, end: 2.01, conf: 1 },
    { text: 'public ', start: 2.01, end: 2.4, conf: 1 },
    { text: 'interest ', start: 2.4, end: 2.76, conf: 1 },
    { text: 'podcast ', start: 2.76, end: 3.36, conf: 1 },
    { text: 'ich ', start: 3.96, end: 4.11, conf: 1 },
    { text: 'bin ', start: 4.11, end: 4.26, conf: 1 },
    { text: 'patricia ', start: 4.26, end: 4.89, conf: 0.991857 },
    { text: 'beim ', start: 4.89, end: 5.04, conf: 1 },
    { text: 'team ', start: 5.04, end: 5.25, conf: 0.998888 },
    { text: 'portofrei ', start: 5.250133, end: 5.7, conf: 0.251196 },
    { text: 'pfand ', start: 5.700513, end: 6.12, conf: 0.515438 },
    { text: 'verantwortlich ', start: 6.140566, end: 6.93, conf: 1 },
    { text: 'für ', start: 6.93, end: 7.05, conf: 1 },
    { text: 'die ', start: 7.05, end: 7.14, conf: 1 },
    { text: 'kommunikation ', start: 7.14, end: 8.01, conf: 1 },
    { text: 'zum ', start: 8.46, end: 8.639981, conf: 0.921533 },
    { text: 'brother ', start: 8.639981, end: 9.03, conf: 0.821717 },
    { text: 'pfand ', start: 9.030366, end: 9.36, conf: 0.817185 },
    { text: 'athen ', start: 9.36, end: 9.63, conf: 0.668703 },
    { text: 'wir ', start: 9.63, end: 9.689959, conf: 0.973679 },
    { text: 'euch ', start: 9.689959, end: 9.84, conf: 1 },
    { text: 'gerne ', start: 9.84, end: 10.17, conf: 1 },
    { text: 'später ', start: 10.17, end: 10.5, conf: 1 },
    { text: 'noch ', start: 10.5, end: 10.62, conf: 0.989069 },
    { text: 'etwas ', start: 10.62, end: 11.22, conf: 1 },
    { text: 'zuerst ', start: 11.28, end: 11.67, conf: 1 },
    { text: 'einmal ', start: 11.67, end: 11.939997, conf: 1 },
    { text: 'salz ', start: 11.94, end: 12.209886, conf: 0.844301 },
    { text: 'aber ', start: 12.209886, end: 12.39, conf: 1 },
    { text: 'kurz ', start: 12.39, end: 12.69, conf: 1 },
    { text: 'um ', start: 12.69, end: 12.78, conf: 0.8009 },
    { text: 'diesen ', start: 12.78, end: 13.02, conf: 0.891668 },
    { text: 'podcast ', start: 13.02, end: 13.59, conf: 1 },
    { text: 'gehen ', start: 13.59, end: 13.98, conf: 0.996181 },
    { text: 'hier ', start: 14.34, end: 14.549999, conf: 0.889978 },
    { text: 'wollen ', start: 14.549999, end: 14.758819, conf: 0.665571 },
    { text: 'wir ', start: 14.76, end: 14.819946, conf: 0.636465 },
    { text: 'euch ', start: 14.819946, end: 14.909999, conf: 0.637013 },
    { text: 'nämlich ', start: 14.910026, end: 15.18, conf: 0.999706 },
    { text: 'das ', start: 15.18, end: 15.33, conf: 0.974864 },
    { text: 'themenfeld ', start: 15.33, end: 15.87, conf: 1 },
    { text: 'technologie ', start: 15.87, end: 16.5, conf: 1 },
    { text: 'im ', start: 16.5, end: 16.59, conf: 1 },
    { text: 'öffentlichen ', start: 16.59, end: 17.04, conf: 1 },
    { text: 'interesse ', start: 17.04, end: 17.67, conf: 1 },
    { text: 'oder ', start: 17.7, end: 17.940031, conf: 1 },
    { text: 'auch ', start: 17.940031, end: 18.06, conf: 0.992137 },
    { text: 'public ', start: 18.06, end: 18.39, conf: 1 },
    { text: 'interest ', start: 18.39, end: 18.72, conf: 1 },
    { text: 'technologie ', start: 18.72, end: 19.29, conf: 1 },
    { text: 'vorstellen ', start: 19.29, end: 20.01, conf: 1 },
    { text: 'ihr ', start: 20.22, end: 20.34, conf: 0.976207 },
    { text: 'fragt ', start: 20.34, end: 20.55, conf: 0.998369 },
    { text: 'euch ', start: 20.55, end: 20.64, conf: 0.9456 },
    { text: 'vielleicht ', start: 20.64, end: 20.94, conf: 1 },
    { text: 'was ', start: 20.94, end: 21.12, conf: 1 },
    { text: 'das ', start: 21.12, end: 21.3, conf: 1 },
    { text: 'ist ', start: 21.33, end: 21.72, conf: 1 },
    { text: 'und ', start: 22.11, end: 22.229998, conf: 0.999821 },
    { text: 'warum ', start: 22.229998, end: 22.47, conf: 1 },
    { text: 'wir ', start: 22.47, end: 22.53, conf: 1 },
    { text: 'uns ', start: 22.53, end: 22.62, conf: 1 },
    { text: 'überhaupt ', start: 22.62, end: 22.92, conf: 1 },
    { text: 'damit ', start: 22.92, end: 23.13, conf: 0.979396 },
    { text: 'befassen ', start: 23.13, end: 23.73, conf: 1 },
    { text: 'genau ', start: 24, end: 24.3, conf: 1 },
    { text: 'das ', start: 24.3, end: 24.57, conf: 1 },
    { text: 'wollen ', start: 24.57, end: 24.75, conf: 0.997422 },
    { text: 'wir ', start: 24.75, end: 24.84, conf: 1 },
    { text: 'in ', start: 24.84, end: 24.9, conf: 1 },
    { text: 'dieser ', start: 24.9, end: 25.23, conf: 1 },
    { text: 'ersten ', start: 25.23, end: 25.59, conf: 0.997321 },
    { text: 'episode ', start: 25.59, end: 26.04, conf: 1 },
    { text: 'klären ', start: 26.04, end: 26.4, conf: 1 },
    { text: 'um ', start: 26.4, end: 26.548248, conf: 0.97555 },
    { text: 'euch ', start: 26.548248, end: 26.67, conf: 0.99645 },
    { text: 'einen ', start: 26.67, end: 26.85, conf: 1 },
    { text: 'überblick ', start: 26.85, end: 27.27, conf: 1 },
    { text: 'zu ', start: 27.27, end: 27.42, conf: 1 },
    { text: 'geben ', start: 27.42, end: 27.84, conf: 1 },
    { text: 'der ', start: 28.08, end: 28.23, conf: 0.990763 },
    { text: 'podcast ', start: 28.23, end: 28.59, conf: 0.96107 },
    { text: 'funktioniert ', start: 28.59, end: 29.04, conf: 1 },
    { text: 'so ', start: 29.04, end: 29.28, conf: 1 },
    { text: 'dass ', start: 29.28, end: 29.49, conf: 0.965079 },
    { text: 'wir ', start: 29.49, end: 29.61, conf: 1 },
    { text: 'in ', start: 29.61, end: 29.7, conf: 1 },
    { text: 'jeder ', start: 29.7, end: 30, conf: 1 },
    { text: 'folge ', start: 30, end: 30.39, conf: 1 },
    { text: 'einen ', start: 30.39, end: 30.54, conf: 0.996468 },
    { text: 'anderen ', start: 30.54, end: 30.99, conf: 1 },
    { text: 'schwerpunkt ', start: 30.99, end: 31.65, conf: 1 },
    { text: 'präsentieren ', start: 31.65, end: 32.37, conf: 1 },
    { text: 'der ', start: 32.37, end: 32.58, conf: 1 },
    { text: 'von ', start: 32.58, end: 33.03, conf: 1 },
    { text: 'expertinnen ', start: 33.09, end: 33.87, conf: 1 },
    { text: 'inhaltlich ', start: 33.87, end: 34.32, conf: 1 },
    { text: 'vorgestellt ', start: 34.32, end: 34.92, conf: 1 },
    { text: 'wird ', start: 34.92, end: 35.16, conf: 1 },
    { text: 'und ', start: 35.16, end: 35.4, conf: 1 },
    { text: 'dann ', start: 35.4, end: 35.699399, conf: 1 },
    { text: 'an ', start: 35.7, end: 35.82, conf: 0.979958 },
    { text: 'konkreten ', start: 35.82, end: 36.36, conf: 1 },
    { text: 'projekten ', start: 36.36, end: 36.75, conf: 1 },
    { text: 'veranschaulicht ', start: 36.75, end: 37.38, conf: 1 },
    { text: 'wird ', start: 37.38, end: 37.68, conf: 1 },
    { text: 'die ', start: 38.04, end: 38.13, conf: 0.987996 },
    { text: 'bandbreite ', start: 38.13, end: 38.97, conf: 1 },
    { text: 'der ', start: 38.97, end: 39.24, conf: 1 },
    { text: 'verschiedenen ', start: 39.24, end: 39.69, conf: 0.99676 },
    { text: 'schwerpunkte ', start: 39.69, end: 40.23, conf: 0.999945 },
    { text: 'die ', start: 40.23, end: 40.38, conf: 1 },
    { text: 'wir ', start: 40.38, end: 40.59, conf: 1 },
    { text: 'vorstellen ', start: 40.65, end: 41.07, conf: 1 },
    { text: 'werden ', start: 41.07, end: 41.31, conf: 1 },
    { text: 'ist ', start: 41.31, end: 41.429308, conf: 0.930277 },
    { text: 'dabei ', start: 41.429308, end: 41.67, conf: 1 },
    { text: 'sehr ', start: 41.67, end: 41.85, conf: 1 },
    { text: 'breit ', start: 41.85, end: 42.45, conf: 1 },
    { text: 'es ', start: 42.66, end: 42.84, conf: 0.976255 },
    { text: 'wird ', start: 42.84, end: 42.989956, conf: 1 },
    { text: 'um ', start: 42.99, end: 43.08, conf: 0.809083 },
    { text: 'nachhaltigkeit ', start: 43.08, end: 43.8, conf: 1 },
    { text: 'gehen ', start: 43.8, end: 44.094954, conf: 0.998526 },
    { text: 'es ', start: 44.1, end: 44.22, conf: 0.801305 },
    { text: 'wird ', start: 44.22, end: 44.339952, conf: 0.9956 },
    { text: 'zum ', start: 44.339952, end: 44.46, conf: 1 },
    { text: 'beispiel ', start: 44.46, end: 44.73, conf: 1 },
  ],
};

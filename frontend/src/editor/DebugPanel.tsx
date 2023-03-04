import { Descendant, Editor, Transforms, Element } from 'slate';
import * as Y from 'yjs';
import { JSONTree } from 'react-json-tree';
import { getBase16Theme } from 'react-base16-styling';

export type DebugPanelProps = {
  value: Descendant[];
  yDoc: Y.Doc;
  editor: Editor;
};

export default function DebugPanel({ value, yDoc, editor }: DebugPanelProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 h-96 p-8">
      <div className="w-full h-full p-4 text-sm bg-white border-black border-2 shadow-brutal rounded-lg overflow-auto">
        <JSONTree data={value} theme={getBase16Theme('summerfruit:inverted')} />
      </div>

      <div className="absolute top-12 right-12 flex flex-col gap-2">
        <Button
          onClick={() => {
            const update = Y.encodeStateAsUpdate(yDoc);
            Y.logUpdate(update);
          }}
        >
          Log update to console
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
  speaker: 'speaker 1',
  children: [
    { text: '[_BEG_]', start: 0.0, end: 0.0, conf: 0.9997406601905823 },
    { text: ' But', start: 0.0, end: 67.0, conf: 0.246378093957901 },
    { text: ' Ter', start: 89.0, end: 134.0, conf: 0.635551393032074 },
    { text: 'ran', start: 134.0, end: 201.0, conf: 0.9926343560218811 },
    { text: ' answers', start: 201.0, end: 338.0, conf: 1.0 },
    { text: ' to', start: 374.0, end: 401.0, conf: 1.0 },
    { text: ' something', start: 401.0, end: 602.0, conf: 1.0 },
    { text: ' even', start: 602.0, end: 690.0, conf: 1.0 },
    { text: ' more', start: 690.0, end: 778.0, conf: 1.0 },
    { text: ' powerful', start: 779.0, end: 841.0, conf: 1.0 },
    { text: ' than', start: 972.0, end: 1046.0, conf: 1.0 },
    { text: ' his', start: 1048.0, end: 1115.0, conf: 1.0 },
    { text: ' queen', start: 1115.0, end: 1227.0, conf: 0.9973636865615845 },
    { text: '.', start: 1227.0, end: 1283.0, conf: 1.0 },
    { text: '[_TT_650]', start: 1300.0, end: 1300.0, conf: 0.6531545519828796 },
    { text: '[_BEG_]', start: 0.0, end: 0.0, conf: 1.0 },
    { text: ' In', start: 56.0, end: 139.0, conf: 0.9995509386062622 },
    { text: ' order', start: 149.0, end: 485.0, conf: 1.0 },
    { text: ' to', start: 623.0, end: 667.0, conf: 1.0 },
    { text: '...', start: 667.0, end: 1326.0, conf: 0.9931267499923706 },
    { text: '[_TT_668]', start: 1336.0, end: 1336.0, conf: 0.5544350743293762 },
    { text: '[_BEG_]', start: 0.0, end: 0.0, conf: 0.32422611117362976 },
    { text: ' Have', start: 0.0, end: 898.0, conf: 0.19770404696464539 },
    { text: ' you', start: 898.0, end: 923.0, conf: 0.9546799659729004 },
    { text: ' seen', start: 929.0, end: 957.0, conf: 0.875575840473175 },
    { text: ' Tar', start: 957.0, end: 982.0, conf: 0.18711978197097778 },
    { text: 'an', start: 982.0, end: 1000.0, conf: 0.5616739392280579 },
    { text: ' around', start: 1000.0, end: 1008.0, conf: 0.5034716725349426 },
    { text: ' Juliet', start: 1008.0, end: 1255.0, conf: 0.7905431985855103 },
    { text: 'te', start: 1274.0, end: 1326.0, conf: 0.5870853066444397 },
    { text: '?', start: 1326.0, end: 1326.0, conf: 0.829896092414856 },
    { text: ' Have', start: 1326.0, end: 1326.0, conf: 0.5608336329460144 },
    { text: ' you', start: 1326.0, end: 1326.0, conf: 0.9826167225837708 },
    { text: ' heard', start: 1326.0, end: 1326.0, conf: 0.9744381904602051 },
    { text: ' him', start: 1326.0, end: 1326.0, conf: 0.9227977991104126 },
    { text: ' talk', start: 1326.0, end: 1326.0, conf: 0.9783117771148682 },
    { text: ' about', start: 1326.0, end: 1326.0, conf: 0.9392410516738892 },
    { text: ' her', start: 1326.0, end: 1326.0, conf: 0.9236183762550354 },
    { text: '?', start: 1326.0, end: 1326.0, conf: 0.9291027784347534 },
    { text: '[_TT_750]', start: 1500.0, end: 1500.0, conf: 0.012800261378288269 },
    { text: '[_BEG_]', start: 0.0, end: 0.0, conf: 0.11311309784650803 },
    { text: ' Yes', start: 61.0, end: 200.0, conf: 0.5021396279335022 },
    { text: ',', start: 200.0, end: 203.0, conf: 0.6267169117927551 },
    { text: ' me', start: 217.0, end: 234.0, conf: 0.27292293310165405 },
    { text: ' call', start: 274.0, end: 274.0, conf: 0.1510203331708908 },
    { text: ' agrees', start: 280.0, end: 280.0, conf: 0.2620234787464142 },
    { text: '.', start: 280.0, end: 283.0, conf: 0.6534897685050964 },
    { text: ' Ter', start: 283.0, end: 286.0, conf: 0.23290054500102997 },
    { text: 'ren', start: 286.0, end: 289.0, conf: 0.2142447829246521 },
    { text: ' O', start: 289.0, end: 290.0, conf: 0.23343688249588013 },
    { text: "'", start: 290.0, end: 291.0, conf: 0.15709441900253296 },
    { text: 'B', start: 291.0, end: 292.0, conf: 0.6896660923957825 },
    { text: 'ays', start: 292.0, end: 298.0, conf: 0.14219392836093903 },
    { text: ' the', start: 298.0, end: 336.0, conf: 0.729391872882843 },
    { text: ' Queen', start: 336.0, end: 400.0, conf: 0.9003300666809082 },
    { text: ' like', start: 400.0, end: 449.0, conf: 0.5530081987380981 },
    { text: ' a', start: 449.0, end: 461.0, conf: 0.9787671566009521 },
    { text: ' dog', start: 461.0, end: 475.0, conf: 0.971691370010376 },
    { text: '.', start: 500.0, end: 534.0, conf: 0.7049257755279541 },
    { text: ' He', start: 556.0, end: 556.0, conf: 0.6904150247573853 },
    { text: "'d", start: 564.0, end: 580.0, conf: 0.7506772875785828 },
    { text: ' sooner', start: 580.0, end: 621.0, conf: 0.8627233505249023 },
    { text: ' die', start: 621.0, end: 642.0, conf: 0.8906152248382568 },
    { text: ' than', start: 642.0, end: 664.0, conf: 0.8568443059921265 },
    { text: ' in', start: 664.0, end: 672.0, conf: 0.4533132016658783 },
    { text: ' s', start: 673.0, end: 677.0, conf: 0.2615366578102112 },
    { text: 'ultan', start: 677.0, end: 696.0, conf: 0.22725430130958557 },
    { text: '.', start: 700.0, end: 700.0, conf: 0.7949462532997131 },
    { text: '[_TT_350]', start: 700.0, end: 700.0, conf: 0.012891086749732494 },
    { text: ' Even', start: 701.0, end: 719.0, conf: 0.7706617712974548 },
    { text: ' Gem', start: 745.0, end: 779.0, conf: 0.5756630897521973 },
    { text: 'ma', start: 779.0, end: 801.0, conf: 0.9966410994529724 },
    { text: ',', start: 801.0, end: 822.0, conf: 0.7514723539352417 },
    { text: ' who', start: 823.0, end: 857.0, conf: 0.979428231716156 },
    { text: ' has', start: 875.0, end: 891.0, conf: 0.7660132646560669 },
    { text: ' been', start: 891.0, end: 936.0, conf: 0.9906219244003296 },
    { text: ' quiet', start: 936.0, end: 991.0, conf: 0.9900496006011963 },
    { text: ' until', start: 992.0, end: 1048.0, conf: 0.9503451585769653 },
    { text: ' now', start: 1048.0, end: 1081.0, conf: 0.9989476799964905 },
    { text: ',', start: 1082.0, end: 1104.0, conf: 0.9309973120689392 },
    { text: ' speaks', start: 1104.0, end: 1168.0, conf: 0.8511627912521362 },
    { text: ' up', start: 1175.0, end: 1198.0, conf: 0.9548329710960388 },
    { text: '.', start: 1200.0, end: 1200.0, conf: 0.9080995917320251 },
    { text: '[_TT_600]', start: 1200.0, end: 1200.0, conf: 0.3155324161052704 },
    { text: '[_BEG_]', start: 1200.0, end: 1200.0, conf: 0.13113942742347717 },
    { text: ' .', start: 1200.0, end: 1202.0, conf: 0.15266373753547668 },
    { text: '[_TT_272]', start: 1744.0, end: 1744.0, conf: 0.0006679632351733744 },
  ],
};

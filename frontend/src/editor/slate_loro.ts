import { Transforms, Editor, BaseEditor } from 'slate';

import { isContainer, LoroEventBatch, LoroList, LoroMap, LoroText, UndoManager } from 'loro-crdt';
import { applySlateOps } from './loro_apply';
import { RootedLoroDoc } from './types';
import { deepEqual } from 'fast-equals';

type onDocChangeCallback<T> = (doc: RootedLoroDoc<T>) => void;

export type LoroEditor<T> = BaseEditor & {
  isRemote: boolean;
  _doc: RootedLoroDoc<T>;
  docProxy: T;
  addDocChangeListener: (callback: onDocChangeCallback<RootedLoroDoc<T>>) => void;
  removeDocChangeListener: (callback: onDocChangeCallback<RootedLoroDoc<T>>) => void;
  // setDoc: (doc: Automerge.Doc<T>) => void;
  _callbacks: Set<onDocChangeCallback<RootedLoroDoc<T>>>;
  v: number;
};

export function withLoroDoc<DT, T extends Editor>(editor: T, doc: RootedLoroDoc<DT>): T & LoroEditor<DT> {
  const e = editor as T & LoroEditor<DT>;
  e.isRemote = false;
  e._doc = doc;

  e._undoManager = new UndoManager(doc, {});

  const proxy = {
    get(target, property, receiver) {
      if (typeof property == "symbol") {
        return Reflect.get(target, property);
      } else {

        const res = target.get(property);
        if (res instanceof LoroText) {
          return res.toString();
        } else if (isContainer(res)) {
          return new Proxy(res, proxy);
        } else {
          return res;
        }
      }
    }
  };

  e.docProxy = new Proxy(doc.getMap("root"), proxy);

  e._callbacks = new Set();
  e.v = 0;

  e._doc.getMap("root").get("children").subscribe((event) => {
    e.isRemote = true;
    Editor.withoutNormalizing(e, () => {
      console.log(e.children)
      console.log(e._doc.getMap("root").get("children").toJSON())
      applyLoroEventBatch(e, event);
    });
    if (!deepEqual(e._doc.getMap("root").get("children").toJSON(), e.children)) {
      console.log(e._doc.getMap("root").get("children").toJSON())
      console.log(e.children)
      throw Error("its fucked");
    }
    // e.isRemote = false;

    Promise.resolve().then(() => (e.isRemote = false));
  });

  // TODO(robin): these are fully broken I think, replace by other shit
  function callOnDocChange(e: LoroEditor<DT>) {
    e._callbacks.forEach((cb) => cb(e._doc));
  }

  e.addDocChangeListener = (cb) => {
    e._callbacks.add(cb);
  };

  e.removeDocChangeListener = (cb) => {
    e._callbacks.delete(cb);
  };

  // e.setDoc = (newDoc) => {
  //   const oldDoc = e.doc;
  //   e.doc = initialDoc;

  //   e.isRemote = true;
  //   Editor.withoutNormalizing(e, () => {
  //     // updateNode(e, currentDocCopy, newDocView);
  //     updateNode(e, oldDoc, newDoc);
  //   });
  //   Promise.resolve().then(() => (e.isRemote = false));
  //   e.doc = newDoc;
  //   e.v += 1;
  //   callOnDocChange(e);
  // };

  const oldOnChange = e.onChange;

  // use varargs to support future slate versions
  e.onChange = (...args) => {
    oldOnChange(...args);

    if (!e.isRemote) {
      if (e.operations.length > 0) {
        if (e.operations.some((op) => op.type != 'set_selection')) {
          applySlateOps(e._doc, e.operations);
          // TODO(robin): remove for debug
          if (!deepEqual(e._doc.getMap("root").get("children").toJSON(), e.children)) {
            console.log(e._doc.getMap("root").get("children").toJSON())
            console.log(e.children)
            throw Error("its fucked");
          }
          e._doc.commit();

          // const newDoc = Automerge.change(e.doc, (draft) => {
          //   // apply all outstanding operations
          //   e.operations.forEach((op) => {
          //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
          //     applyOperation(draft as any, op);
          //   });
          // });

          // e.doc = newDoc;
          e.v += 1;
          callOnDocChange(e);
        }
      }
    }
  };

  return e;
}

function applyLoroEventBatch<T extends LoroEditor>(e: T, event: LoroEventBatch) {
  // console.log("the diff", e._doc.diff(event.from, event.to))
  console.log(event);
  if (event.by !== "local" || event.origin === "undo") {
    let i = 0;
    for (const ev of event.events) {
      // if (i === event.events.length - 2) {
      //   break;
      // }
      // i += 1;
      const diff = ev.diff;
      const path = ev.path.slice(2).filter((_, idx) => idx % 2 == 0);
      console.log(JSON.stringify(path))
      if (diff.type === 'list') {
        let listPos = 0;
        for (const entry of diff.diff) {
          if (entry.delete) {
            let where = [...path, listPos];
            for (var deleted = 0; deleted < entry.delete; deleted++) {
              Transforms.removeNodes(e, { at: where });
            }
            // TODO(robin): how to use this?
            // if (entry.delete > 1) {
            //   where = Editor.range(e, [...path, listPos], [...path, listPos + entry.delete]);
            // }
            console.log("remove", where);
            // Range.foreach()
          } else if (entry.insert) {
            const convertedEntry = entry.insert.map((e) => {
              if (e instanceof LoroMap) {
                if (e.get("children")) {
                  return { children: [] };
                } else if (e.get("text")) {
                  return { text: "" };
                } else {
                  return {};
                }
              } else if (e instanceof LoroList) {
                return [];
              } else if (e instanceof LoroText) {
                return "";
              } else {
                return e;
              }
            });
            console.log("insert", convertedEntry, [...path, listPos]);
            Transforms.insertNodes(e, convertedEntry, { at: [...path, listPos] });
            listPos += entry.insert.length;
          } else if (entry.retain) {
            listPos += entry.retain;
          }
        }
      } else if (diff.type === 'map') {
        let converted = {};
        for (const [key, value] of Object.entries(diff.updated)) {
          if (value instanceof LoroMap) {
            if (value.get("children")) {
              converted[key] = { children: [] };
            } else if (value.get("text")) {
              converted[key] = { text: "" };
            } else {
              converted[key] = {};
            }
          } else if (value instanceof LoroList) {
            converted[key] = [];
          } else if (value instanceof LoroText) {
            converted[key] = "";
          } else {
            converted[key] = value;
          }
        }
        console.log("setNodes", converted, path);
        Transforms.setNodes(e, converted, { at: path });
      } else if (diff.type === 'text') {
        let textPos = 0;
        for (const entry of diff.diff) {
          if (entry.delete) {
            Transforms.delete(e, {
              at: { path: path, offset: textPos },
              distance: entry.delete,
              unit: 'character',
            });
          } else if (entry.insert) {
            Transforms.insertText(e, entry.insert, { at: { path: path, offset: textPos } });
            textPos += entry.insert.length;
          } else if (entry.retain) {
            textPos += entry.retain;
          }
        }
      } else {
        console.assert(false, `unhandled diff type ${diff.type}`);
      }
    }
  }
}

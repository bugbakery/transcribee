import { Container, LoroDoc, LoroList, LoroMap, LoroText, Value } from 'loro-crdt';
import { Operation } from 'slate';

// the loro types are a bit shit
// this should be a union, but thats not how the loro types work :(
type SlateNode = { children: LoroList<LoroMap<SlateNode>>; text: LoroText };

function getChildren(doc: LoroMap<SlateNode>, path: number[]): LoroList {
  let list = doc.get('children');
  for (const idx of path) {
    list = list.get(idx).getOrCreateContainer('children', new LoroList());
  }
  return list;
}

function getNode(doc: LoroMap<SlateNode>, path: number[]): LoroMap {
  let node = doc;
  for (const idx of path) {
    node = node.getOrCreateContainer('children', new LoroList<LoroMap<SlateNode>>()).get(idx);
  }
  return node;
}

function isContainer(val: Value | Container): val is Container {
  return val instanceof Object && 'kind' in val && typeof val['kind'] === 'function';
}

function listPush(obj: LoroList, val: Value | Container) {
  if (isContainer(val)) {
    obj.pushContainer(val);
  } else {
    obj.push(val);
  }
}

/*
function listInsert(obj: LoroList, idx: number, val: Value | Container) {
  if (isContainer(val)) {
    obj.insertContainer(idx, val);
  } else {
    obj.insert(idx, val);
  }
}
*/

function mapSet(obj: LoroMap, key: string, val: Value | Container) {
  if (isContainer(val)) {
    obj.setContainer(key, val);
  } else {
    obj.set(key, val);
  }
}

export function convertToLoro(obj: any, hint?: string) {
  if (obj instanceof Array) {
    const list = new LoroList();
    for (const entry of obj) {
      listPush(list, convertToLoro(entry));
    }
    return list;
  } else if (obj instanceof Object) {
    const map = new LoroMap();
    for (const [key, value] of Object.entries(obj)) {
      mapSet(map, key, convertToLoro(value, key));
    }
    return map;
  } else if (typeof obj === 'string' && (hint == "text")) {
    const txt = new LoroText();
    txt.push(obj);
    return txt;
  } else {
    return obj;
  }
}

const applyOperation = (doc: LoroMap<SlateNode>, op: Operation): LoroMap<SlateNode> => {
  console.log(op);
  if (op.type === 'insert_node') {
    const idx = op.path.pop()!;
    getChildren(doc, op.path).insertContainer(idx, convertToLoro(op.node));
  } else if (op.type === 'set_node') {
    const entry = getNode(doc, op.path);
    const { newProperties } = op;
    for (const [key, value] of Object.entries(newProperties)) {
      if (value !== undefined) {
        mapSet(entry, key, convertToLoro(value));
      } else {
        entry.delete(key);
      }
    }
  } else if (op.type === 'remove_node') {
    const idx = op.path.pop()!;
    getChildren(doc, op.path).delete(idx, 1);
  } else if (op.type === 'merge_node') {
    const idx = op.path.pop()!;
    const prevIdx = idx - 1;

    const here = getNode(doc, [...op.path, idx]);
    const prev = getNode(doc, [...op.path, prevIdx]);

    // TODO(robin): better way for this?
    if (prev.keys().includes('text')) {
      (prev.get('text') as LoroText).push((here.get('text') as LoroText).toString());
    } else {
      const childs = here.get('children') as LoroList<LoroMap>;
      const prevChilds = prev.get('children') as LoroList;
      //  TODO(robin): is getShallowValue() and get by id better?
      for (var i = 0; i < childs.length; i++) {
        prevChilds.pushContainer(childs.get(i));
      }
    }
    (here.parent()! as LoroList).delete(idx, 1);
  } else if (op.type === 'split_node') {
    const here = getNode(doc, op.path);
    const idx = op.path.pop()!;
    const parent = here.parent() as LoroList;
    const next = {
      ...here.toJSON(),
      ...op.properties,
    };

    if (next.text != undefined) {
      if (next.text.length > op.position) {
        (here.get('text') as LoroText).delete(op.position, next.text.length - op.position);
      }
      if (op.position) {
        next.text = next.text.substring(op.position);
      }
    } else {
      (here.get('children') as LoroList).delete(op.position, next.children.length - op.position);
      op.position && next.children.splice(0, op.position);
    }

    (parent as LoroList).insertContainer(idx + 1, convertToLoro(next));
  } else if (op.type === 'move_node') {
    const node = getNode(doc, op.path);
    const oldParent = node.parent() as LoroList;
    const idx = op.path.pop()!;
    const newIdx = op.newPath.pop()!;
    const newParent = getChildren(doc, op.newPath);
    oldParent.delete(idx, 1);
    newParent.insertContainer(newIdx, node);
  } else if (op.type === 'insert_text') {
    getNode(doc, op.path).getOrCreateContainer('text', new LoroText()).insert(op.offset, op.text);
  } else if (op.type === 'remove_text') {
    (getNode(doc, op.path).get('text') as LoroText).delete(op.offset, op.text.length);
  } else if (op.type === 'set_selection') {
    // ....
  } else {
    const exhaustive: never = op;
    return exhaustive;
  }

  return doc;
};

// TODO(robin): types, ie can this restrict to LoroMap<SlateNodes> and the caller have that as a union type with whatever they use?
export const applySlateOps = (doc: LoroDoc<{ root: Container }>, ops: Operation[]) => {
  const root = doc.getMap('root');
  for (const op of ops) {
    applyOperation(root as LoroMap<SlateNode>, op);
  }
};

#!/usr/bin/env python3

from typing import Mapping, Sequence
import automerge
import sys

from loro import LoroDoc, ExportMode, LoroList, LoroMap, LoroText

from pathlib import Path

def setMap(map: LoroMap, key, val):
    if isinstance(val, (LoroMap, LoroList, LoroText)):
        map.insert_container(key, val);
    else:
        map.insert(key, val)

def pushList(list: LoroList, val):
    if isinstance(val, (LoroMap, LoroList, LoroText)):
        list.push_container(val)
    else:
        list.push(val)


def convert(val, hint = None):
    if isinstance(val, automerge.Mapping):
        res = LoroMap()
        for name, value in automerge.entries(val):
            setMap(res, name, convert(value, hint=name))
    elif isinstance(val, automerge.Sequence):
        res = LoroList()
        for value in val:
            pushList(res, convert(value))
    elif isinstance(val, automerge.Text):
        if hint is not None and hint == "text":
            res = LoroText()
            res.push_str(str(val))
        else:
            res = str(val)
    else:
        res = val
    return res


loroDoc = LoroDoc()

root = loroDoc.get_map("root")
doc = automerge.load(Path(sys.argv[1]).read_bytes())

for key, val in automerge.entries(doc):
    setMap(root, key, convert(val))

# sys.stdout.buffer.write(loroDoc.export(ExportMode.StateOnly(None)))
sys.stdout.buffer.write(loroDoc.export(ExportMode.ShallowSnapshot(loroDoc.oplog_frontiers)))
# print(loroDoc.get_deep_value())

# class Atom(BaseModel):
#     text: str
#     start: float  # in seconds
#     end: float  # in seconds
#     conf: float  # confidence ~ logit probability
#     conf_ts: float  # timestamp confidence


# class Paragraph(BaseModel):
#     type: Literal["paragraph"] = "paragraph"
#     speaker: Optional[str] = None
#     children: List[Atom]
#     lang: str

#     def text(self) -> str:
#         return "".join(a.text for a in self.children)

#     def start(self) -> Optional[float]:
#         if len(self.children) > 0:
#             return self.children[0].start

#     def end(self) -> Optional[float]:
#         if len(self.children) > 0:
#             return self.children[-1].end


# class Document(BaseModel):
#     speaker_names: Optional[Mapping[str, str]] = None
#     children: List[Paragraph]

# #print(automerge.dump(doc))

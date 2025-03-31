#!/usr/bin/env python3

import sys
from loro import LoroDoc
from pathlib import Path

doc = LoroDoc()
doc.subscribe_root(lambda e: print(e))
doc.import_(Path(sys.argv[1]).read_bytes())


# print(doc.get_deep_value())

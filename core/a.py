#!/usr/bin/env python3

from transcribee_core import Document

doc = Document()

tx = doc.transaction()
tx.set_version(1)
tx.commit()

tx = doc.transaction()
tx.set_version(2)

print(doc.view().version())

tx.commit()

print(doc.view().version())

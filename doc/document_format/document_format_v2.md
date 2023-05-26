# transcribee v1 document Format Version 2

This document describes version 2 of the internal document format transcribee uses (named "transcribee v2 format" or "transcribee format" in the following text).
The format is an extension of the [transcribee v1 format](./document_format_v1.md).

The transcribee v1 format leaves the serialization of the document to a automerge document unspecified. This version specifies a specific way of converting the document to a automerge document.

## Conversion to a automerge document
A document with the "transcribee v2 format" MUST be converted to a automerge document using the following rules:
- The automerge document MUST have the same structure as the JSON document.
- Each value in the JSON document MUST be converted to a automerge value according to its type as given by the following table:

| JSON type | automerge type (javascript API) | automerge type (python API) | automerge type (rust API) |
|-----------|---------------------------------|-----------------------------|---------------------------|
| number    | number                          | float                       | ScalarValue::F64          |
| string    | string                          | automerge.Text              | ObjType::Text             |
| boolean   | boolean                         | bool                        | ScalarValue::Boolean      |
| array     | automerge.List                  | automerge.Sequence          | ObjType::List             |
| object    | object                          | automerge.Mapping           | ObjType::Map              |
| null      | null                            | None                        | ScalarValue::Null         |


## Migration Instructions

This version proposes no changes to the document format in canonical JSON representation, so no migration is necessary. automerge documents created according to document format version 1 MUST be migrated to document format version 2 by converting each value according to the following table:
| old automerge type (rust API) | new automerge type (rust API) |
|-------------------------------|-------------------------------|
| ScalarValue::Str              | ObjType::Text                 |
| ScalarValue::Int              | ScalarValue::F64              |
| ScalarValue::Uint             | ScalarValue::F64              |
Values with a type not listed in this table MUST keep their old type. This migration MUST be performed in single automerge transaction and MUST be performed by the frontend as soon a document with version 1 is encountered.

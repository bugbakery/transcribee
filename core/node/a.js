import { Document } from "./transcribee_core.js"

let doc = new Document()

let tx = doc.transaction()
tx.version = BigInt(1)
tx.commit()

let tx2 = doc.transaction()
tx2.version = BigInt(2)

console.log(doc.view().version)
console.log(tx2.version)

tx2.commit()

console.log(doc.view().version)

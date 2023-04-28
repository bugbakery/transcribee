import fs from "fs";

for (const file of process.argv.slice(2)) {
  const content = fs.readFileSync(file, "utf-8").split("\n").map(x => x.trimEnd()).join("\n");
  fs.writeFileSync(file, content);
}

import nlf from 'nlf';
import fs from 'fs';

const args = process.argv.slice(2);

if (args.length < 1 || args.length > 2) {
  console.log(`USAGE: ${process.argv[0]} ${process.argv[1]} OUTPUT_FILE [PREAMBLE_FILE]`);
  process.exit(-1);
}

nlf.find({}, function (err, data) {
  const license_parts = [];
  if (args[1]) {
    license_parts.push(fs.readFileSync(args[1]));
  }
  for (const item of data) {
    if (item.name === 'transcribee') {
      continue;
    }
    license_parts.push(`# ${item.name} License`);

    const licenses = item.licenseSources.package.sources
      .map((lic) => {
        if (lic.url && lic.url !== '(none)') {
          return `[${lic.license}](${lic.url})`;
        } else {
          return lic.license;
        }
      })
      .join(', ');

    let name;
    if (item.repository && item.repository !== '(none)') {
      name = `[${item.name}](${item.repository})`;
    } else {
      name = item.name;
    }

    license_parts.push(
      `This product contains the ${name} javascript package (Version ${item.version}), which is licensed under the following licenses: ${licenses}`,
    );

    const source_texts = item.licenseSources.license.sources.map(
      (item) => `\`\`\`\n${item.text}\`\`\``,
    );
    license_parts.push(...source_texts);
  }
  const total = license_parts.join('\n\n');
  fs.writeFileSync(args[0], total);
});

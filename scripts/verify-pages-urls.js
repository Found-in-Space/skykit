import fs from 'fs';
import path from 'path';

const root = path.resolve(process.argv[2] ?? 'dist');
const htmlFiles = [];
const failures = [];
const attributePattern = /\b(?:href|src)=["']([^"']+)["']/gi;

walk(root);

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = attributePattern.exec(html)) !== null) {
    const value = match[1];
    if (value.startsWith('./') || value.startsWith('../')) {
      failures.push(`${path.relative(root, file)}: ${value}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Found file-relative public URLs in built HTML:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Verified ${htmlFiles.length} built HTML files have no file-relative href/src URLs.`);

function walk(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Pages artifact directory does not exist: ${directory}`);
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      htmlFiles.push(fullPath);
    }
  }
}

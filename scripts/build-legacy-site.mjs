import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] ?? "_site");

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(target);
  }
  return files;
}

for (const file of await htmlFiles(output)) {
  const source = await readFile(file, "utf8");
  const transformed = source.replace(
    /<meta name="robots" content="(?:index, follow|noindex, nofollow)" \/>/,
    '<meta name="robots" content="noindex, nofollow" />',
  );
  if (transformed === source && !source.includes('<meta name="robots" content="noindex, nofollow" />')) {
    throw new Error(`robots metadata missing: ${path.relative(output, file)}`);
  }
  await writeFile(file, transformed);
}

await writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /nohdol-auto-showcase/\n");

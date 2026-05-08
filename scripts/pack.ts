import { createWriteStream, existsSync, readFileSync } from "node:fs";
import archiver from "archiver";

const DIST = "dist";
if (!existsSync(DIST)) {
  console.error("dist/ not found — run build first");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string };
const out = `${pkg.name}-${pkg.version}.zip`;

const output = createWriteStream(out);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`✓ Packed ${out} (${mb} MB)`);
});

archive.on("error", (err: Error) => {
  console.error(err);
  process.exit(1);
});

archive.pipe(output);
archive.directory(DIST, false);
void archive.finalize();

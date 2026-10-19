// Bump version (patch by default, or `npm run release -- 1.4.0`) and
// updatedAt in theme.json / package.json / the script headers, so Sine
// notices the release. Commit and push afterwards.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(root, f), s);

const theme = JSON.parse(read("theme.json"));
const current = theme.version;
let next = process.argv[2];
if (!next) {
  const [a, b, c] = current.split(".").map(Number);
  next = `${a}.${b}.${c + 1}`;
}
theme.version = next;
theme.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
write("theme.json", JSON.stringify(theme, null, 2) + "\n");

const pkg = JSON.parse(read("package.json"));
pkg.version = next;
write("package.json", JSON.stringify(pkg, null, 2) + "\n");

for (const f of ["calendar-peek.uc.js", "gmail-peek.uc.js"]) {
  let s = read(f);
  s = s.replace(/(\/\/ @version\s+)[\d.]+/, `$1${next}`);
  s = s.replace(/(const VERSION = ")[\d.]+(")/, `$1${next}$2`);
  write(f, s);
}
console.log(`${current} → ${next} (updatedAt ${theme.updatedAt})`);

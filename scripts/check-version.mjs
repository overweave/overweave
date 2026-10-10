// The version being released is every package's, and every package asks for the others at it
// (as a peer, ^version; in the workspace, the version itself):
// node scripts/check-version.mjs 0.1.0
import { readdirSync, readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) throw new Error('give the version: node scripts/check-version.mjs 0.1.0');

const wrong = [];
for (const dir of readdirSync('packages')) {
  const pkg = JSON.parse(readFileSync(`packages/${dir}/package.json`, 'utf8'));
  if (pkg.version !== version) wrong.push(`${pkg.name} is ${pkg.version}`);
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (name.startsWith('@overweave/') && range !== `^${version}`) wrong.push(`${pkg.name} asks for ${name}@${range}, not ^${version}`);
  }
  // In the workspace the others are taken as they are: at this very version.
  for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
    if (name.startsWith('@overweave/') && range !== version) wrong.push(`${pkg.name} develops against ${name}@${range}, not ${version}`);
  }
}
if (wrong.length) {
  console.error(`not every package is ${version}:\n  ${wrong.join('\n  ')}`);
  process.exit(1);
}
console.log(`every package is ${version}`);

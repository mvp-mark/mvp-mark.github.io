// Minimal test runner shared by the *.test.js files; no dependencies.
// Tests may be async; they run one at a time.
const tests = [];

export const test = (name, fn) => tests.push({ name, fn });

// `node tests/x.test.js <text>` runs only the tests whose name has <text>.
export async function run() {
  const only = process.argv[2];
  const selected = only ? tests.filter(({ name }) => name.includes(only)) : tests;
  let failed = 0;
  for (const { name, fn } of selected) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${name}\n     ${String(process.env.DEBUG ? err.stack : err.message).split("\n").join("\n     ")}`);
    }
  }
  console.log(`\n${selected.length - failed}/${selected.length} passaram`);
  process.exitCode = failed ? 1 : 0;
}

// Minimal test runner shared by the *.test.js files; no dependencies.
const tests = [];

export const test = (name, fn) => tests.push({ name, fn });

export function run() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${name}\n     ${String(err.message).split("\n").join("\n     ")}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passaram`);
  process.exitCode = failed ? 1 : 0;
}

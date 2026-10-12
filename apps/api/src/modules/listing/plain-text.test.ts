/**
 * tsx src/modules/listing/plain-text.test.ts
 */
import { toPlainLongDescription } from "./plain-text.js";

const cases: Array<[string, string]> = [
  ["", ""],
  ["plain text only", "plain text only"],
  ["<p>Hello world</p>", "Hello world"],
  ["<p>  spaced  </p>", "spaced"],
  ["<p>One</p><p>Two</p>", "One\nTwo"],
  ["<p>With <b>bold</b> bit</p>", "With bold bit"],
  ["Line<br/>break", "Line\nbreak"],
];

for (const [input, want] of cases) {
  const got = toPlainLongDescription(input);
  if (got !== want) {
    throw new Error(`toPlainLongDescription(${JSON.stringify(input)}) => ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log("listing/plain-text.test.ts OK");

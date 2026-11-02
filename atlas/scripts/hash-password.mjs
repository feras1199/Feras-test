// Usage: node scripts/hash-password.mjs 'a long password'
import { randomBytes, scryptSync } from "node:crypto";
const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error("Give a password of at least 10 characters");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
console.log(["scrypt", 16384, 8, 1, salt.toString("base64"), hash.toString("base64")].join("$"));

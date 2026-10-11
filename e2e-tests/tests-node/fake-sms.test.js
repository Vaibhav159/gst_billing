const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { outboxVersion, readFakeSms } = require("../tests-v3/fake-sms");

const scratch = path.resolve(__dirname, "../../.plan-p4d-pf");
const phone = "9000000123";
const code = "012345";
const safeWords = "The sandbox SMS code is not ready for this reset.";

function fixture(t) {
  fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, "fake-sms-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "private-outbox.json");
  const write = (value) => fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  return { directory, file, write };
}

function refuses(fn) {
  assert.throws(fn, (error) => {
    assert.equal(error.message, safeWords);
    assert.equal(error.cause, undefined);
    assert.equal(error.message.includes(phone), false);
    assert.equal(error.message.includes(code), false);
    assert.equal(error.message.includes("private-outbox"), false);
    return true;
  });
}

test("a missing outbox has no version", (t) => {
  const { file } = fixture(t);
  assert.equal(outboxVersion(file), null);
});

test("a regular outbox has an opaque stable version", (t) => {
  const { file, write } = fixture(t);
  write({ phone, code });
  const version = outboxVersion(file);
  assert.equal(typeof version, "string");
  assert.ok(version.length);
  assert.equal(outboxVersion(file), version);
});

test("a newly delivered exact-phone code preserves leading zeroes", (t) => {
  const { file, write } = fixture(t);
  const previous = outboxVersion(file);
  write({ phone, code });
  assert.equal(readFakeSms(file, { phone, previous }), code);
});

test("a pre-existing unchanged code is refused", (t) => {
  const { file, write } = fixture(t);
  write({ phone, code });
  const previous = outboxVersion(file);
  refuses(() => readFakeSms(file, { phone, previous }));
});

test("a fresh replacement may legitimately repeat the same code", (t) => {
  const { file, write } = fixture(t);
  write({ phone, code });
  const previous = outboxVersion(file);
  const replacement = `${file}.new`;
  fs.writeFileSync(replacement, JSON.stringify({ phone, code }), { mode: 0o600 });
  fs.renameSync(replacement, file);
  assert.notEqual(outboxVersion(file), previous);
  assert.equal(readFakeSms(file, { phone, previous }), code);
});

test("a different synthetic phone's code is refused", (t) => {
  const { file, write } = fixture(t);
  write({ phone: "9000000456", code });
  refuses(() => readFakeSms(file, { phone, previous: null }));
});

for (const [label, value] of [
  ["null", null],
  ["an array", [{ phone, code }]],
  ["a missing phone", { code }],
  ["a numeric phone", { phone: Number(phone), code }],
  ["a numeric code", { phone, code: 123456 }],
  ["a short code", { phone, code: "12345" }],
  ["a long code", { phone, code: "1234567" }],
  ["code whitespace", { phone, code: "123456\n" }],
  ["code letters", { phone, code: "12345a" }],
  ["an unexpected field", { phone, code, sequence: 1 }],
]) {
  test(`the outbox rejects ${label}`, (t) => {
    const { file, write } = fixture(t);
    write(value);
    refuses(() => readFakeSms(file, { phone, previous: null }));
  });
}

test("parser errors cannot reveal file contents or paths", (t) => {
  const { file } = fixture(t);
  fs.writeFileSync(file, `not-json-${phone}-${code}`);
  refuses(() => readFakeSms(file, { phone, previous: null }));
});

test("a missing delivery fails safely without waiting or polling", (t) => {
  const { file } = fixture(t);
  refuses(() => readFakeSms(file, { phone, previous: null }));
});

test("a directory is refused as an outbox without exposing its path", (t) => {
  const { directory } = fixture(t);
  refuses(() => outboxVersion(directory));
  refuses(() => readFakeSms(directory, { phone, previous: null }));
});

test("a missing baseline is refused instead of accepting an old delivery", (t) => {
  const { file, write } = fixture(t);
  write({ phone, code });
  refuses(() => readFakeSms(file, { phone }));
});

test("an invalid expected phone is refused", (t) => {
  const { file, write } = fixture(t);
  write({ phone: "", code });
  refuses(() => readFakeSms(file, { phone: "", previous: null }));
});

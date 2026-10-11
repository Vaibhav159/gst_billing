// Sandbox-only file fixture from 4B. No endpoint, provider call, timer or polling.
const fs = require("node:fs");

const unavailable = () => new Error("The sandbox SMS code is not ready for this reset.");

function outboxVersion(file) {
  try {
    const stat = fs.statSync(file, { bigint: true });
    if (!stat.isFile()) throw unavailable();
    return `${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw unavailable();
  }
}

/** Call once after the reset response; previous is captured before the request. */
function readFakeSms(file, { phone, previous } = {}) {
  try {
    if (typeof phone !== "string" || phone.length !== 10 || !/^\d{10}$/.test(phone)
      || !(previous === null || (typeof previous === "string" && previous.length))) throw unavailable();
    const current = outboxVersion(file);
    if (current === null || current === previous) throw unavailable();
    const body = fs.readFileSync(file, "utf8");
    if (outboxVersion(file) !== current) throw unavailable();
    const value = JSON.parse(body);
    if (!value || Array.isArray(value) || typeof value !== "object"
      || Object.keys(value).length !== 2 || value.phone !== phone
      || typeof value.code !== "string" || value.code.length !== 6 || !/^\d{6}$/.test(value.code)) throw unavailable();
    return value.code;
  } catch {
    throw unavailable();
  }
}

module.exports = { outboxVersion, readFakeSms };

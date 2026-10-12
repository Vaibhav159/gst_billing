// Sandbox-only file fixture from 4B. No endpoint, provider call, timer or polling.
const fs = require("node:fs");
const childProcess = require("node:child_process");

const unavailable = () => new Error("The sandbox SMS code is not ready for this reset.");

// A container's app-owned 0600 outbox stays private. Read it as app without copying
// credentials to a host mount or changing its permissions; stdout is captured only.
function containerFile(file, action) {
  const container = process.env.SMS_FAKE_OUTBOX_CONTAINER;
  if (!/^gst-sandbox(?:-[2-9])?-web-1$/.test(container)) throw unavailable();
  return childProcess.execFileSync("docker", ["exec", "--user", "app", container, "python", "-c", `
import pathlib, stat, sys
p = pathlib.Path(sys.argv[1])
if sys.argv[2] == "read":
    sys.stdout.write(p.read_text())
else:
    try:
        s = p.stat()
    except FileNotFoundError:
        sys.exit(0)
    if not stat.S_ISREG(s.st_mode):
        sys.exit(1)
    sys.stdout.write(f"{s.st_ino}:{s.st_mtime_ns}:{s.st_ctime_ns}:{s.st_size}")
`, file, action], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
}

function outboxVersion(file) {
  try {
    if (process.env.SMS_FAKE_OUTBOX_CONTAINER) return containerFile(file, "version") || null;
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
    const body = process.env.SMS_FAKE_OUTBOX_CONTAINER ? containerFile(file, "read") : fs.readFileSync(file, "utf8");
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

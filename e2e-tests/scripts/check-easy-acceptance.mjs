import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const EASY_ROUTES = ['/e','/e/new','/e/new/items','/e/new/customer','/e/saved/:id','/e/bills','/e/bill/:id','/e/bill/:id/print','/e/customers','/e/customers/new','/e/customers/:id/edit','/e/capture','/e/gst','/e/more','/e/profile'];
export const EASY_STATES = [...EASY_ROUTES.map(route => ({route,state:'base'})), {route:'/e/new/items',state:'review'}, {route:'/e/customers',state:'error'}];
export const GST_TITLES = [
  "Easy GST wrapper: native cancellation makes no success claim or fallback",
  "Easy GST wrapper: native rejection is explained and the next share can succeed",
  "Easy GST wrapper: unsupported phone opens WhatsApp without a recipient or success claim",
  "Easy GST wrapper: loading retains skeletons and withholds figures and sharing",
  "Easy GST wrapper: offline return read says what is unavailable without invented totals",
  "Easy GST wrapper: a refused return preserves server words and recovers on Try again",
  "Easy GST wrapper: filed return shows both recorded filing dates",
  "Easy GST wrapper: legacy filed return never invents filing dates",
  "Easy GST wrapper: unlocked corrections keep filed history and use the shared stage",
  "Easy GST desktop boundary: redirect Easy and open the shared number-free WhatsApp fallback"
];
export function requiredTitles(role) {
  const titles = [`${role}: Easy permissions and plain GST words`];
  if (role === 'owner') {
    titles.push('Easy acceptance: scoped GST share, bill links and no idle polling', ...GST_TITLES);
    for (const {route,state} of EASY_STATES) for (const width of [320,390]) for (const theme of ['obsidian','pearl']) titles.push(`Easy visual ${state==='base' ? route : `${route} ${state}`} ${width} ${theme}: WCAG, targets and prototype pair`);
  }
  return titles;
}
function specs(suites) { return (suites ?? []).flatMap(suite => [...(suite.specs ?? []), ...specs(suite.suites)]); }
const clean = spec => spec.tests?.length > 0 && spec.tests.every(test => test.results?.length > 0 && test.results.every(result => result.status === 'passed'));
function executed(spec) {
  const lines = new Set();
  for (const test of spec.tests ?? []) for (const result of test.results ?? []) for (const attachment of result.attachments ?? []) {
    if (attachment.name !== 'easy-checks') continue;
    try {
      const raw = attachment.body ? Buffer.from(attachment.body,'base64').toString('utf8') : readFileSync(attachment.path,'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.lines)) for (const line of parsed.lines) if (Number.isInteger(line)) lines.add(line);
    } catch { /* Missing/malformed evidence leaves the source line unproved. */ }
  }
  return lines;
}
export function checkEasyEvidence({ coverage, runs, shots }, fileExists = existsSync) {
  const errors = [];
  if (coverage.length !== 153) errors.push(`Expected 153 prototype checks; got ${coverage.length}.`);
  if (new Set(coverage.map(check => check.sourceLine)).size !== coverage.length) errors.push('Every sourceLine must be unique.');
  if (coverage.some(check => !Number.isInteger(check.sourceLine) || !check.sourceWords || !check.title)) errors.push('Every coverage row needs sourceLine, sourceWords and title.');
  if (coverage.some(check => check.roles && (!check.roles.length || check.roles.some(role => !['owner','accountant','staff','viewer'].includes(role))))) errors.push('Coverage roles must be a nonempty subset of owner, accountant, staff and viewer.');
  for (const role of ['owner','accountant','staff','viewer']) {
    const roleRuns = runs.filter(run => run.role === role);
    if (roleRuns.length !== 1) { errors.push(`Exactly one ${role} run is required.`); continue; }
    const run = roleRuns[0];
    const tests = specs(run.report.suites);
    const checks = coverage.filter(check => !check.roles || check.roles.includes(role));
    for (const title of new Set([...checks.map(check => check.title), ...requiredTitles(role)])) {
      const found = tests.filter(test => test.title === title);
      if (!found.length || !found.every(clean)) errors.push(`${role}: ${title} needs a clean passed run.`);
    }
    for (const check of checks) {
      const found = tests.filter(test => test.title === check.title);
      if (!found.length || !found.every(spec => executed(spec).has(check.sourceLine))) errors.push(`${role}: ${check.title} did not execute sourceLine ${check.sourceLine}.`);
    }
    for (const spec of tests) if (!clean(spec)) errors.push(`${role}: ${spec.title} did not pass cleanly.`);
    if (run.report.errors?.length) errors.push(`${role}: runner errors are present.`);
  }
  for (const {route,state} of EASY_STATES) for (const width of [320,390]) for (const theme of ['obsidian','pearl']) {
    const matches = shots.filter(shot => shot.route === route && (shot.state ?? 'base') === state && shot.width === width && shot.theme === theme);
    if (matches.length !== 1) { errors.push(`Missing or duplicate comparison: ${route} ${state} ${width} ${theme}.`); continue; }
    const shot = matches[0];
    if (shot.reviewed !== true || typeof shot.differences !== 'string') errors.push(`Unreviewed comparison: ${route} ${state} ${width} ${theme}.`);
    for (const key of ['app','prototype']) if (!shot[key] || !fileExists(shot[key])) errors.push(`Missing ${key} screenshot: ${route} ${state} ${width} ${theme}.`);
  }
  return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [coveragePath,runsPath,shotsPath] = process.argv.slice(2);
  if (!coveragePath || !runsPath || !shotsPath) throw new Error('Usage: node scripts/check-easy-acceptance.mjs coverage.json runs.json screenshots.json');
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const runs = read(runsPath).map(({role,report}) => ({role,report:read(report)}));
  const errors = checkEasyEvidence({coverage:read(coveragePath),runs,shots:read(shotsPath)});
  if (errors.length) { process.stderr.write(errors.join('\n')+'\n'); process.exitCode=1; }
  else process.stdout.write('Easy acceptance evidence is complete.\n');
}

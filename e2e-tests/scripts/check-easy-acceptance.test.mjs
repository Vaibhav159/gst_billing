import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEasyEvidence, EASY_ROUTES, GST_TITLES } from './check-easy-acceptance.mjs';
function required(role) {
  const titles = [`${role}: Easy permissions and plain GST words`];
  if (role === 'owner') {
    titles.push('Easy acceptance: scoped GST share, bill links and no idle polling', ...GST_TITLES);
    for (const route of EASY_ROUTES) for (const width of [320,390]) for (const theme of ['obsidian','pearl']) titles.push(`Easy visual ${route} ${width} ${theme}: WCAG, targets and prototype pair`);
    for (const [state,route] of [['review','/e/new/items'],['error','/e/customers']]) for (const width of [320,390]) for (const theme of ['obsidian','pearl']) titles.push(`Easy visual ${route} ${state} ${width} ${theme}: WCAG, targets and prototype pair`);
  }
  return titles;
}
const passed = (title, lines=[]) => ({title, tests:[{results:[{status:'passed', attachments:[{name:'easy-checks', body:Buffer.from(JSON.stringify({lines})).toString('base64')}]}]}]});
function fixture() {
  return {
    coverage: Array.from({ length: 153 }, (_, n) => ({ sourceLine: n + 1, sourceWords: `Original check ${n}`, title: `easy check ${n}` })),
    runs: ['owner', 'accountant', 'staff', 'viewer'].map(role => ({ role, report: { suites: [{ specs: [...Array.from({ length: 153 }, (_, n) => passed(`easy check ${n}`, [n+1])), ...required(role).map(title => passed(title))] }] } })),
    shots: [...EASY_ROUTES.map(route => ({route,state:'base'})),{route:'/e/new/items',state:'review'},{route:'/e/customers',state:'error'}].flatMap(({route,state}) => [320,390].flatMap(width => ['obsidian','pearl'].map(theme => ({ route, state, width, theme, app: `app-${route}-${width}-${theme}.png`, prototype: `proto-${route}-${width}-${theme}.png`, reviewed: true, differences: '' })))),
  };
}
test('complete evidence accepts every role and both widths/themes', () => { const v=fixture(); assert.deepEqual(checkEasyEvidence(v, () => true), []); });
test('a skipped mapped check is not acceptance', () => { const v=fixture(); v.runs[2].report.suites[0].specs[7].tests[0].results[0].status='skipped'; assert.match(checkEasyEvidence(v, () => true).join('\n'), /staff.*easy check 7/); });
test('retrying a failing check to green still requires a clean run', () => { const v=fixture(); v.runs[0].report.suites[0].specs[0].tests[0].results.unshift({status:'failed'}); assert.match(checkEasyEvidence(v, () => true).join('\n'), /owner.*easy check 0/); });
test('missing check, duplicate inventory row and missing role fail', () => { const v=fixture(); v.coverage[1].sourceLine=1; v.coverage.pop(); v.runs.pop(); const words=checkEasyEvidence(v, () => true).join('\n'); assert.match(words,/153/); assert.match(words,/sourceLine/); assert.match(words,/viewer/); });
test('missing screenshots and an unreviewed comparison fail', () => { const v=fixture(); v.shots.pop(); v.shots[0].reviewed=false; const errors=checkEasyEvidence(v, path => !path.startsWith('app-')).join('\n'); assert.match(errors,/comparison/); assert.match(errors,/screenshot/); });
test('a title cannot be satisfied by zero tests or zero results', () => { const v=fixture(); v.runs[0].report.suites[0].specs[0].tests=[]; v.runs[1].report.suites[0].specs[1].tests[0].results=[]; const errors=checkEasyEvidence(v, () => true).join('\n'); assert.match(errors,/owner.*easy check 0/); assert.match(errors,/accountant.*easy check 1/); });
test('an empty role list cannot remove a prototype check from acceptance', () => { const v=fixture(); v.coverage[0].roles=[]; assert.match(checkEasyEvidence(v, () => true).join('\n'), /roles/); });
test('an empty accountant report fails even when no inventory rows target it', () => { const v=fixture(); v.coverage.forEach(c => c.roles=['owner']); v.runs[1].report.suites=[]; assert.match(checkEasyEvidence(v, () => true).join('\n'), /accountant.*Easy permissions/); });
test('a passed journey cannot cover an assertion that did not execute', () => { const v=fixture(); v.runs[0].report.suites[0].specs[0].tests[0].results[0].attachments=[]; assert.match(checkEasyEvidence(v, () => true).join('\n'), /owner.*sourceLine 1/); });
test('required GST and visual tests cannot disappear from the owner report', () => { const v=fixture(); v.runs[0].report.suites[0].specs=v.runs[0].report.suites[0].specs.filter(s => !s.title.startsWith('Easy visual') && !s.title.includes('scoped GST share')); const errors=checkEasyEvidence(v, () => true).join('\n'); assert.match(errors,/scoped GST share/); assert.match(errors,/Easy visual/); });
test('open review and error screenshot comparisons are mandatory', () => { const v=fixture(); v.shots=v.shots.filter(s => s.state==='base'); assert.match(checkEasyEvidence(v, () => true).join('\n'), /comparison.*review/); });
test('duplicate role runs cannot shadow evidence', () => { const v=fixture(); v.runs.push(v.runs[0]); assert.match(checkEasyEvidence(v, () => true).join('\n'), /Exactly one owner/); });
test('malformed assertion evidence fails the mapped check', () => { const v=fixture(); v.runs[0].report.suites[0].specs[0].tests[0].results[0].attachments[0].body=Buffer.from('no json').toString('base64'); assert.match(checkEasyEvidence(v, () => true).join('\n'), /owner.*sourceLine 1/); });
test('every GST wrapper boundary needs its own passed browser case', () => { const v=fixture(); v.runs[0].report.suites[0].specs=v.runs[0].report.suites[0].specs.filter(s => !GST_TITLES.includes(s.title)); assert.match(checkEasyEvidence(v, () => true).join('\n'), /Easy GST wrapper.*native cancellation/); });

// Shared assertion set for public/core.js (StudyCore) and public/sync-core.js (TaskSyncCore).
// One source of cases, two entrypoints: tests/index.html (browser) and tests/run-node.mjs.
// `a` is an assert-like with equal/deepEqual/ok, so the browser and node:test can both feed it.

const BASE = '2026-11-17';

// Independent date helpers: these restate the intent, they do not call the code under test.
const atod = (s) => new Date(s + 'T12:00:00');
const dtos = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (s, days) => {
  const d = atod(s);
  d.setDate(d.getDate() + days);
  return dtos(d);
};
// Monday-based index of a date, matching how the app spells 周一…周日.
const weekIndex = (s) => (atod(s).getDay() + 6) % 7;
const onWeekday = (base, cn, ahead = 0) => {
  let delta = '一二三四五六日'.indexOf(cn) - weekIndex(base);
  if (ahead) delta += 7 * ahead;
  else if (delta < 0) delta += 7;
  return shift(base, delta);
};

export function buildCases(a, C, S, Q) {
  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  // ---------------------------------------------------------------- deadline
  test('deadline: absolute date with clock time', () => {
    const r = C.deadline('提交实验报告，截止 2026年12月3日 14:30 前。', BASE);
    a.equal(r.due, '2026-12-03T14:30');
  });

  test('deadline: 今天 / 今晚 / 明天 / 后天', () => {
    a.equal(C.deadline('今天交', BASE).due, BASE);
    a.equal(C.deadline('今晚交', BASE).due, BASE);
    a.equal(C.deadline('明天交', BASE).due, shift(BASE, 1));
    a.equal(C.deadline('后天交', BASE).due, shift(BASE, 2));
  });

  test('deadline: 周几 uses the message week, 下周 adds a week', () => {
    a.equal(C.deadline('周五之前提交', BASE).due, onWeekday(BASE, '五'));
    a.equal(C.deadline('下周五提交', BASE).due, onWeekday(BASE, '五', 1));
    a.equal(C.deadline('下下周三提交', BASE).due, onWeekday(BASE, '三', 2));
  });

  test('deadline: 周日 and 星期天 are the same day', () => {
    a.equal(C.deadline('下周日交', BASE).due, onWeekday(BASE, '日', 1));
    a.equal(C.deadline('下星期天交', BASE).due, onWeekday(BASE, '日', 1));
  });

  test('deadline: month/day without a year is flagged for review', () => {
    const r = C.deadline('12月20日交论文', BASE);
    a.equal(r.due, `2026-12-20`);
    a.ok(r.warning.includes('未给年份'), 'expected a year warning');
  });

  test('deadline: month/day never borrows the base year blindly across the year end', () => {
    // A January date on a November message cannot mean the year that already passed.
    const r = C.deadline('1月8日交', BASE);
    a.ok(r.due === '2026-01-08' || r.warning, 'either resolves or warns');
  });

  test('deadline: 下午 / 晚上 convert 12h to 24h', () => {
    a.equal(C.deadline('明天截止，下午2:30前提交', BASE).due, `${shift(BASE, 1)}T14:30`);
    a.equal(C.deadline('明天截止，晚上8点开班会', BASE).due, `${shift(BASE, 1)}T20:00`);
    a.equal(C.deadline('明天截止，中午12:15交', BASE).due, `${shift(BASE, 1)}T12:15`);
  });

  test('deadline: late-evening HH:MM hours are recognised', () => {
    a.equal(C.deadline('明天 22:00 前完成习题', BASE).due, `${shift(BASE, 1)}T22:00`);
    a.equal(C.deadline('明天 20:00 前完成习题', BASE).due, `${shift(BASE, 1)}T20:00`);
    a.equal(C.deadline('明天 23:45 前完成习题', BASE).due, `${shift(BASE, 1)}T23:45`);
  });

  test('deadline: date only is stored without an invented time', () => {
    const r = C.deadline('2026年12月3日前提交', BASE);
    a.equal(r.due, '2026-12-03');
    a.ok(r.warning.includes('仅日期'), 'expected a date-only warning');
  });

  test('deadline: no date at all asks for one', () => {
    const r = C.deadline('记得交材料', BASE);
    a.equal(r.due, '');
    a.ok(r.warning.includes('待补充'));
  });

  test('deadline: ambiguous dates without a deadline keyword go to manual review', () => {
    const r = C.deadline('6月1日和6月2日补课', BASE);
    a.equal(r.due, '');
    a.ok(r.warning.includes('多个日期'));
  });

  test('deadline: ambiguous dates inside a deadline sentence still need review', () => {
    // The keyword tells the parser which sentence to read, not which date to pick.
    const r = C.deadline('截止 6月1日或6月2日提交', BASE);
    a.equal(r.due, '');
    a.ok(r.warning.includes('多个日期'), 'a single deadline clause may still hold several dates');
  });

  test('deadline: an impossible calendar date is rejected', () => {
    const r = C.deadline('2月30日前提交', BASE);
    a.equal(r.due, '');
    a.ok(r.warning.includes('无效'));
  });

  test('deadline: invalid base date never produces a due date', () => {
    const r = C.deadline('明天交', '2026-13-45');
    a.equal(r.due, '');
    a.ok(r.warning.includes('无效'));
  });

  test('deadline: a date in the same sentence as the keyword wins over other sentences', () => {
    const r = C.deadline('课程调整。实验报告明天截止。', BASE);
    a.equal(r.due, shift(BASE, 1));
  });

  test('deadline: a date in another sentence cannot be picked as the deadline', () => {
    // Comma-separated clauses are not split, so the keyword cannot disambiguate here.
    // Reading only the first date used to return the results date as the submission deadline.
    const r = C.deadline('12月1日出成绩，作业明天截止', BASE);
    a.equal(r.due, '');
    a.ok(r.warning.includes('多个日期'), `expected manual review, got ${r.due}`);
  });

  test('deadline: OCR spacing around the digits is still read as a date', () => {
    a.equal(C.deadline('班会签到：11 月 20 日 14:00 前回复', BASE).due, '2026-11-20T14:00');
    a.equal(C.deadline('2026 年 3 月 5 日 8:30 报到', '2026-01-01').due, '2026-03-05T08:30');
    const r = C.deadline('今天下午 7 点前把实验报告上传学习通，截止 11 月 19 日', BASE);
    a.equal(r.due, '');
    a.ok(r.warning.includes('多个日期'), `contradictory dates should ask, got ${r.due}`);
  });

  // --------------------------------------------------------------- validity
  test('validDate accepts calendar dates only', () => {
    a.ok(C.validDate('2026-11-17'));
    a.ok(!C.validDate('2026-1-17'));
    a.ok(!C.validDate(''));
    a.ok(!C.validDate('2026-02-30'));
    a.ok(!C.validDate('2026-11-17T00:00'));
  });

  test('validDue accepts date and date-time forms', () => {
    a.ok(C.validDue(''));
    a.ok(C.validDue('2026-11-17'));
    a.ok(C.validDue('2026-11-17T09:05'));
    a.ok(!C.validDue('2026-11-17T24:00'));
    a.ok(!C.validDue('2026-11-17T09:05:30'));
  });

  test('dueTime treats a date-only deadline as end of that day', () => {
    a.equal(C.dueTime(''), Infinity);
    a.ok(C.dueTime('2026-11-17') > atod('2026-11-17').getTime());
    a.ok(C.dueTime('2026-11-17') <= atod('2026-11-18').getTime());
  });

  // -------------------------------------------------------------- relevance
  test('relevance: whole-class notices match', () => {
    a.equal(C.relevance('请全体同学填写问卷', { name: '张三', className: '1班' }).relevanceKey, 'match');
    a.equal(C.relevance('大家记得交', {}).relevanceKey, 'match');
  });

  test('relevance: my own name, class or group matches', () => {
    const p = { name: '张三', className: '计科1班', group: '', courses: '高等数学，英语' };
    a.equal(C.relevance('张三到高数办公室', p).relevanceKey, 'match');
    a.equal(C.relevance('计科1班单独安排', p).relevanceKey, 'match');
    a.equal(C.relevance('英语课调整', p).relevanceKey, 'match');
  });

  test('relevance: an audience that excludes me is flagged', () => {
    const r = C.relevance('适用对象：计科2班', { name: '张三', className: '计科1班' });
    a.equal(r.relevanceKey, 'check');
    a.ok(r.relevance.includes('计科2班'));
  });

  test('relevance: nothing stated is unknown, not silently matched', () => {
    a.equal(C.relevance('记得带教材', { name: '张三' }).relevanceKey, 'unknown');
  });

  // ---------------------------------------------------------------- extract
  test('extract: blank lines split separate items', () => {
    const list = C.extract('交作业。\n\n明天上课带课本。', { base: BASE });
    a.equal(list.length, 2);
    a.ok(list.every((t) => t.status === 'pending'));
  });

  test('extract: numbered lines split without a blank line', () => {
    const list = C.extract('1. 第一章习题\n2. 第二章习题', { base: BASE });
    a.equal(list.length, 2);
    a.equal(list[0].title, '第一章习题');
  });

  test('extract: a leading label before a colon becomes the title', () => {
    const list = C.extract('高等数学：明天交第三章习题，拍照上传学习通。', { base: BASE });
    a.equal(list[0].title, '高等数学');
    a.equal(list[0].kind, '作业');
    a.equal(list[0].due, shift(BASE, 1));
  });

  test('extract: kind classifies 测验 / 作业 / 通知', () => {
    const by = (text) => C.extract(text, { base: BASE })[0].kind;
    a.equal(by('下周五听力测验'), '测验');
    a.equal(by('课后作业两页'), '作业');
    a.equal(by('周三调课通知'), '通知');
    a.equal(by('买打印纸'), '事项');
  });

  test('extract: keeps the raw message with its source and base', () => {
    const raw = '2026年12月3日前提交读书报告。';
    const [t] = C.extract(raw, { source: '微信课程群', course: '语文', base: '2026-11-17' });
    a.equal(t.raws.length, 1);
    a.equal(t.raws[0].source, '微信课程群');
    a.equal(t.raws[0].base, '2026-11-17');
    a.equal(t.raws[0].text, raw);
    a.equal(t.course, '语文');
    a.equal(t.due, '2026-12-03');
  });

  test('extract: an empty message yields no drafts', () => {
    a.equal(C.extract('   \n\n  ', { base: BASE }).length, 0);
  });

  // --------------------------------------------------------------- similar
  test('similar: identical titles after punctuation folding', () => {
    a.ok(C.similar({ title: '第三章 习题！' }, { title: '第三章习题' }));
  });

  test('similar: different courses never merge', () => {
    a.ok(!C.similar({ title: '第三章习题', course: '高数' }, { title: '第三章习题', course: '英语' }));
  });

  test('similar: differing numbers block a merge', () => {
    a.ok(!C.similar({ title: '第三章习题' }, { title: '第四章习题' }));
    a.ok(!C.similar({ title: '第3次作业' }, { title: '第5次作业' }));
  });

  test('similar: containment needs a long enough title', () => {
    a.ok(C.similar({ title: '提交第三章课后习题' }, { title: '提交第三章课后习题照片' }));
    // The shorter title must reach 8 characters, otherwise a bare prefix would merge unrelated work.
    a.ok(!C.similar({ title: '交作业' }, { title: '交' }));
    a.ok(!C.similar({ title: '第三章习题' }, { title: '第三章习题拍照上传学习通' }));
  });

  test('similar: empty titles are not similar to anything', () => {
    a.ok(!C.similar({ title: '' }, { title: '交作业' }));
    a.ok(!C.similar({ title: '交作业' }, {}));
  });

  // ---------------------------------------------------------- normalizeTask
  test('normalizeTask: rejects a task without a title', () => {
    a.throws(() => C.normalizeTask({ id: 'a', title: '  ' }), /标题无效/);
    a.throws(() => C.normalizeTask(null), /标题无效/);
  });

  test('normalizeTask: replaces a malformed id and defaults unknown enums', () => {
    const t = C.normalizeTask({ id: 'bad id!!', title: 'x', status: 'nope', category: 'nope', priority: 'nope', kind: 'nope' });
    a.ok(/^[-a-zA-Z0-9]{1,100}$/.test(t.id));
    a.equal(t.status, 'pending');
    a.equal(t.category, '学习');
    a.equal(t.priority, '普通');
    a.equal(t.kind, '事项');
  });

  test('normalizeTask: keeps a well-formed id', () => {
    a.equal(C.normalizeTask({ id: 'task-7c', title: 'x' }).id, 'task-7c');
  });

  test('normalizeTask: ids outside the shared client/server pattern are regenerated', () => {
    // /^[-a-zA-Z0-9]{1,100}$/ is also what app/api/sync/route.ts enforces, so an id with
    // underscores or spaces has to be replaced or the whole snapshot would be rejected.
    for (const bad of ['task_7', 'task 7', '任务', 'a'.repeat(101), '']) {
      const t = C.normalizeTask({ id: bad, title: 'x' });
      a.ok(/^[-a-zA-Z0-9]{1,100}$/.test(t.id), `expected a regenerated id for ${JSON.stringify(bad)}`);
      a.notEqual(t.id, bad);
    }
  });

  test('normalizeTask: drops invalid dates and out-of-range numbers', () => {
    const t = C.normalizeTask({ title: 'x', due: '2026-13-99T99:99', plannedDate: 'yesterday', estimate: 999, remindMinutes: 7, repeatAnchor: 40 });
    a.equal(t.due, '');
    a.equal(t.plannedDate, '');
    a.equal(t.estimate, 0);
    a.equal(t.remindMinutes, 30);
    a.equal(t.repeatAnchor, 0);
  });

  test('normalizeTask: clamps long text fields', () => {
    const t = C.normalizeTask({ title: 'x', notes: 'n'.repeat(40000), method: 'm'.repeat(2000) });
    a.equal(t.notes.length, 30000);
    a.equal(t.method.length, 1000);
  });

  test('normalizeTask: sanitises checklist and history', () => {
    const t = C.normalizeTask({
      title: 'x',
      checklist: [...Array(150).keys()].map((i) => ({ id: `s${i}`, text: `step ${i}`, done: i % 2 === 0 })).concat([{ text: '  ' }, null]),
      history: [...Array(150).keys()].map((i) => ({ action: `a${i}`, at: 't', detail: 'd' })).concat([{ at: 'no action' }]),
    });
    a.equal(t.checklist.length, 100);
    a.ok(t.checklist.every((x) => /^s\d+$/.test(x.id)));
    a.equal(t.history.length, 100);
    a.equal(t.history[0].action, 'a50', 'keeps the most recent history entries');
  });

  // --------------------------------------------------------- normalizeState
  const minimal = () => ({ tasks: [], sources: [], profile: {} });

  test('normalizeState: requires the task and source arrays', () => {
    a.throws(() => C.normalizeState({}), /备份格式不正确/);
    a.throws(() => C.normalizeState(null), /备份格式不正确/);
  });

  test('normalizeState: refuses duplicate ids and oversized backups', () => {
    const t = { id: 'same', title: 'x' };
    a.throws(() => C.normalizeState({ ...minimal(), tasks: [t, { ...t }] }), /重复任务 ID/);
    a.throws(() => C.normalizeState({ ...minimal(), tasks: Array.from({ length: 10001 }, (_, i) => ({ id: `k${i}`, title: 'x' })) }), /10000/);
  });

  test('normalizeState: fills settings and purges malformed tombstones', () => {
    const s = C.normalizeState({ ...minimal(), purged: ['ok-1', 'bad id', 7], settings: { theme: 'neon', reminders: true, defaultView: 'nope' } });
    a.deepEqual(s.purged, ['ok-1']);
    a.equal(s.settings.theme, 'light');
    a.equal(s.settings.reminders, true);
    a.equal(s.settings.defaultView, 'all');
  });

  test('normalizeState: normalises source labels so duplicates collapse', () => {
    const s = C.normalizeState({ tasks: [], sources: [' 微信 ', '微信', '', 'QQ'], profile: { name: '张三', evil: 'x' }, imports: [{ source: '微信', at: 't', count: 2 }, null, { source: 'QQ', at: 't2', count: 'x' }] });
    a.deepEqual(s.sources, ['微信', 'QQ']);
    a.ok(!('evil' in s.profile));
    a.equal(s.imports.length, 2);
    a.equal(s.imports[1].count, 0, 'a non-numeric import count falls back to 0');
  });

  test('normalizeState: is idempotent', () => {
    const once = C.normalizeState({ tasks: [{ id: 'a', title: 'x', due: '2026-11-20' }], sources: ['s'], profile: { name: 'n' } });
    a.deepEqual(C.normalizeState(once), once);
  });

  // ------------------------------------------------------------------- same
  test('same: key order does not matter, array order does', () => {
    a.ok(S.same({ a: 1, b: 2 }, { b: 2, a: 1 }));
    a.ok(!S.same({ a: [1, 2] }, { a: [2, 1] }));
    a.ok(S.same({ a: undefined }, { a: null }));
  });

  // ------------------------------------------------------------------ merge
  const state = (tasks, extra = {}) => C.normalizeState({ tasks, sources: [], profile: {}, ...extra });
  const task = (id, over = {}) => ({ id, title: `T${id}`, status: 'todo', ...over });

  test('merge: keeps one-sided additions', () => {
    const base = state([]);
    const r = S.merge(base, state([task('l')]), state([task('r')]));
    a.deepEqual(r.state.tasks.map((t) => t.id).sort(), ['l', 'r']);
    a.equal(r.conflicts.length, 0);
  });

  test('merge: adopts a remote edit when local is untouched', () => {
    const base = state([task('a', { title: 'old' })]);
    const remote = state([task('a', { title: 'new' })]);
    const r = S.merge(base, structuredClone(base), remote);
    a.equal(r.state.tasks.length, 1);
    a.equal(r.state.tasks[0].title, 'new');
    a.equal(r.conflicts.length, 0);
  });

  test('merge: keeps the local edit when remote is untouched', () => {
    const base = state([task('a', { title: 'old' })]);
    const local = state([task('a', { title: 'mine' })]);
    const r = S.merge(base, local, structuredClone(base));
    a.equal(r.state.tasks[0].title, 'mine');
    a.equal(r.conflicts.length, 0);
  });

  test('merge: divergent edits keep both, local copy goes to review', () => {
    const base = state([task('a', { title: 'old' })]);
    const local = state([task('a', { title: 'local edit' })]);
    const remote = state([task('a', { title: 'remote edit' })]);
    const r = S.merge(base, local, remote);
    a.deepEqual(r.conflicts, ['a']);
    a.equal(r.state.tasks.length, 2);
    const remoteRow = r.state.tasks.find((t) => t.id === 'a');
    const copy = r.state.tasks.find((t) => t.id !== 'a');
    a.equal(remoteRow.title, 'remote edit');
    a.equal(copy.status, 'pending');
    a.ok(copy.title.includes('待核对副本'));
    a.ok(copy.history.some((h) => h.action === '保留同步冲突副本'));
  });

  test('merge: a completed task is not reopened by a conflict copy', () => {
    const base = state([task('a', { title: 'old' })]);
    const local = state([task('a', { title: 'local edit' })]);
    const remote = state([task('a', { title: 'remote edit', status: 'done', completedAt: '2026-11-18T00:00:00Z' })]);
    const r = S.merge(base, local, remote);
    a.equal(r.state.tasks.find((t) => t.id === 'a').status, 'done');
  });

  test('merge: tombstones win over an older device restoring the task', () => {
    const base = state([task('a')]);
    const local = state([task('a')], { purged: ['a'] });
    const r = S.merge(base, local, state([task('a')]));
    a.equal(r.state.tasks.length, 0);
  });

  test('merge: a remote deletion sticks when local did not edit', () => {
    const base = state([task('a')]);
    const r = S.merge(base, structuredClone(base), state([]));
    a.equal(r.state.tasks.length, 0);
  });

  test('merge: an edit survives the other side deleting it', () => {
    const base = state([task('a', { title: 'old' })]);
    const local = state([task('a', { title: 'edited' })]);
    const r = S.merge(base, local, state([]));
    a.equal(r.state.tasks.length, 1);
    a.equal(r.state.tasks[0].title, 'edited');
  });

  test('merge: profile and settings prefer the side that actually changed', () => {
    const base = state([], { profile: { name: '旧' }, settings: { theme: 'light' } });
    const local = state([], { profile: { name: '本机' }, settings: { theme: 'dark' } });
    const remote = state([], { profile: { name: '云端' }, settings: { theme: 'system' } });
    const changed = S.merge(base, local, remote);
    a.equal(changed.state.profile.name, '本机');
    a.equal(changed.state.settings.theme, 'dark');
    const untouched = S.merge(base, structuredClone(base), remote);
    a.equal(untouched.state.profile.name, '云端');
  });

  test('merge: sources need both sides to keep them', () => {
    const base = state([], { sources: ['A', 'B'] });
    const local = state([], { sources: ['A', 'B', 'C'] });
    const remote = state([], { sources: ['A', 'C'] });
    const r = S.merge(base, local, remote);
    a.deepEqual(r.state.sources, ['A', 'C']);
  });

  test('merge: accepts a missing base or remote for a first sync', () => {
    const r = S.merge(null, state([task('a')]), null);
    a.deepEqual(r.state.tasks.map((t) => t.id), ['a']);
  });

  test('merge: imports merge without duplicates and onboarded sticks', () => {
    const base = state([]);
    const local = state([], { imports: [{ source: 'A', at: '2026-11-17T00:00:00Z', count: 1 }], onboarded: true });
    const remote = state([], { imports: [{ source: 'A', at: '2026-11-17T00:00:00Z', count: 1 }, { source: 'B', at: '2026-11-18T00:00:00Z', count: 2 }] });
    const r = S.merge(base, local, remote);
    a.equal(r.state.imports.length, 2);
    a.equal(r.state.onboarded, true);
  });

  // ---------------------------------------------------------- nextOccurrence
  // nextOccurrence, like calendar(), consumes rows that already went through normalizeTask;
  // complete() only ever calls it with tasks read back from state.
  const sched = (over) => C.normalizeTask({ title: 'x', status: 'done', ...over });

  test('nextOccurrence: none yields nothing', () => {
    a.equal(S.nextOccurrence(sched({ repeat: 'none', due: '2026-11-17' }), BASE), null);
  });

  test('nextOccurrence: daily and weekly advance from the completed row', () => {
    a.equal(S.nextOccurrence(sched({ repeat: 'daily', due: BASE }), BASE).due, shift(BASE, 1));
    a.equal(S.nextOccurrence(sched({ repeat: 'weekly', due: BASE }), BASE).due, shift(BASE, 7));
  });

  test('nextOccurrence: a long-stale series catches up instead of emitting past dates', () => {
    const t = S.nextOccurrence(sched({ repeat: 'daily', due: '2026-01-01' }), BASE);
    a.ok(t.due.slice(0, 10) > BASE, `expected a future date, got ${t.due}`);
  });

  test('nextOccurrence: monthly respects the anchor and clamps to a short month', () => {
    a.equal(S.nextOccurrence(sched({ repeat: 'monthly', due: '2026-01-31' }), '2026-01-31').due, '2026-02-28', 'February gets the last day');
    a.equal(S.nextOccurrence(sched({ repeat: 'monthly', due: '2026-01-15' }), '2026-01-15').due, '2026-02-15');
  });

  test('nextOccurrence: keeps the time of day and clears completion state', () => {
    const n = S.nextOccurrence(sched({ repeat: 'daily', due: `${BASE}T20:00`, completedAt: 'now', checklist: [{ id: 'c1', text: 's', done: true }], history: [{ action: 'a', at: 'b', detail: 'c' }] }), BASE);
    a.equal(n.due, `${shift(BASE, 1)}T20:00`);
    a.equal(n.status, 'todo');
    a.equal(n.completedAt, '');
    a.equal(n.checklist[0].done, false);
    a.notEqual(n.checklist[0].id, 'c1');
    a.equal(n.history.length, 1, 'a fresh occurrence does not inherit the old audit trail');
  });

  test('nextOccurrence: links the series and gets a new identity', () => {
    const n = S.nextOccurrence(sched({ id: 'root', repeat: 'weekly', plannedDate: BASE }), BASE);
    a.notEqual(n.id, 'root');
    a.equal(n.seriesId, 'root');
    a.equal(n.plannedDate, shift(BASE, 7));
    a.equal(n.nextOccurrenceId, '');
  });

  // ---------------------------------------------------------------- calendar
  // Real callers always hand calendar() rows that went through normalizeTask.
  const row = (over) => C.normalizeTask({ id: 'a', title: 'x', status: 'todo', ...over });
  // Decode a basic-format iCalendar stamp back to an instant so the test holds in any timezone.
  const stampInstant = (value) => {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
    a.ok(m, `unparsable timestamp ${value}`);
    return m[7] ? Date.UTC(+m[1], m[2] - 1, m[3], +m[4], +m[5], +m[6]) : new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`).getTime();
  };

  test('calendar: emits a valid wrapper', () => {
    const ics = C.calendar([]);
    a.ok(ics.startsWith('BEGIN:VCALENDAR'), 'file starts with the calendar banner');
    a.ok(ics.includes('END:VCALENDAR'));
    a.ok(ics.endsWith('\r\n'));
  });

  test('calendar: skips undated tasks', () => {
    a.ok(!C.calendar([row({ due: '' })]).includes('VEVENT'));
  });

  test('calendar: a date-only task is an all-day event', () => {
    const ics = C.calendar([row({ due: '2026-11-20' })]);
    a.ok(ics.includes('DTSTART;VALUE=DATE:20261120'));
    a.ok(ics.includes('DTEND;VALUE=DATE:20261121'), 'all-day events end the next day');
  });

  test('calendar: a timed task round-trips to the same instant', () => {
    const ics = C.calendar([row({ due: '2026-11-20T20:00' })]);
    const start = ics.split('\r\n').find((l) => l.startsWith('DTSTART:'));
    const end = ics.split('\r\n').find((l) => l.startsWith('DTEND:'));
    a.equal(stampInstant(start.slice(8)), new Date('2026-11-20T20:00').getTime(), 'the exported moment is the local deadline');
    a.equal(stampInstant(end.slice(6)) - stampInstant(start.slice(8)), 900000, 'timed events last 15 minutes');
  });

  test('calendar: escapes text the way iCalendar requires', () => {
    const ics = C.calendar([row({ title: 'A,B;C\\D\nE', due: '2026-11-20' })]);
    a.ok(ics.includes('SUMMARY:A\\,B\\;C\\\\D\\nE'), 'commas, semicolons, backslashes and newlines are escaped');
  });

  test('calendar: folds lines past 75 octets and keeps them parseable', () => {
    const long = 'x'.repeat(200);
    const ics = C.calendar([row({ title: long, due: '2026-11-20' })]);
    for (const line of ics.split('\r\n')) {
      a.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line.slice(0, 40)}`);
    }
    const unfolded = ics.split('\r\n ').join('').split('\r\n').find((l) => l.startsWith('SUMMARY:'));
    a.equal(unfolded, `SUMMARY:${long}`, 'unfolding restores the title exactly');
  });

  test('calendar: UTF-8 titles are folded by octet and never split mid-character', () => {
    const title = '中文作业'.repeat(30);
    const ics = C.calendar([row({ title, due: '2026-11-20' })]);
    for (const line of ics.split('\r\n')) {
      a.ok(new TextEncoder().encode(line).length <= 75, `folded line exceeds 75 octets: ${line.slice(0, 40)}`);
    }
    const unfolded = ics.split('\r\n ').join('').split('\r\n').find((l) => l.startsWith('SUMMARY:'));
    a.equal(unfolded, `SUMMARY:${title}`, 'unfolding restores every multi-byte character');
  });

  test('calendar: honours the per-task reminder lead time', () => {
    a.ok(C.calendar([row({ due: '2026-11-20T20:00', remindMinutes: 1440 })]).includes('TRIGGER:-PT1440M'));
  });

  test('calendar: an all-day reminder counts back from the end of the due day', () => {
    // A date-only deadline means "by the end of that day"; RELATED defaults to START, which
    // is midnight and would alert at 23:30 the night before instead.
    const ics = C.calendar([row({ due: '2026-11-20', remindMinutes: 30 })]);
    a.ok(ics.includes('TRIGGER;RELATED=END:-PT30M'), 'the alarm is anchored to DTEND for all-day events');
  });

  test('calendar: 不提前 emits no alarm', () => {
    const ics = C.calendar([row({ due: '2026-11-20', remindMinutes: 0 })]);
    a.ok(ics.includes('BEGIN:VEVENT'));
    a.ok(!ics.includes('VALARM'), 'a task set to 不提前 must not carry a trigger');
  });

  // ---------------------------------------------------------------- tidyOcr
  test('tidyOcr: drops status-bar noise and keeps message lines', () => {
    const out = C.tidyOcr('9:41\n100%\n\n第三次作业：明天 22:00 前提交第三章习题。\n查看详情\n\n英语：下周五晚 8 点测验');
    a.ok(out.includes('第三次作业：明天 22:00 前提交第三章习题。'));
    a.ok(!out.includes('9:41'), 'a clock reading is not a task');
    a.ok(!out.includes('查看详情'), 'in-app buttons are not a task');
    a.equal(out.split('\n\n').length, 2, 'blank lines stay as item boundaries');
  });

  test('tidyOcr: drops chat-room header lines', () => {
    a.equal(C.tidyOcr('高等数学群\n第一次作业明天交'), '第一次作业明天交');
  });

  test('tidyOcr: merges a wrapped line back into the sentence it belongs to', () => {
    a.equal(C.tidyOcr('请明天下午三点到教\n学楼302领取教材'), '请明天下午三点到教学楼302领取教材');
  });

  test('tidyOcr: drops a chat-room header that carries a subject suffix', () => {
    a.equal(C.tidyOcr('实验群-高等数学\n实验报告明天 18:00 前上传'), '实验报告明天 18:00 前上传');
  });

  test('tidyOcr: two dated messages in one paragraph become two items', () => {
    const out = C.tidyOcr('实验报告 11 月 19 日前上传学习通\n班会签到：11 月 20 日 14:00 前群接龙回复');
    a.equal(out.split('\n\n').length, 2);
    a.equal(C.extract(out, { source: '截图转入', base: BASE }).length, 2);
  });

  test('tidyOcr: empty and symbol-only input collapses to nothing', () => {
    a.equal(C.tidyOcr(''), '');
    a.equal(C.tidyOcr('9:41\n---\n100%\n\n\n'), '');
  });

  test('extract: cleaned screenshot text yields pending items with deadlines', () => {
    const text = C.tidyOcr('9:41\n\n第三次作业：明天 22:00 前提交第三章习题，拍照上传学习通。\n\n班级问卷：本周五之前填写');
    const tasks = C.extract(text, { source: '截图转入', base: BASE });
    a.equal(tasks.length, 2);
    a.ok(tasks.every(t => t.status === 'pending'), 'nothing may enter 待办 without confirmation');
    a.equal(tasks[0].due, shift(BASE, 1) + 'T22:00');
    a.equal(tasks[0].source, '截图转入');
  });

  // ---------------------------------------------------------------- quotes
  test('StudyQuotes: 同一天固定同一句，换一天就换一句', () => {
    a.ok(Q && Q.count > 30, 'the built-in list must outlast one month without repeating');
    const monday = Q.quoteFor('2026-11-16'), again = Q.quoteFor('2026-11-16'), tuesday = Q.quoteFor('2026-11-17');
    a.equal(monday.index, again.index);
    a.notEqual(monday.index, tuesday.index);
    a.ok(monday.text.length > 4 && monday.by.length > 1);
  });

  test('StudyQuotes: 走完整一轮不重复，且每句都有署名', () => {
    const start = new Date(2026, 0, 1), pad = n => String(n).padStart(2, '0'), seen = new Set();
    for (let i = 0; i < Q.count; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const q = Q.quoteFor(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      a.ok(q.text.length > 4 && q.by.length > 1, `第 ${i} 天要有句子和署名`);
      seen.add(q.text);
    }
    a.equal(seen.size, Q.count, 'a full rotation must not repeat a sentence');
  });

  return cases;
}

// lib/auth-core.js is pure Web Crypto, so these cases run against the deployed file itself.
// TEST_ITERATIONS stays at the floor to keep the browser suite fast.
const TEST_ITERATIONS = 1000;

export function buildAuthCases(a, A) {
  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  const email = 'Zhang.San@University.EDU.cn';

  // ------------------------------------------------------------- email shape
  test('normalizeEmail: trims and lowercases', () => {
    a.equal(A.normalizeEmail(`  ${email}  `), 'zhang.san@university.edu.cn');
  });

  test('normalizeEmail: accepts the addresses students actually use', () => {
    for (const ok of ['a@b.co', 'x_1@qq.com', 'name-9@163.com', "o'brien+x@edu.cn", 'a.b.c@sub.domain.museum']) {
      a.equal(A.normalizeEmail(ok), ok, `${ok} should be accepted`);
    }
  });

  test('normalizeEmail: rejects malformed and hostile addresses', () => {
    for (const bad of ['', '   ', 'a@b', 'a@b.', 'a@b..c', '@b.com', 'a@.com', 'a b@c.com', 'a@@b.com', 'a@b c.com', 'a@b.c d', 'a\r\n@b.com', 'a@b.c<d>', 'a;b@c.com']) {
      a.equal(A.normalizeEmail(bad), '', `${JSON.stringify(bad)} should be rejected`);
    }
    a.equal(A.normalizeEmail(`${'x'.repeat(300)}@a.com`), '', 'over the RFC length limit');
    a.equal(A.normalizeEmail(null), '');
    a.equal(A.normalizeEmail(42), '');
  });

  // ---------------------------------------------------------- password policy
  test('passwordProblem: length is the rule, no composition roulette', () => {
    a.ok(A.passwordProblem('short1').includes('至少'));
    a.equal(A.passwordProblem('exactly-10'), '');
    a.equal(A.passwordProblem('十个汉字组成的密码长度'), '', 'CJK counts by character, not byte');
    a.ok(A.passwordProblem('x'.repeat(A.PASSWORD_MAX + 1)).includes('最多'));
    a.equal(A.passwordProblem('x'.repeat(A.PASSWORD_MAX)), '');
  });

  test('passwordProblem: refuses a password that is just the email local-part', () => {
    const target = 'zhang.san.1990@university.edu.cn';
    a.ok(A.passwordProblem('zhang.san.1990', target).includes('邮箱前缀'));
    a.ok(A.passwordProblem('Zhang.San.1990', target), 'the comparison ignores case');
    a.equal(A.passwordProblem('zhang.san.1990'), '', 'only checked when an email is supplied');
    a.ok(A.passwordProblem('short', target).includes('至少'), 'the length gate runs first');
  });

  test('passwordProblem: non-strings never pass', () => {
    for (const bad of [null, undefined, 1234567890123, { length: 99 }]) a.ok(A.passwordProblem(bad));
  });

  // ------------------------------------------------------------- hashing
  test('hashPassword: round-trips and rejects the wrong password', async () => {
    const stored = await A.hashPassword('correct horse', TEST_ITERATIONS);
    a.ok(await A.verifyPassword('correct horse', stored));
    a.ok(!(await A.verifyPassword('Correct horse', stored)), 'verification is case sensitive');
    a.ok(!(await A.verifyPassword('correct horse ', stored)), 'a trailing space is a different password');
  });

  test('hashPassword: salts each hash so equal passwords store differently', async () => {
    const [x, y] = await Promise.all([A.hashPassword('same secret', TEST_ITERATIONS), A.hashPassword('same secret', TEST_ITERATIONS)]);
    a.notEqual(x, y);
    a.ok(await A.verifyPassword('same secret', y));
  });

  test('hashPassword: records the cost so it can be raised later', async () => {
    const stored = await A.hashPassword('another secret', TEST_ITERATIONS);
    a.equal(A.storedIterations(stored), TEST_ITERATIONS);
    a.ok(stored.startsWith(`pbkdf2-sha256$${TEST_ITERATIONS}$`));
  });

  test('hashPassword: refuses a cost that would hang or weaken the Worker', async () => {
    for (const bad of [0, -1, 999, 1.5, Number.NaN, 'x', A.MAX_ITERATIONS + 1]) {
      await a.rejects(() => A.hashPassword('p', bad), /迭代次数/, `${String(bad)} must be refused`);
    }
  });

  test('verifyPassword: malformed storage never throws', async () => {
    const stored = await A.hashPassword('a password', TEST_ITERATIONS);
    const [algo, iters, salt, hash] = stored.split('$');
    for (const broken of ['', 'x', 'a$b$c', `${algo}$${iters}$${salt}`, `bcrypt$${iters}$${salt}$${hash}`, `${algo}$abc$${salt}$${hash}`, `${algo}$99$${salt}$${hash}`, `${algo}$${iters}$${salt.slice(0, 10)}$${hash}`, `${algo}$${iters}$${salt}$${'A'.repeat(44)}`]) {
      a.ok(!(await A.verifyPassword('a password', broken)), `${JSON.stringify(broken).slice(0, 40)} must not verify`);
    }
  });

  // ------------------------------------------------------------- tokens
  test('signSession and readSession round-trip', async () => {
    const token = await A.signSession({ uid: 'u1', epoch: 3, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
    a.deepEqual(await A.readSession(token, SECRET), { uid: 'u1', epoch: 3, exp: tokenPayload(token).exp });
  });

  test('readSession: rejects any tampering with the token', async () => {
    const token = await A.signSession({ uid: 'u1', epoch: 3, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
    const [version, body, signature] = token.split('.');
    a.equal(await A.readSession(`${version}.${body}.${signature.slice(0, -2)}AA`, SECRET), null, 'a broken signature is rejected');
    a.equal(await A.readSession(`${version}.${body}.${signature}`, SECRET + 'x'), null, 'a different secret is rejected');
    a.equal(await A.readSession(`${version}.${toBase64Url(JSON.stringify({ uid: 'admin', epoch: 9, exp: 9e12 }))}.${signature}`, SECRET), null, 'a swapped payload breaks the signature');
  });

  test('readSession: a payload re-signed with the wrong secret is refused', async () => {
    const token = await A.signSession({ uid: 'u1', epoch: 1, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
    const body = token.split('.')[1];
    const attackerToken = await A.signSession(JSON.parse(new TextDecoder().decode(fromB64url(body))), 'a-completely-different-secret-value');
    a.equal(await A.readSession(attackerToken, SECRET), null);
  });

  test('readSession: expired tokens and malformed input are null', async () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    a.equal(await A.readSession(await A.signSession({ uid: 'u1', epoch: 1, exp: past }, SECRET), SECRET), null, 'expiry is enforced');
    for (const bad of ['', 'v1', 'v1..', 'v2.a.b', 'v1.notbase64!..', `v1.${'A'.repeat(20)}.`, null, undefined, 7]) {
      a.equal(await A.readSession(bad, SECRET), null, `${JSON.stringify(bad)} must not verify`);
    }
  });

  test('readSession: a payload with an unusable subject or epoch is refused', async () => {
    const make = (payload) => A.signSession(payload, SECRET).then((t) => A.readSession(t, SECRET));
    a.equal(await make({ uid: 'has space', epoch: 1, exp: Math.floor(Date.now() / 1000) + 60 }), null);
    a.equal(await make({ uid: 42, epoch: 1, exp: Math.floor(Date.now() / 1000) + 60 }), null);
    a.equal(await make({ uid: 'u1', epoch: 0, exp: Math.floor(Date.now() / 1000) + 60 }), null);
    a.equal(await make({ uid: 'u1', epoch: 1.5, exp: Math.floor(Date.now() / 1000) + 60 }), null);
    a.equal(await make({ uid: 'u1', epoch: 1 }), null, 'a token without an expiry is not accepted');
  });

  test('usableSecret: a short or absent deployment secret disables tokens', async () => {
    a.ok(!A.usableSecret(''));
    a.ok(!A.usableSecret(undefined));
    a.ok(!A.usableSecret('short-secret'));
    a.ok(A.usableSecret(SECRET));
    await a.rejects(() => A.signSession({ uid: 'u1', epoch: 1, exp: 1 }, 'too-short'), /会话密钥/);
    a.equal(await A.readSession(await A.signSession({ uid: 'u1', epoch: 1, exp: 9e12 }, SECRET), 'too-short'), null);
  });

  // ------------------------------------------------------------- cookies
  test('sessionCookie: carries every flag a credential cookie needs', () => {
    const cookie = A.sessionCookie('v1.abc.def');
    for (const part of [`${A.SESSION_COOKIE}=v1.abc.def`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=']) {
      a.ok(cookie.includes(part), `missing ${part}`);
    }
    a.ok(/Max-Age=\d+/.test(cookie));
    a.ok(A.SESSION_COOKIE.startsWith('__Host-'), 'host-exclusive prefix, so a sibling tenant cannot toss us a cookie');
    a.ok(!/Domain=/i.test(cookie), 'a Domain attribute would cancel the __Host- prefix');
  });

  test('clearedSessionCookie: expires immediately so logout works', () => {
    const cookie = A.clearedSessionCookie();
    a.ok(cookie.includes(`${A.SESSION_COOKIE}=`));
    a.ok(cookie.includes('Max-Age=0'));
  });

  test('parseCookie: finds, decodes and refuses', () => {
    const header = `other=1; ${A.SESSION_COOKIE}=v1.a%20b.c; third=3`;
    a.equal(A.parseCookie(header, A.SESSION_COOKIE), 'v1.a b.c');
    a.equal(A.parseCookie(header, 'other'), '1');
    a.equal(A.parseCookie(header, 'missing'), '');
    a.equal(A.parseCookie('', A.SESSION_COOKIE), '');
    a.equal(A.parseCookie(null, A.SESSION_COOKIE), '');
    a.equal(A.parseCookie(`${A.SESSION_COOKIE}=x`, 'other'), '');
  });

  test('clientAddress: prefers the Cloudflare client IP', () => {
    const request = new Request('https://x.test/api', { headers: { 'cf-connecting-ip': '203.0.113.9' } });
    a.equal(A.clientAddress(request), '203.0.113.9');
    a.equal(A.clientAddress(new Request('https://x.test/api')), '', 'absent headers yield no address rather than a spoofable fallback');
  });

  return cases;
}

const SECRET = 'a-deployed-session-secret-that-is-long-enough-32+';
const fromB64url = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const toBase64Url = (text) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenPayload = (token) => JSON.parse(new TextDecoder().decode(fromB64url(token.split('.')[1])));

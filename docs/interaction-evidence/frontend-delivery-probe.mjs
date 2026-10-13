// Read-only audit probe: run the current App delivery handler with fake effects.
// No native input, OS clipboard, microphone, network, or model request is used.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createPipeline } from '../../src/dictation/pipeline.js';

const sourceUrl = new URL('../../src/App.jsx', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const start = source.indexOf('  eventRef.current = (event) => {');
const end = source.indexOf('\n  useEffect(() => {', start);
assert(start >= 0 && end > start, 'App delivery handler boundary changed');
const handlerSource = source.slice(start, end);
const names = ['setTextPreview', 'setState', 'setPhase', 'notify', 'setPendingFailure',
  'refreshRecoverableAudio', 'setAnswerCard', 'isTauri', 'desktopInvoke',
  'describeError', 'setHistory', 'historyTime', 'breakdownOf', 'setLastResult',
  'stateRef', 'navigator', 'setTimeout'];

async function probe(event, copyRejects = false) {
  const observed = { copyAttempts: [], notices: [], history: [], lastResult: null,
    pendingFailure: 'previous-failure', state: 'processing' };
  const deps = Object.fromEntries(names.map((name) => [name, () => {}]));
  Object.assign(deps, {
    setState: value => { observed.state = value; },
    notify: (message, ok) => observed.notices.push({ message, ok }),
    setPendingFailure: value => { observed.pendingFailure = value; },
    setHistory: update => { observed.history = update(observed.history); },
    setLastResult: value => { observed.lastResult = value; },
    historyTime: () => 'audit-time', breakdownOf: () => 'audit-timings',
    isTauri: () => true, stateRef: { current: 'processing' },
    navigator: { clipboard: { writeText: async text => {
      observed.copyAttempts.push(text);
      if (copyRejects) throw new Error('mock clipboard denied');
    } } },
  });
  const handler = new Function('deps',
    `const { ${names.join(', ')} } = deps; const eventRef = {};\n${handlerSource}\nreturn eventRef.current;`)(deps);
  handler(event);
  await Promise.resolve();
  await Promise.resolve();
  return observed;
}

const base = { requestId: 'audit-session', intent: 'dictation', text: 'audit final text',
  rawText: 'audit raw text', timings: {}, pasted: false };
const pasteFailure = await probe({ ...base, type: 'paste-failed', message: 'mock paste denied' });
assert.equal(pasteFailure.copyAttempts.length, 0);
assert.equal(pasteFailure.pendingFailure, null);
assert.equal(pasteFailure.history[0].text, base.text);
assert.equal(pasteFailure.state, 'error');

const copyFailure = await probe({ ...base, type: 'done' }, true);
assert.equal(copyFailure.copyAttempts.length, 1);
assert.equal(copyFailure.state, 'done');
assert.deepEqual(copyFailure.notices, [{ message: '已完成', ok: true }]);

const pipelineEvents = [];
const nativeCalls = [];
const pipeline = createPipeline({
  invoke: async command => { nativeCalls.push(command); },
  onEvent: event => pipelineEvents.push(event),
});
const insertRawResult = await pipeline.insertRaw({ intent: 'translate', rawText: 'audit original',
  settings: { autoPaste: false, processingMode: 'original', vocabulary: '' } });
assert.equal(insertRawResult.pasted, false);
assert.equal(nativeCalls.includes('paste_text'), false);
const insertRawCopyOnly = await probe(pipelineEvents.find(event => event.type === 'done'));
assert.deepEqual(insertRawCopyOnly.copyAttempts, ['audit original']);
assert.deepEqual(insertRawCopyOnly.notices, [{ message: '已插入识别原文', ok: true }]);

console.log(JSON.stringify({
  scope: 'Actual App event handler, isolated mock effects; no OS behavior observed',
  source: sourceUrl.pathname,
  sha256: createHash('sha256').update(source).digest('hex'),
  handlerStartLine: source.slice(0, start).split('\n').length,
  findings: {
    pasteFailureSkipsClipboardFallback: pasteFailure,
    copyFailureStillReportsCompletion: copyFailure,
    insertRawCopyOnlyStillClaimsInsertion: { nativeCalls, result: insertRawResult, ...insertRawCopyOnly },
  },
}, null, 2));

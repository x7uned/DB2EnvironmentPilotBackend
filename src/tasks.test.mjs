import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStoredTask, validateTask} from './tasks.mjs';

test('trims valid task titles and defaults priority to normal', () => {
  assert.deepEqual(validateTask({title: '  Prepare release  '}), {
    title: 'Prepare release',
    completed: false,
    priority: 'normal',
  });
});

test('accepts each supported priority', () => {
  for (const priority of ['low', 'normal', 'high']) {
    assert.equal(validateTask({title: 'Prepare release', priority}).priority, priority);
  }
});

test('rejects invalid task priorities', () => {
  for (const priority of [undefined, null, '', 'urgent', 'Low', ' low ', false, 1, [], {}]) {
    assert.throws(() => validateTask({title: 'Prepare release', priority}), /Priority must be/);
  }
});

test('rejects missing, short, and oversized titles', () => {
  for (const title of [undefined, 'a', 'x'.repeat(161)]) {
    assert.throws(() => validateTask({title}));
  }
});

test('normalizes legacy stored tasks without changing other fields', () => {
  const legacyTask = {id: 'legacy', title: 'Old task', completed: true, extra: 'kept'};
  assert.deepEqual(normalizeStoredTask(legacyTask), {...legacyTask, priority: 'normal'});
  assert.equal(normalizeStoredTask({...legacyTask, priority: 'high'}).priority, 'high');
});

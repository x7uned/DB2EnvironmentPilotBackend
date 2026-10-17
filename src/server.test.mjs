import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function isExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (isExited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = exited => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
    if (isExited(child)) finish(true);
  });
}

async function stopBackend(child) {
  if (isExited(child)) return;
  if (!child.kill('SIGTERM') && child.pid === undefined) return;
  if (await waitForExit(child, 1500)) return;

  if (!child.kill('SIGKILL') && isExited(child)) return;
  if (!await waitForExit(child, 1500)) throw new Error('Backend process did not exit');
}

async function startBackend(dataFile) {
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: process.cwd(),
    env: {DATA_FILE: dataFile, PORT: '0'},
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => finish(new Error('Backend did not become ready')), 3000);
      const finish = (error, value) => {
        clearTimeout(timer);
        child.removeListener('error', onError);
        child.removeListener('exit', onExit);
        child.stdout.removeListener('data', onData);
        if (error) reject(error);
        else resolve(value);
      };
      const onError = error => finish(error);
      const onExit = (code, signal) => finish(new Error(`Backend exited before listening (${code ?? signal})`));
      const onData = chunk => {
        output += chunk;
        const lines = output.split('\n');
        output = lines.pop();
        for (const line of lines) {
          try {
            const message = JSON.parse(line);
            if (message.event === 'listening' && Number.isInteger(message.port)) {
              finish(null, message.port);
              return;
            }
          } catch {}
        }
      };

      child.once('error', onError);
      child.once('exit', onExit);
      child.stdout.on('data', onData);
      if (isExited(child)) onExit(child.exitCode, child.signalCode);
    });

    return {child, baseUrl: `http://127.0.0.1:${port}`};
  } catch (error) {
    await stopBackend(child);
    throw error;
  }
}

test('task priorities work over HTTP and legacy tasks remain readable after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'backend-priority-'));
  let backend;
  t.after(async () => {
    try {
      if (backend) await stopBackend(backend.child);
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  const dataFile = join(directory, 'tasks.json');
  await writeFile(dataFile, JSON.stringify({
    tasks: [{id: 'legacy', title: 'Old task', completed: true}],
    operations: {},
    activeFeatures: [],
  }));

  backend = await startBackend(dataFile);
  let response = await fetch(`${backend.baseUrl}/tasks`);
  assert.deepEqual(await response.json(), [{
    id: 'legacy', title: 'Old task', completed: true, priority: 'normal',
  }]);

  const created = [];
  for (const [title, priority] of [
    ['Low priority task', 'low'],
    ['Normal priority task', 'normal'],
    ['High priority task', 'high'],
    ['Default priority task', undefined],
  ]) {
    const task = {title};
    if (priority !== undefined) task.priority = priority;
    response = await fetch(`${backend.baseUrl}/tasks`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(task),
    });
    assert.equal(response.status, 201);
    created.push(await response.json());
  }
  assert.deepEqual(created.map(task => task.priority), ['low', 'normal', 'high', 'normal']);

  response = await fetch(`${backend.baseUrl}/tasks`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({title: 'Invalid task', priority: null}),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Priority must be/);

  response = await fetch(`${backend.baseUrl}/tasks`);
  const beforeRestart = await response.json();
  assert.deepEqual(beforeRestart.map(task => task.id), ['legacy', ...created.map(task => task.id)]);
  assert.deepEqual(beforeRestart.map(task => task.priority), ['normal', 'low', 'normal', 'high', 'normal']);

  await stopBackend(backend.child);
  backend = null;
  const persisted = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.deepEqual(persisted.tasks.map(task => task.priority), [undefined, 'low', 'normal', 'high', 'normal']);

  backend = await startBackend(dataFile);
  response = await fetch(`${backend.baseUrl}/tasks`);
  const afterRestart = await response.json();
  assert.deepEqual(afterRestart.map(task => task.id), beforeRestart.map(task => task.id));
  assert.deepEqual(afterRestart.map(task => task.priority), beforeRestart.map(task => task.priority));
});

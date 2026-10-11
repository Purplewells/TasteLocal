import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonStore } from '../src/store.js';
import { TaskService } from '../src/tasks.js';
import { createServer } from '../src/server.js';

describe('HTTP API', () => {
  let server;
  let base;

  before(async () => {
    const service = new TaskService({ store: new JsonStore(null) });
    server = createServer({ service });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const call = async (method, url, body) => {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, type: response.headers.get('content-type'), body: text ? safeJson(text) : null, text };
  };

  const safeJson = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  test('full flow: staff, task, schedule, instance, completion', async () => {
    const staff = await call('POST', '/api/staff', { name: 'Ama Mensah', role: 'Cook' });
    assert.equal(staff.status, 201);

    const template = await call('POST', '/api/templates', { title: 'Clean prep area' });
    assert.equal(template.status, 201);

    const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const schedule = await call('POST', '/api/schedules', {
      templateId: template.body.id,
      staffId: staff.body.id,
      recurrence: 'weekly',
      startAt,
    });
    assert.equal(schedule.status, 201);

    const instances = await call('GET', `/api/instances?staffId=${staff.body.id}`);
    assert.equal(instances.status, 200);
    assert.equal(instances.body.length, 1);
    const [instance] = instances.body;
    assert.equal(instance.title, 'Clean prep area');
    assert.equal(instance.status, 'open');

    const completed = await call('PATCH', `/api/instances/${instance.id}`, { status: 'completed', notes: 'All clean' });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.status, 'completed');
    assert.ok(completed.body.completedAt);

    const filtered = await call('GET', '/api/instances?status=completed');
    assert.equal(filtered.body.length, 1);
  });

  test('a task used by a schedule cannot be deleted', async () => {
    const template = await call('POST', '/api/templates', { title: 'Restock' });
    const staff = await call('POST', '/api/staff', { name: 'Kofi Boateng' });
    await call('POST', '/api/schedules', {
      templateId: template.body.id,
      staffId: staff.body.id,
      recurrence: 'once',
      startAt: new Date().toISOString(),
    });

    const response = await call('DELETE', `/api/templates/${template.body.id}`);
    assert.equal(response.status, 409);
  });

  test('invalid JSON and non-object bodies return 400', async () => {
    assert.equal((await call('POST', '/api/staff', '{not json')).status, 400);
    assert.equal((await call('POST', '/api/staff', '[1,2]')).status, 400);
  });

  test('validation errors are reported as JSON', async () => {
    const response = await call('POST', '/api/staff', { name: '' });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /name is required/);
  });

  test('unknown routes and wrong methods', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('PUT', '/api/staff', {})).status, 405);
    assert.equal((await call('GET', '/api/instances/missing-id')).status, 405);
    assert.equal((await call('PATCH', '/api/instances/missing-id', { status: 'completed' })).status, 404);
  });

  test('serves the web app', async () => {
    const response = await call('GET', '/');
    assert.equal(response.status, 200);
    assert.match(response.type, /text\/html/);
    assert.match(response.text, /Staff Tasks/);

    const script = await call('GET', '/app.js');
    assert.match(script.type, /javascript/);
  });
});

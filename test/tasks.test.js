import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { occurrenceAt } from '../src/recurrence.js';
import { JsonStore } from '../src/store.js';
import { AppError, TaskService } from '../src/tasks.js';

const START = '2026-03-02T09:00:00.000Z';

function makeService(start = START) {
  const clock = { now: new Date(start) };
  const store = new JsonStore(null);
  const service = new TaskService({ store, now: () => new Date(clock.now) });
  return { service, store, clock };
}

function seed(service) {
  const staff = service.createStaff({ name: 'Ama Mensah', role: 'Cook' });
  const template = service.createTemplate({ title: 'Check fridge temperatures', category: 'Food safety' });
  return { staff, template };
}

describe('occurrenceAt', () => {
  test('daily, weekly and once', () => {
    assert.equal(occurrenceAt(START, 'daily', 3).toISOString(), '2026-03-05T09:00:00.000Z');
    assert.equal(occurrenceAt(START, 'weekly', 2).toISOString(), '2026-03-16T09:00:00.000Z');
    assert.equal(occurrenceAt(START, 'once', 1), null);
  });

  test('monthly keeps the day of month and clamps to the end of short months', () => {
    const start = '2026-01-31T09:00:00.000Z';
    assert.equal(occurrenceAt(start, 'monthly', 1).toISOString(), '2026-02-28T09:00:00.000Z');
    assert.equal(occurrenceAt(start, 'monthly', 2).toISOString(), '2026-03-31T09:00:00.000Z');
  });
});

describe('scheduling', () => {
  test('assigning a daily task generates instances across the 7-day horizon', () => {
    const { service } = makeService();
    const { staff, template } = seed(service);

    service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'daily', startAt: START });

    const instances = service.listInstances();
    // Day 0 through day 7 inclusive: the horizon ends exactly at day 7.
    assert.equal(instances.length, 8);
    assert.ok(instances.every((i) => i.staffId === staff.id && i.status === 'open'));
    assert.equal(instances[0].title, 'Check fridge temperatures');
  });

  test('generation is idempotent and advances with the clock', () => {
    const { service, clock } = makeService();
    const { staff, template } = seed(service);
    service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'daily', startAt: START });

    assert.equal(service.generateDueInstances(), 0);

    clock.now = new Date('2026-03-12T09:00:00.000Z'); // horizon moves to 2026-03-19
    assert.equal(service.generateDueInstances(), 10);
    assert.equal(service.listInstances().length, 18);
    assert.equal(service.generateDueInstances(), 0);
  });

  test('a one-off schedule produces a single instance and then finishes', () => {
    const { service, store } = makeService();
    const { staff, template } = seed(service);

    service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'once', startAt: START });

    assert.equal(service.listInstances().length, 1);
    assert.equal(store.data.schedules[0].active, false);
  });

  test('pausing stops generation and resuming restarts it', () => {
    const { service, clock } = makeService();
    const { staff, template } = seed(service);
    const schedule = service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'daily', startAt: START });

    service.updateSchedule(schedule.id, { active: false });
    clock.now = new Date('2026-03-20T09:00:00.000Z');
    assert.equal(service.generateDueInstances(), 0);

    service.updateSchedule(schedule.id, { active: true });
    assert.ok(service.listInstances().length > 8);
  });

  test('rejects a start date more than a day in the past', () => {
    const { service } = makeService();
    const { staff, template } = seed(service);
    assert.throws(
      () => service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'daily', startAt: '2026-02-01T09:00:00.000Z' }),
      (error) => error instanceof AppError && error.status === 400,
    );
  });

  test('rejects an unknown recurrence and unknown staff or task', () => {
    const { service } = makeService();
    const { staff, template } = seed(service);
    assert.throws(() => service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'yearly', startAt: START }), { status: 400 });
    assert.throws(() => service.createSchedule({ templateId: 'nope', staffId: staff.id, recurrence: 'daily', startAt: START }), { status: 404 });
    assert.throws(() => service.createSchedule({ templateId: template.id, staffId: 'nope', recurrence: 'daily', startAt: START }), { status: 404 });
  });
});

describe('task instance status', () => {
  test('completing an instance records the chosen status and completion time', () => {
    const { service } = makeService();
    const { staff, template } = seed(service);
    service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'once', startAt: START });
    const [instance] = service.listInstances();

    const updated = service.updateInstance(instance.id, { status: 'partially_completed', notes: 'Fridge 2 still warm' });
    assert.equal(updated.status, 'partially_completed');
    assert.equal(updated.notes, 'Fridge 2 still warm');
    assert.ok(updated.completedAt);

    const reopened = service.updateInstance(instance.id, { status: 'in_progress' });
    assert.equal(reopened.completedAt, null);
  });

  test('rejects an unknown status', () => {
    const { service } = makeService();
    const { staff, template } = seed(service);
    service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'once', startAt: START });
    const [instance] = service.listInstances();
    assert.throws(() => service.updateInstance(instance.id, { status: 'done' }), { status: 400 });
  });

  test('an unfinished instance becomes overdue after its due time', () => {
    const { service, clock } = makeService();
    const { staff, template } = seed(service);
    service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'once', startAt: START });
    const [instance] = service.listInstances();
    assert.equal(instance.overdue, false);

    clock.now = new Date('2026-03-02T10:00:00.000Z');
    assert.equal(service.listInstances()[0].overdue, true);

    service.updateInstance(instance.id, { status: 'completed' });
    assert.equal(service.listInstances()[0].overdue, false);
  });

  test('filters by staff and status', () => {
    const { service } = makeService();
    const { staff, template } = seed(service);
    const other = service.createStaff({ name: 'Kofi Boateng' });
    service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'once', startAt: START });
    service.createSchedule({ templateId: template.id, staffId: other.id, recurrence: 'once', startAt: START });

    assert.equal(service.listInstances({ staffId: other.id }).length, 1);
    assert.equal(service.listInstances({ status: 'completed' }).length, 0);
    assert.throws(() => service.listInstances({ status: 'bogus' }), { status: 400 });
  });
});

describe('task library', () => {
  test('deleting a task that has schedules is refused until they are removed', () => {
    const { service } = makeService();
    const { staff, template } = seed(service);
    const schedule = service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'weekly', startAt: START });

    assert.throws(() => service.deleteTemplate(template.id), { status: 409 });

    service.deleteSchedule(schedule.id);
    service.deleteTemplate(template.id);
    assert.equal(service.listTemplates().length, 0);
  });

  test('editing a task does not rewrite instances already generated', () => {
    const { service } = makeService();
    const { staff, template } = seed(service);
    service.createSchedule({ templateId: template.id, staffId: staff.id, recurrence: 'once', startAt: START });

    service.updateTemplate(template.id, { title: 'Renamed' });
    assert.equal(service.listInstances()[0].title, 'Check fridge temperatures');
  });

  test('requires a title', () => {
    const { service } = makeService();
    assert.throws(() => service.createTemplate({ title: '   ' }), { status: 400 });
  });
});

describe('persistence', () => {
  test('data survives a reload from the JSON file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-tasks-'));
    const file = path.join(dir, 'db.json');
    try {
      const first = new TaskService({ store: new JsonStore(file) });
      first.createStaff({ name: 'Ama Mensah' });

      const second = new TaskService({ store: new JsonStore(file) });
      assert.equal(second.listStaff()[0].name, 'Ama Mensah');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

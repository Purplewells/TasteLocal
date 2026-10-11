import { randomUUID } from 'node:crypto';
import { RECURRENCES, occurrenceAt } from './recurrence.js';

export const INSTANCE_STATUSES = ['open', 'in_progress', 'completed', 'partially_completed', 'not_completed'];
export const COMPLETION_STATUSES = ['completed', 'partially_completed', 'not_completed'];

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_PASS = 500; // safety valve so a bad schedule cannot flood the store

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, field, max) {
  if (typeof value !== 'string') throw new AppError(400, `${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new AppError(400, `${field} must be at most ${max} characters`);
  return trimmed;
}

function requireText(value, field, max) {
  const text = cleanText(value ?? '', field, max);
  if (!text) throw new AppError(400, `${field} is required`);
  return text;
}

function optionalText(value, field, max) {
  return value === undefined || value === null ? '' : cleanText(value, field, max);
}

function parseDate(value, field) {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new AppError(400, `${field} must be a valid date`);
  return date;
}

function findOrFail(list, id, label) {
  const item = list.find((entry) => entry.id === id);
  if (!item) throw new AppError(404, `${label} not found`);
  return item;
}

export const isOverdue = (instance, now) =>
  !COMPLETION_STATUSES.includes(instance.status) && Date.parse(instance.dueAt) < now.getTime();

const byName = (a, b) => a.name.localeCompare(b.name);
const byTitle = (a, b) => a.title.localeCompare(b.title);

// Domain logic for staff, the reusable task library, schedules and the task
// instances those schedules generate.
export class TaskService {
  constructor({ store, now = () => new Date(), horizonDays = 7 }) {
    this.store = store;
    this.now = now;
    this.horizonMs = horizonDays * DAY_MS;
  }

  get db() {
    return this.store.data;
  }

  // ---- Staff -------------------------------------------------------------

  listStaff() {
    return [...this.db.staff].sort(byName);
  }

  createStaff(input = {}) {
    const staff = {
      id: randomUUID(),
      name: requireText(input.name, 'name', 80),
      role: optionalText(input.role, 'role', 80),
      createdAt: this.now().toISOString(),
    };
    this.db.staff.push(staff);
    this.store.save();
    return staff;
  }

  // ---- Task library (reusable task definitions) --------------------------

  listTemplates() {
    return [...this.db.templates].sort(byTitle);
  }

  createTemplate(input = {}) {
    const template = {
      id: randomUUID(),
      title: requireText(input.title, 'title', 120),
      description: optionalText(input.description, 'description', 2000),
      category: optionalText(input.category, 'category', 60),
      createdAt: this.now().toISOString(),
    };
    this.db.templates.push(template);
    this.store.save();
    return template;
  }

  updateTemplate(id, input = {}) {
    const template = findOrFail(this.db.templates, id, 'Task');
    if ('title' in input) template.title = requireText(input.title, 'title', 120);
    if ('description' in input) template.description = optionalText(input.description, 'description', 2000);
    if ('category' in input) template.category = optionalText(input.category, 'category', 60);
    template.updatedAt = this.now().toISOString();
    this.store.save();
    return template;
  }

  deleteTemplate(id) {
    findOrFail(this.db.templates, id, 'Task');
    if (this.db.schedules.some((schedule) => schedule.templateId === id)) {
      throw new AppError(409, 'This task has schedules. Delete them before deleting the task.');
    }
    this.db.templates = this.db.templates.filter((template) => template.id !== id);
    this.store.save();
  }

  // ---- Schedules (a task template assigned to a staff member) ------------

  listSchedules() {
    return [...this.db.schedules];
  }

  createSchedule(input = {}) {
    findOrFail(this.db.templates, input.templateId, 'Task');
    findOrFail(this.db.staff, input.staffId, 'Staff');
    if (!RECURRENCES.includes(input.recurrence)) {
      throw new AppError(400, `recurrence must be one of: ${RECURRENCES.join(', ')}`);
    }

    const now = this.now();
    const startAt = parseDate(input.startAt, 'startAt');
    if (startAt.getTime() < now.getTime() - DAY_MS) {
      throw new AppError(400, 'startAt cannot be more than a day in the past');
    }

    const schedule = {
      id: randomUUID(),
      templateId: input.templateId,
      staffId: input.staffId,
      recurrence: input.recurrence,
      startAt: startAt.toISOString(),
      nextIndex: 0,
      active: true,
      createdAt: now.toISOString(),
    };
    this.db.schedules.push(schedule);
    this.#generate(now);
    this.store.save();
    return schedule;
  }

  updateSchedule(id, input = {}) {
    const schedule = findOrFail(this.db.schedules, id, 'Schedule');
    if (typeof input.active !== 'boolean') throw new AppError(400, 'active must be true or false');
    schedule.active = input.active;
    if (schedule.active) this.#generate(this.now());
    this.store.save();
    return schedule;
  }

  deleteSchedule(id) {
    findOrFail(this.db.schedules, id, 'Schedule');
    this.db.schedules = this.db.schedules.filter((schedule) => schedule.id !== id);
    this.store.save();
  }

  // Creates task instances for every active schedule occurrence that falls
  // within the horizon. Safe to call repeatedly: each schedule remembers how
  // many occurrences it has already produced.
  generateDueInstances() {
    const created = this.#generate(this.now());
    if (created) this.store.save();
    return created;
  }

  #generate(now) {
    const horizon = now.getTime() + this.horizonMs;
    let created = 0;

    for (const schedule of this.db.schedules) {
      if (!schedule.active) continue;

      for (let pass = 0; pass < MAX_PER_PASS; pass += 1) {
        const due = occurrenceAt(schedule.startAt, schedule.recurrence, schedule.nextIndex);
        if (!due) {
          schedule.active = false; // a one-off schedule has produced its only instance
          break;
        }
        if (due.getTime() > horizon) break;

        this.db.instances.push(this.#makeInstance(schedule, due, now));
        schedule.nextIndex += 1;
        created += 1;
      }
    }
    return created;
  }

  #makeInstance(schedule, due, now) {
    const template = findOrFail(this.db.templates, schedule.templateId, 'Task');
    const stamp = now.toISOString();
    return {
      id: randomUUID(),
      scheduleId: schedule.id,
      templateId: template.id,
      staffId: schedule.staffId,
      // Snapshot the task text so later edits to the library do not rewrite history.
      title: template.title,
      description: template.description,
      dueAt: due.toISOString(),
      status: 'open',
      notes: '',
      completedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
  }

  // ---- Task instances (the work staff actually do) -----------------------

  listInstances(filters = {}) {
    const now = this.now();
    if (this.#generate(now)) this.store.save();

    if (filters.status && !INSTANCE_STATUSES.includes(filters.status)) {
      throw new AppError(400, `status must be one of: ${INSTANCE_STATUSES.join(', ')}`);
    }

    return this.db.instances
      .filter((instance) => !filters.staffId || instance.staffId === filters.staffId)
      .filter((instance) => !filters.status || instance.status === filters.status)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .map((instance) => ({ ...instance, overdue: isOverdue(instance, now) }));
  }

  updateInstance(id, input = {}) {
    const instance = findOrFail(this.db.instances, id, 'Task instance');
    const now = this.now();

    if ('status' in input) {
      if (!INSTANCE_STATUSES.includes(input.status)) {
        throw new AppError(400, `status must be one of: ${INSTANCE_STATUSES.join(', ')}`);
      }
      instance.status = input.status;
      // Keep the original completion time if the outcome is revised; clear it if reopened.
      instance.completedAt = COMPLETION_STATUSES.includes(input.status)
        ? instance.completedAt ?? now.toISOString()
        : null;
    }
    if ('notes' in input) instance.notes = optionalText(input.notes, 'notes', 2000);

    instance.updatedAt = now.toISOString();
    this.store.save();
    return { ...instance, overdue: isOverdue(instance, now) };
  }
}

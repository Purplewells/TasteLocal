const LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
  partially_completed: 'Partially completed',
  not_completed: 'Not completed',
  once: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const state = { meta: null, staff: [], templates: [], schedules: [], instances: [] };

const $ = (selector) => document.querySelector(selector);
const label = (value) => LABELS[value] ?? value;
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const staffName = (id) => state.staff.find((s) => s.id === id)?.name ?? 'Unknown staff';
const templateTitle = (id) => state.templates.find((t) => t.id === id)?.title ?? 'Deleted task';

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function showError(error) {
  const status = $('#status');
  status.textContent = error.message;
  status.classList.add('error');
  setTimeout(() => {
    status.textContent = '';
    status.classList.remove('error');
  }, 5000);
}

function fillSelect(select, options, placeholder) {
  const current = select.value;
  const placeholderOption = placeholder ? `<option value="">${esc(placeholder)}</option>` : '';
  select.innerHTML = placeholderOption + options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function renderOptions() {
  fillSelect($('#filter-staff'), state.staff.map((s) => ({ value: s.id, label: s.name })), 'All staff');
  fillSelect($('#filter-status'), state.meta.instanceStatuses.map((v) => ({ value: v, label: label(v) })), 'Any status');
  fillSelect($('#schedule-form [name=templateId]'), state.templates.map((t) => ({ value: t.id, label: t.title })), 'Choose a task');
  fillSelect($('#schedule-form [name=staffId]'), state.staff.map((s) => ({ value: s.id, label: s.name })), 'Choose staff');
  fillSelect($('#schedule-form [name=recurrence]'), state.meta.recurrences.map((v) => ({ value: v, label: label(v) })));
}

function renderInstances() {
  const list = $('#instances');
  if (!state.instances.length) {
    list.innerHTML = '<li class="empty">No task instances match. Schedule a task to generate them.</li>';
    return;
  }

  list.innerHTML = state.instances
    .map((i) => `
      <li class="card ${i.overdue ? 'is-overdue' : ''}" data-id="${esc(i.id)}">
        <div class="card-head">
          <div>
            <strong>${esc(i.title)}</strong>
            <div class="muted">${esc(staffName(i.staffId))} · due ${esc(fmt(i.dueAt))}</div>
          </div>
          <div>
            <span class="status status-${esc(i.status)}">${esc(label(i.status))}</span>
            ${i.overdue ? '<span class="badge overdue">Overdue</span>' : ''}
          </div>
        </div>
        ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ''}
        <form class="instance-form">
          <select name="status" aria-label="Task status">
            ${state.meta.instanceStatuses
              .map((s) => `<option value="${s}" ${s === i.status ? 'selected' : ''}>${esc(label(s))}</option>`)
              .join('')}
          </select>
          <input name="notes" placeholder="Notes for this task" maxlength="2000" value="${esc(i.notes)}">
          <button type="submit">Save</button>
        </form>
        ${i.completedAt ? `<p class="muted">Completed ${esc(fmt(i.completedAt))}</p>` : ''}
      </li>`)
    .join('');
}

function renderSchedules() {
  $('#schedules').innerHTML = state.schedules.length
    ? state.schedules
        .map((s) => {
          const stateText = s.active ? 'Active' : s.recurrence === 'once' ? 'Finished' : 'Paused';
          return `
            <li data-id="${esc(s.id)}">
              <div><strong>${esc(templateTitle(s.templateId))}</strong> → ${esc(staffName(s.staffId))}</div>
              <div class="muted">${esc(label(s.recurrence))} · from ${esc(fmt(s.startAt))} · ${stateText}</div>
              <div class="row-actions">
                ${s.recurrence !== 'once' || s.active
                  ? `<button type="button" data-action="toggle-schedule" data-id="${esc(s.id)}" data-active="${s.active}">${s.active ? 'Pause' : 'Resume'}</button>`
                  : ''}
                <button type="button" class="danger" data-action="delete-schedule" data-id="${esc(s.id)}">Delete</button>
              </div>
            </li>`;
        })
        .join('')
    : '<li class="empty">No schedules yet.</li>';
}

function renderTemplates() {
  $('#templates').innerHTML = state.templates.length
    ? state.templates
        .map((t) => `
          <li>
            <strong>${esc(t.title)}</strong>${t.category ? ` <span class="muted">· ${esc(t.category)}</span>` : ''}
            ${t.description ? `<div class="muted">${esc(t.description)}</div>` : ''}
            <div class="row-actions">
              <button type="button" class="danger" data-action="delete-template" data-id="${esc(t.id)}">Delete</button>
            </div>
          </li>`)
        .join('')
    : '<li class="empty">No tasks in the library yet.</li>';
}

function renderStaff() {
  $('#staff').innerHTML = state.staff.length
    ? state.staff
        .map((s) => `<li><strong>${esc(s.name)}</strong>${s.role ? ` <span class="muted">· ${esc(s.role)}</span>` : ''}</li>`)
        .join('')
    : '<li class="empty">No staff yet.</li>';
}

async function loadInstances() {
  const params = new URLSearchParams();
  if ($('#filter-staff').value) params.set('staffId', $('#filter-staff').value);
  if ($('#filter-status').value) params.set('status', $('#filter-status').value);
  state.instances = await api('GET', `/api/instances?${params}`);
  renderInstances();
}

async function loadAll() {
  const [meta, staff, templates, schedules] = await Promise.all([
    api('GET', '/api/meta'),
    api('GET', '/api/staff'),
    api('GET', '/api/templates'),
    api('GET', '/api/schedules'),
  ]);
  Object.assign(state, { meta, staff, templates, schedules });
  renderOptions();
  renderStaff();
  renderTemplates();
  renderSchedules();
  await loadInstances();
}

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));

  try {
    if (form.id === 'staff-form') {
      await api('POST', '/api/staff', values);
      form.reset();
      await loadAll();
    } else if (form.id === 'template-form') {
      await api('POST', '/api/templates', values);
      form.reset();
      await loadAll();
    } else if (form.id === 'schedule-form') {
      await api('POST', '/api/schedules', {
        templateId: values.templateId,
        staffId: values.staffId,
        recurrence: values.recurrence,
        startAt: new Date(values.startAt).toISOString(),
      });
      await loadAll();
    } else if (form.classList.contains('instance-form')) {
      const id = form.closest('[data-id]').dataset.id;
      await api('PATCH', `/api/instances/${id}`, { status: values.status, notes: values.notes });
      await loadInstances();
    }
  } catch (error) {
    showError(error);
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;

  try {
    if (action === 'toggle-schedule') {
      await api('PATCH', `/api/schedules/${id}`, { active: button.dataset.active !== 'true' });
    } else if (action === 'delete-schedule') {
      if (!confirm('Delete this schedule? Task instances already generated are kept.')) return;
      await api('DELETE', `/api/schedules/${id}`);
    } else if (action === 'delete-template') {
      if (!confirm('Delete this task from the library?')) return;
      await api('DELETE', `/api/templates/${id}`);
    }
    await loadAll();
  } catch (error) {
    showError(error);
  }
});

$('#filter-staff').addEventListener('change', () => loadInstances().catch(showError));
$('#filter-status').addEventListener('change', () => loadInstances().catch(showError));
$('#refresh').addEventListener('click', () => loadAll().catch(showError));

// Default the first-due field to the next full hour, in local time.
const next = new Date();
next.setMinutes(0, 0, 0);
next.setHours(next.getHours() + 1);
$('#schedule-form [name=startAt]').value = new Date(next - next.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

loadAll().catch(showError);

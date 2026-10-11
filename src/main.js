import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './store.js';
import { TaskService } from './tasks.js';
import { createServer } from './server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DATA_FILE = process.env.DATA_FILE ?? path.join(ROOT, 'data', 'db.json');
const SCHEDULER_TICK_MS = 60_000;

const service = new TaskService({ store: new JsonStore(DATA_FILE) });
service.generateDueInstances();

// Generates task instances as scheduled times come within the horizon.
setInterval(() => {
  try {
    service.generateDueInstances();
  } catch (error) {
    console.error('Scheduler tick failed', error);
  }
}, SCHEDULER_TICK_MS);

createServer({ service }).listen(PORT, () => {
  console.log(`Staff task manager running at http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});

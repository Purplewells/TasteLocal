import fs from 'node:fs';
import path from 'node:path';

const emptyDb = () => ({ staff: [], templates: [], schedules: [], instances: [] });

// Keeps the whole dataset in memory and writes it to a single JSON file after
// every change. Pass `null` as the file to run without persistence (tests).
export class JsonStore {
  constructor(file) {
    this.file = file;
    const saved = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    this.data = { ...emptyDb(), ...saved };
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

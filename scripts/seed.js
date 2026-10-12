import { existsSync, rmSync } from 'node:fs';

import { openDatabase } from '../src/db/index.js';
import { seedDemo } from '../src/demo.js';

const path = process.env.DATABASE_PATH ?? './data/assetnest.db';
if (path !== ':memory:' && existsSync(path) && !process.argv.includes('--force')) {
  console.error(`${path} already exists. Run "npm run seed -- --force" to replace it with demo data.`);
  process.exit(1);
}
if (path !== ':memory:') rmSync(path, { force: true });

const db = openDatabase(path);
const org = seedDemo(db);
console.log(`Seeded demo organization #${org.id} "${org.name}" into ${path}`);

import { createApp } from './app.js';
import { openDatabase } from './db/index.js';

const port = Number(process.env.PORT ?? 3000);
const db = openDatabase();

createApp(db).listen(port, () => {
  console.log(`AssetNest running at http://localhost:${port}`);
});

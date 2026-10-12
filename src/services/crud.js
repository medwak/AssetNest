export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what, id) => new HttpError(404, `${what} ${id} not found`);
export const badRequest = (message) => new HttpError(400, message);

// SQLite cannot bind booleans or undefined.
function toSql(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

export function pick(data, fields) {
  const out = {};
  for (const f of fields) if (data[f] !== undefined) out[f] = data[f];
  return out;
}

export function requireFields(data, fields) {
  const missing = fields.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
  if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(', ')}`);
}

export function requireInteger(data, fields) {
  for (const f of fields) {
    if (data[f] != null && !Number.isInteger(data[f])) {
      throw badRequest(`${f} must be an integer amount in minor units (e.g. cents)`);
    }
  }
}

export function insert(db, table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const { lastInsertRowid } = db.prepare(sql).run(...keys.map((k) => toSql(data[k])));
  return Number(lastInsertRowid);
}

export function updateRow(db, table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => toSql(data[k])), id);
}

export function getRow(db, table, id, what = table) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw notFound(what, id);
  return row;
}

// SELECT * with simple equality filters; undefined filters are ignored.
export function listRows(db, table, filters = {}, orderBy = 'id') {
  const entries = Object.entries(filters).filter(([, v]) => v !== undefined && v !== '');
  const where = entries.length ? `WHERE ${entries.map(([k]) => `${k} = ?`).join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM ${table} ${where} ORDER BY ${orderBy}`).all(...entries.map(([, v]) => toSql(v)));
}

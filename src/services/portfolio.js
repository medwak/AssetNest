// Organizations, properties, units, tenants, leases and their charges.

import { CHARGE_TYPES, METHODS, PROPERTY_TYPES, UNIT_TYPES, isChargeType } from '../config/chargeTypes.js';
import { PLANS } from '../config/pricing.js';
import { parseDate, today } from '../billing/dates.js';
import { transaction } from '../db/index.js';
import {
  HttpError,
  badRequest,
  getRow,
  insert,
  listRows,
  pick,
  requireFields,
  requireInteger,
  updateRow,
} from './crud.js';

function checkDate(value, field) {
  if (value == null) return;
  try {
    parseDate(value);
  } catch {
    throw badRequest(`${field} must be a date in YYYY-MM-DD format`);
  }
}

function checkOneOf(value, allowed, field) {
  if (value != null && !allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  }
}

// ---------------------------------------------------------------- organizations

const ORG_FIELDS = [
  'name', 'email', 'phone', 'currency', 'vat_rate',
  'late_fee_type', 'late_fee_value', 'late_fee_grace_days', 'plan', 'billing_cycle',
];

function validateOrg(data) {
  checkOneOf(data.plan, Object.keys(PLANS), 'plan');
  checkOneOf(data.billing_cycle, ['monthly', 'annual'], 'billing_cycle');
  checkOneOf(data.late_fee_type, ['none', 'flat', 'percent'], 'late_fee_type');
  if (data.late_fee_type === 'flat') requireInteger(data, ['late_fee_value']);
}

export const organizations = {
  list: (db) => listRows(db, 'organizations'),
  get: (db, id) => getRow(db, 'organizations', id, 'Organization'),
  create(db, body) {
    const data = pick(body, ORG_FIELDS);
    requireFields(data, ['name']);
    validateOrg(data);
    return this.get(db, insert(db, 'organizations', data));
  },
  update(db, id, body) {
    const current = this.get(db, id);
    const data = pick(body, ORG_FIELDS);
    validateOrg({ ...current, ...data });
    if (data.plan && data.plan !== current.plan) assertFitsPlan(db, id, data.plan);
    updateRow(db, 'organizations', id, data);
    return this.get(db, id);
  },
};

// ---------------------------------------------------------------- plan limits

export function usage(db, orgId) {
  const { properties } = db.prepare('SELECT COUNT(*) AS properties FROM properties WHERE org_id = ?').get(orgId);
  const { units } = db
    .prepare('SELECT COUNT(*) AS units FROM units u JOIN properties p ON p.id = u.property_id WHERE p.org_id = ?')
    .get(orgId);
  return { properties, units };
}

function planLimitError(plan, what, limit) {
  return new HttpError(
    402,
    `The ${plan.name} plan allows up to ${limit} ${what}. Upgrade your plan to add more.`,
  );
}

function assertFitsPlan(db, orgId, planCode, adding = { properties: 0, units: 0 }) {
  const plan = PLANS[planCode];
  const used = usage(db, orgId);
  if (plan.maxProperties != null && used.properties + adding.properties > plan.maxProperties) {
    throw planLimitError(plan, 'properties', plan.maxProperties);
  }
  if (plan.maxUnits != null && used.units + adding.units > plan.maxUnits) {
    throw planLimitError(plan, 'units', plan.maxUnits);
  }
}

// ---------------------------------------------------------------- properties

const PROPERTY_FIELDS = ['org_id', 'name', 'type', 'address', 'city', 'country', 'area_unit', 'notes'];

export const properties = {
  list: (db, query = {}) => listRows(db, 'properties', { org_id: query.org_id }),
  get: (db, id) => getRow(db, 'properties', id, 'Property'),
  create(db, body) {
    const data = pick(body, PROPERTY_FIELDS);
    requireFields(data, ['org_id', 'name', 'type']);
    checkOneOf(data.type, PROPERTY_TYPES, 'type');
    checkOneOf(data.area_unit, ['sqft', 'm2'], 'area_unit');
    const org = organizations.get(db, data.org_id);
    assertFitsPlan(db, org.id, org.plan, { properties: 1, units: 0 });
    return this.get(db, insert(db, 'properties', data));
  },
  update(db, id, body) {
    this.get(db, id);
    const data = pick(body, PROPERTY_FIELDS.filter((f) => f !== 'org_id'));
    checkOneOf(data.type, PROPERTY_TYPES, 'type');
    checkOneOf(data.area_unit, ['sqft', 'm2'], 'area_unit');
    updateRow(db, 'properties', id, data);
    return this.get(db, id);
  },
};

// ---------------------------------------------------------------- units

const UNIT_FIELDS = ['property_id', 'label', 'type', 'floor', 'area', 'bedrooms', 'bathrooms', 'market_rent', 'notes'];

const UNIT_STATUS_SQL = `
  SELECT u.*, p.name AS property_name, p.org_id,
    (SELECT l.id FROM leases l
      WHERE l.unit_id = u.id AND l.status = 'active' AND l.start_date <= ?
        AND (l.end_date IS NULL OR l.end_date >= ?)
      LIMIT 1) AS active_lease_id
  FROM units u JOIN properties p ON p.id = u.property_id`;

export const units = {
  list(db, query = {}) {
    const on = query.on ?? today();
    const filters = [];
    const params = [on, on];
    if (query.property_id) { filters.push('u.property_id = ?'); params.push(query.property_id); }
    if (query.org_id) { filters.push('p.org_id = ?'); params.push(query.org_id); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`${UNIT_STATUS_SQL} ${where} ORDER BY p.name, u.label`).all(...params)
      .map((u) => ({ ...u, occupied: u.active_lease_id != null }));
  },
  get(db, id) {
    getRow(db, 'units', id, 'Unit');
    const on = today();
    const u = db.prepare(`${UNIT_STATUS_SQL} WHERE u.id = ?`).get(on, on, id);
    return { ...u, occupied: u.active_lease_id != null };
  },
  create(db, body) {
    const data = pick(body, UNIT_FIELDS);
    requireFields(data, ['property_id', 'label', 'type']);
    checkOneOf(data.type, UNIT_TYPES, 'type');
    requireInteger(data, ['market_rent']);
    const property = properties.get(db, data.property_id);
    const org = organizations.get(db, property.org_id);
    assertFitsPlan(db, org.id, org.plan, { properties: 0, units: 1 });
    return this.get(db, insert(db, 'units', data));
  },
  update(db, id, body) {
    this.get(db, id);
    const data = pick(body, UNIT_FIELDS.filter((f) => f !== 'property_id'));
    checkOneOf(data.type, UNIT_TYPES, 'type');
    requireInteger(data, ['market_rent']);
    updateRow(db, 'units', id, data);
    return this.get(db, id);
  },
};

// ---------------------------------------------------------------- tenants

const TENANT_FIELDS = ['org_id', 'kind', 'name', 'contact_person', 'email', 'phone', 'id_number', 'tax_id', 'notes'];

export const tenants = {
  list: (db, query = {}) => listRows(db, 'tenants', { org_id: query.org_id }, 'name'),
  get: (db, id) => getRow(db, 'tenants', id, 'Tenant'),
  create(db, body) {
    const data = pick(body, TENANT_FIELDS);
    requireFields(data, ['org_id', 'name']);
    checkOneOf(data.kind, ['individual', 'business'], 'kind');
    organizations.get(db, data.org_id);
    return this.get(db, insert(db, 'tenants', data));
  },
  update(db, id, body) {
    this.get(db, id);
    const data = pick(body, TENANT_FIELDS.filter((f) => f !== 'org_id'));
    checkOneOf(data.kind, ['individual', 'business'], 'kind');
    updateRow(db, 'tenants', id, data);
    return this.get(db, id);
  },
};

// ---------------------------------------------------------------- lease charges

const CHARGE_FIELDS = ['charge_type', 'description', 'method', 'amount', 'rate', 'breakpoint', 'taxable', 'prorate'];

function validateCharge(data) {
  requireFields(data, ['charge_type']);
  if (!isChargeType(data.charge_type)) {
    throw badRequest(`Unknown charge_type "${data.charge_type}". See GET /api/charge-types`);
  }
  data.method ??= CHARGE_TYPES[data.charge_type].defaultMethod ?? 'fixed';
  checkOneOf(data.method, Object.keys(METHODS), 'method');
  requireInteger(data, ['amount', 'breakpoint']);
  if (data.method === 'fixed') requireFields(data, ['amount']);
  else requireFields(data, ['rate']);
  if (['metered', 'turnover'].includes(data.method)) data.prorate = 0;
}

export const leaseCharges = {
  list: (db, leaseId) => listRows(db, 'lease_charges', { lease_id: leaseId }),
  create(db, leaseId, body) {
    leases.getRaw(db, leaseId);
    const data = pick(body, CHARGE_FIELDS);
    validateCharge(data);
    const id = insert(db, 'lease_charges', { ...data, lease_id: leaseId });
    return getRow(db, 'lease_charges', id, 'Lease charge');
  },
  remove(db, leaseId, chargeId) {
    const charge = getRow(db, 'lease_charges', chargeId, 'Lease charge');
    if (charge.lease_id !== Number(leaseId)) throw badRequest('Charge does not belong to this lease');
    db.prepare('DELETE FROM lease_charges WHERE id = ?').run(chargeId);
  },
};

// ---------------------------------------------------------------- leases

const LEASE_FIELDS = [
  'unit_id', 'tenant_id', 'start_date', 'end_date', 'rent_amount', 'deposit_amount', 'due_day',
  'escalation_rate', 'escalation_interval_months', 'vat_applicable', 'notes',
];

const LEASE_SQL = `
  SELECT l.*, t.name AS tenant_name, u.label AS unit_label, u.type AS unit_type,
         p.id AS property_id, p.name AS property_name
  FROM leases l
  JOIN tenants t ON t.id = l.tenant_id
  JOIN units u ON u.id = l.unit_id
  JOIN properties p ON p.id = u.property_id`;

function assertUnitFree(db, unitId, start, end, ignoreLeaseId = 0) {
  const clash = db.prepare(`
    SELECT id FROM leases
    WHERE unit_id = ? AND id != ? AND status = 'active'
      AND start_date <= COALESCE(?, '9999-12-31')
      AND COALESCE(end_date, '9999-12-31') >= ?
    LIMIT 1`).get(unitId, ignoreLeaseId, end ?? null, start);
  if (clash) throw new HttpError(409, `Unit already has an active lease (#${clash.id}) for those dates`);
}

export const leases = {
  list(db, query = {}) {
    const filters = [];
    const params = [];
    for (const [key, col] of [['org_id', 'l.org_id'], ['tenant_id', 'l.tenant_id'], ['unit_id', 'l.unit_id'], ['status', 'l.status'], ['property_id', 'p.id']]) {
      if (query[key]) { filters.push(`${col} = ?`); params.push(query[key]); }
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`${LEASE_SQL} ${where} ORDER BY p.name, u.label`).all(...params);
  },
  getRaw: (db, id) => getRow(db, 'leases', id, 'Lease'),
  get(db, id) {
    this.getRaw(db, id);
    const lease = db.prepare(`${LEASE_SQL} WHERE l.id = ?`).get(id);
    return { ...lease, charges: leaseCharges.list(db, id) };
  },
  // body may include `charges: [...]` to set up recurring charges in one call.
  create(db, body) {
    const data = pick(body, LEASE_FIELDS);
    requireFields(data, ['unit_id', 'tenant_id', 'start_date', 'rent_amount']);
    requireInteger(data, ['rent_amount', 'deposit_amount']);
    checkDate(data.start_date, 'start_date');
    checkDate(data.end_date, 'end_date');
    if (data.end_date && data.end_date < data.start_date) throw badRequest('end_date is before start_date');
    const unit = units.get(db, data.unit_id);
    const tenant = tenants.get(db, data.tenant_id);
    if (tenant.org_id !== unit.org_id) throw badRequest('Tenant and unit belong to different organizations');
    const charges = (body.charges ?? []).map((c) => {
      const charge = pick(c, CHARGE_FIELDS);
      validateCharge(charge);
      return charge;
    });

    return transaction(db, () => {
      assertUnitFree(db, data.unit_id, data.start_date, data.end_date);
      const id = insert(db, 'leases', { ...data, org_id: unit.org_id });
      for (const charge of charges) insert(db, 'lease_charges', { ...charge, lease_id: id });
      return this.get(db, id);
    });
  },
  update(db, id, body) {
    const current = this.getRaw(db, id);
    const data = pick(body, LEASE_FIELDS.filter((f) => !['unit_id', 'tenant_id'].includes(f)));
    requireInteger(data, ['rent_amount', 'deposit_amount']);
    checkDate(data.start_date, 'start_date');
    checkDate(data.end_date, 'end_date');
    const merged = { ...current, ...data };
    if (merged.end_date && merged.end_date < merged.start_date) throw badRequest('end_date is before start_date');
    assertUnitFree(db, current.unit_id, merged.start_date, merged.end_date, id);
    updateRow(db, 'leases', id, data);
    return this.get(db, id);
  },
  terminate(db, id, { terminated_on = today(), move_out_fee } = {}) {
    checkDate(terminated_on, 'terminated_on');
    const lease = this.getRaw(db, id);
    if (lease.status === 'terminated') throw new HttpError(409, 'Lease is already terminated');
    if (terminated_on < lease.start_date) throw badRequest('terminated_on is before the lease start');
    return transaction(db, () => {
      updateRow(db, 'leases', id, { status: 'terminated', terminated_on });
      if (move_out_fee) {
        requireInteger({ move_out_fee }, ['move_out_fee']);
        oneTimeCharges.create(db, { lease_id: id, charge_type: 'move_out_fee', amount: move_out_fee, charge_date: terminated_on });
      }
      return this.get(db, id);
    });
  },
};

// ---------------------------------------------------------------- readings, sales, ad-hoc charges

export const meterReadings = {
  list: (db, query = {}) => listRows(db, 'meter_readings', { lease_charge_id: query.lease_charge_id, period: query.period }),
  create(db, body) {
    const data = pick(body, ['lease_charge_id', 'period', 'previous_reading', 'current_reading', 'read_on']);
    requireFields(data, ['lease_charge_id', 'period', 'previous_reading', 'current_reading']);
    checkPeriod(data.period);
    const charge = getRow(db, 'lease_charges', data.lease_charge_id, 'Lease charge');
    if (charge.method !== 'metered') throw badRequest('Readings can only be recorded against a metered charge');
    if (data.current_reading < data.previous_reading) throw badRequest('current_reading is lower than previous_reading');
    try {
      return getRow(db, 'meter_readings', insert(db, 'meter_readings', data));
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw new HttpError(409, 'A reading for this charge and period already exists');
      throw err;
    }
  },
};

function checkPeriod(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw badRequest('period must be YYYY-MM');
}

export const salesReports = {
  list: (db, query = {}) => listRows(db, 'sales_reports', { lease_id: query.lease_id, period: query.period }, 'period'),
  create(db, body) {
    const data = pick(body, ['lease_id', 'period', 'gross_sales']);
    requireFields(data, ['lease_id', 'period', 'gross_sales']);
    requireInteger(data, ['gross_sales']);
    checkPeriod(data.period);
    leases.getRaw(db, data.lease_id);
    try {
      return getRow(db, 'sales_reports', insert(db, 'sales_reports', data));
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw new HttpError(409, 'Sales for this lease and period were already reported');
      throw err;
    }
  },
};

export const oneTimeCharges = {
  list: (db, query = {}) => listRows(db, 'one_time_charges', { lease_id: query.lease_id }, 'charge_date'),
  create(db, body) {
    const data = pick(body, ['lease_id', 'charge_type', 'description', 'amount', 'taxable', 'charge_date', 'source_invoice_id']);
    data.charge_date ??= today();
    requireFields(data, ['lease_id', 'charge_type', 'amount']);
    requireInteger(data, ['amount']);
    checkDate(data.charge_date, 'charge_date');
    if (!isChargeType(data.charge_type)) throw badRequest(`Unknown charge_type "${data.charge_type}"`);
    leases.getRaw(db, data.lease_id);
    return getRow(db, 'one_time_charges', insert(db, 'one_time_charges', data));
  },
};

// ---------------------------------------------------------------- maintenance

const MAINTENANCE_FIELDS = ['org_id', 'unit_id', 'tenant_id', 'lease_id', 'title', 'description', 'priority', 'status', 'cost', 'recharge_to_tenant'];

export const maintenance = {
  list: (db, query = {}) => listRows(db, 'maintenance_requests', { org_id: query.org_id, status: query.status, unit_id: query.unit_id }, 'created_at DESC'),
  get: (db, id) => getRow(db, 'maintenance_requests', id, 'Maintenance request'),
  create(db, body) {
    const data = pick(body, MAINTENANCE_FIELDS);
    requireFields(data, ['org_id', 'title']);
    checkOneOf(data.priority, ['low', 'normal', 'high', 'urgent'], 'priority');
    requireInteger(data, ['cost']);
    organizations.get(db, data.org_id);
    return this.get(db, insert(db, 'maintenance_requests', { ...data, status: 'open' }));
  },
  // Completing a request marked recharge_to_tenant bills its cost to the
  // tenant's lease on the next invoice.
  update(db, id, body) {
    const current = this.get(db, id);
    const data = pick(body, MAINTENANCE_FIELDS.filter((f) => f !== 'org_id'));
    checkOneOf(data.priority, ['low', 'normal', 'high', 'urgent'], 'priority');
    checkOneOf(data.status, ['open', 'in_progress', 'completed', 'cancelled'], 'status');
    requireInteger(data, ['cost']);
    return transaction(db, () => {
      const merged = { ...current, ...data };
      if (data.status === 'completed' && current.status !== 'completed') {
        data.completed_on = today();
        if (merged.recharge_to_tenant && merged.cost > 0 && !current.recharged_charge_id) {
          if (!merged.lease_id) throw badRequest('Set lease_id to recharge the repair cost to a tenant');
          const charge = oneTimeCharges.create(db, {
            lease_id: merged.lease_id,
            charge_type: 'maintenance_recharge',
            description: `Repair: ${merged.title}`,
            amount: merged.cost,
          });
          data.recharged_charge_id = charge.id;
        }
      }
      updateRow(db, 'maintenance_requests', id, data);
      return this.get(db, id);
    });
  },
};

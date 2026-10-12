// Invoicing runs, payments, late fees, statements and the dashboard.

import { PAYMENT_METHODS, PRICING_CURRENCY } from '../config/pricing.js';
import { allocatePayment, invoiceStatus, lateFeeFor } from '../billing/allocation.js';
import { dayOfMonth, maxDate, monthPeriod, parseDate, today } from '../billing/dates.js';
import { buildInvoice, previousPeriodKey, rentAt } from '../billing/invoiceEngine.js';
import { sum } from '../billing/money.js';
import { platformFee, quoteSubscription } from '../billing/subscription.js';
import { transaction } from '../db/index.js';
import { HttpError, badRequest, getRow, insert, listRows, pick, requireFields, requireInteger, updateRow } from './crud.js';
import { oneTimeCharges, organizations, tenants, usage } from './portfolio.js';

const periodKey = (p) => `${p.year}-${String(p.month).padStart(2, '0')}`;

// ---------------------------------------------------------------- invoicing

function leasesToBill(db, orgId, period) {
  return db.prepare(`
    SELECT * FROM leases
    WHERE org_id = ? AND start_date <= ?
      AND (end_date IS NULL OR end_date >= ?)
      AND (terminated_on IS NULL OR terminated_on >= ?)
    ORDER BY id`).all(orgId, period.end, period.start, period.start);
}

function liveInvoice(db, leaseId, key) {
  return db.prepare(`SELECT id, number FROM invoices WHERE lease_id = ? AND period = ? AND status != 'void'`).get(leaseId, key);
}

/**
 * Generates the month's invoice for every lease in the organization.
 * Safe to run more than once: leases already invoiced are skipped.
 */
export function runBilling(db, { org_id, year, month, issue_date }) {
  const org = organizations.get(db, org_id);
  let period;
  try {
    period = monthPeriod(Number(year), Number(month));
  } catch (err) {
    throw badRequest(err.message);
  }
  const key = periodKey(period);
  const result = { period: key, created: [], skipped: [], warnings: [] };

  transaction(db, () => {
    const touchedTenants = new Set();

    for (const lease of leasesToBill(db, org.id, period)) {
      const existing = liveInvoice(db, lease.id, key);
      if (existing) {
        result.skipped.push({ lease_id: lease.id, reason: `already invoiced (${existing.number})` });
        continue;
      }

      const unit = getRow(db, 'units', lease.unit_id);
      const charges = listRows(db, 'lease_charges', { lease_id: lease.id });
      const meterReadings = {};
      for (const r of db.prepare(`
        SELECT mr.* FROM meter_readings mr JOIN lease_charges lc ON lc.id = mr.lease_charge_id
        WHERE lc.lease_id = ? AND mr.period = ?`).all(lease.id, key)) {
        meterReadings[r.lease_charge_id] = r;
      }
      const salesReport = db.prepare('SELECT * FROM sales_reports WHERE lease_id = ? AND period = ?')
        .get(lease.id, previousPeriodKey(period)) ?? null;
      const pendingCharges = db.prepare(`
        SELECT * FROM one_time_charges WHERE lease_id = ? AND invoice_id IS NULL AND charge_date <= ?
        ORDER BY charge_date, id`).all(lease.id, period.end);
      const isFirstInvoice = !db.prepare(`SELECT 1 FROM invoices WHERE lease_id = ? AND status != 'void' LIMIT 1`).get(lease.id);

      const built = buildInvoice({
        lease, unit, charges, period, meterReadings, salesReport,
        oneTimeCharges: pendingCharges, isFirstInvoice, vatRate: org.vat_rate,
      });
      if (!built) {
        result.skipped.push({ lease_id: lease.id, reason: 'no occupied days in period' });
        continue;
      }

      // A tenant moving in mid-month is invoiced from their start date.
      const issueDate = issue_date ?? maxDate(period.start, lease.start_date);
      let dueDate = dayOfMonth(period.year, period.month, lease.due_day);
      if (dueDate < issueDate) dueDate = issueDate;

      const invoiceId = insert(db, 'invoices', {
        org_id: org.id,
        lease_id: lease.id,
        tenant_id: lease.tenant_id,
        number: `PENDING-${lease.id}-${key}-${Date.now()}`,
        period: key,
        issue_date: issueDate,
        due_date: dueDate,
        subtotal: built.subtotal,
        tax: built.tax,
        total: built.total,
        status: built.total === 0 ? 'paid' : 'open',
      });
      const number = `INV-${key.replace('-', '')}-${String(invoiceId).padStart(5, '0')}`;
      updateRow(db, 'invoices', invoiceId, { number });

      for (const line of built.lines) insert(db, 'invoice_lines', { ...line, invoice_id: invoiceId });
      for (const c of pendingCharges) updateRow(db, 'one_time_charges', c.id, { invoice_id: invoiceId });

      touchedTenants.add(lease.tenant_id);
      result.created.push({ invoice_id: invoiceId, number, lease_id: lease.id, total: built.total });
      for (const w of built.warnings) result.warnings.push(`Lease ${lease.id}: ${w}`);
    }

    // Tenants who paid ahead have their credit applied straight away.
    for (const tenantId of touchedTenants) applyCredits(db, tenantId);
  });

  return result;
}

export const invoices = {
  list(db, query = {}) {
    const filters = [];
    const params = [];
    for (const key of ['id', 'org_id', 'tenant_id', 'lease_id', 'period', 'status']) {
      if (query[key]) { filters.push(`i.${key} = ?`); params.push(query[key]); }
    }
    if (query.overdue === 'true') { filters.push(`i.status IN ('open','partial') AND i.due_date < ?`); params.push(today()); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`
      SELECT i.*, i.total - i.amount_paid AS balance, t.name AS tenant_name,
             u.label AS unit_label, p.name AS property_name
      FROM invoices i
      JOIN tenants t ON t.id = i.tenant_id
      JOIN leases l ON l.id = i.lease_id
      JOIN units u ON u.id = l.unit_id
      JOIN properties p ON p.id = u.property_id
      ${where} ORDER BY i.period DESC, i.id DESC`).all(...params);
  },
  get(db, id) {
    getRow(db, 'invoices', id, 'Invoice');
    const [invoice] = this.list(db, { id });
    return {
      ...invoice,
      lines: listRows(db, 'invoice_lines', { invoice_id: id }),
      payments: db.prepare(`
        SELECT pa.amount, p.id AS payment_id, p.paid_on, p.method, p.reference
        FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
        WHERE pa.invoice_id = ? ORDER BY p.paid_on`).all(id),
    };
  },
  // Only unpaid invoices can be voided. Their one-off charges go back in the
  // queue and the month can be billed again.
  void(db, id) {
    const invoice = getRow(db, 'invoices', id, 'Invoice');
    if (invoice.status === 'void') throw new HttpError(409, 'Invoice is already void');
    if (invoice.amount_paid > 0) throw new HttpError(409, 'Invoice has payments allocated; it cannot be voided');
    transaction(db, () => {
      updateRow(db, 'invoices', id, { status: 'void' });
      db.prepare('UPDATE one_time_charges SET invoice_id = NULL WHERE invoice_id = ?').run(id);
    });
    return this.get(db, id);
  },
};

// ---------------------------------------------------------------- payments

function unallocated(db, paymentId) {
  const { allocated } = db.prepare('SELECT COALESCE(SUM(amount), 0) AS allocated FROM payment_allocations WHERE payment_id = ?').get(paymentId);
  const { amount } = db.prepare('SELECT amount FROM payments WHERE id = ?').get(paymentId);
  return amount - allocated;
}

// Applies any unallocated money the tenant has paid to their open invoices,
// oldest due first.
export function applyCredits(db, tenantId) {
  transaction(db, () => {
    const payments = db.prepare('SELECT id FROM payments WHERE tenant_id = ? ORDER BY paid_on, id').all(tenantId);
    for (const { id: paymentId } of payments) {
      const available = unallocated(db, paymentId);
      if (available <= 0) continue;
      const open = db.prepare(`SELECT * FROM invoices WHERE tenant_id = ? AND status IN ('open', 'partial')`).all(tenantId);
      const { allocations } = allocatePayment(available, open);
      for (const a of allocations) {
        insert(db, 'payment_allocations', { payment_id: paymentId, invoice_id: a.invoice_id, amount: a.amount });
        const inv = getRow(db, 'invoices', a.invoice_id);
        const amountPaid = inv.amount_paid + a.amount;
        updateRow(db, 'invoices', inv.id, { amount_paid: amountPaid, status: invoiceStatus({ ...inv, amount_paid: amountPaid }) });
      }
    }
  });
}

export const payments = {
  list(db, query = {}) {
    const filters = [];
    const params = [];
    for (const key of ['id', 'org_id', 'tenant_id', 'method']) {
      if (query[key]) { filters.push(`p.${key} = ?`); params.push(query[key]); }
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`
      SELECT p.*, t.name AS tenant_name,
        p.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id = p.id), 0) AS unallocated
      FROM payments p JOIN tenants t ON t.id = p.tenant_id
      ${where} ORDER BY p.paid_on DESC, p.id DESC`).all(...params);
  },
  get(db, id) {
    getRow(db, 'payments', id, 'Payment');
    const [payment] = this.list(db, { id });
    return { ...payment, allocations: listRows(db, 'payment_allocations', { payment_id: id }) };
  },
  record(db, body) {
    const data = pick(body, ['tenant_id', 'amount', 'method', 'reference', 'paid_on', 'notes']);
    data.paid_on ??= today();
    requireFields(data, ['tenant_id', 'amount', 'method']);
    requireInteger(data, ['amount']);
    if (data.amount <= 0) throw badRequest('amount must be positive');
    if (!PAYMENT_METHODS.includes(data.method)) throw badRequest(`method must be one of: ${PAYMENT_METHODS.join(', ')}`);
    try { parseDate(data.paid_on); } catch { throw badRequest('paid_on must be YYYY-MM-DD'); }
    const tenant = tenants.get(db, data.tenant_id);
    const org = organizations.get(db, tenant.org_id);

    return transaction(db, () => {
      const id = insert(db, 'payments', {
        ...data,
        org_id: org.id,
        platform_fee: platformFee(org.plan, data.method, data.amount, {
          includeFixed: org.currency === PRICING_CURRENCY,
        }),
      });
      applyCredits(db, tenant.id);
      return { ...this.get(db, id), tenant_balance: tenantBalance(db, tenant.id) };
    });
  },
};

// ---------------------------------------------------------------- late fees

/** Adds a late-fee charge (billed on the next invoice) to each overdue invoice, once per invoice. */
export function assessLateFees(db, { org_id, as_of }) {
  const org = organizations.get(db, org_id);
  const asOf = as_of ?? today();
  const assessed = [];
  transaction(db, () => {
    const overdue = db.prepare(`
      SELECT i.* FROM invoices i
      WHERE i.org_id = ? AND i.status IN ('open', 'partial') AND i.due_date < ?
        AND NOT EXISTS (SELECT 1 FROM one_time_charges c WHERE c.source_invoice_id = i.id AND c.charge_type = 'late_fee')`)
      .all(org.id, asOf);
    for (const inv of overdue) {
      const amount = lateFeeFor(inv, asOf, org);
      if (amount <= 0) continue;
      const charge = oneTimeCharges.create(db, {
        lease_id: inv.lease_id,
        charge_type: 'late_fee',
        description: `Late payment fee on ${inv.number}`,
        amount,
        charge_date: asOf,
        source_invoice_id: inv.id,
      });
      assessed.push({ invoice_id: inv.id, number: inv.number, amount, charge_id: charge.id });
    }
  });
  return { as_of: asOf, assessed };
}

// ---------------------------------------------------------------- statements

export function tenantBalance(db, tenantId) {
  const { billed } = db.prepare(`SELECT COALESCE(SUM(total), 0) AS billed FROM invoices WHERE tenant_id = ? AND status != 'void'`).get(tenantId);
  const { paid } = db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE tenant_id = ?').get(tenantId);
  return billed - paid;
}

export function tenantStatement(db, tenantId) {
  const tenant = tenants.get(db, tenantId);
  const org = organizations.get(db, tenant.org_id);
  const entries = [
    ...db.prepare(`SELECT issue_date AS date, number AS reference, 'invoice' AS type, total AS debit, 0 AS credit, period
                   FROM invoices WHERE tenant_id = ? AND status != 'void'`).all(tenantId)
      .map((i) => ({ ...i, description: `Invoice for ${i.period}` })),
    ...db.prepare(`SELECT paid_on AS date, COALESCE(reference, 'PMT-' || id) AS reference, 'payment' AS type, 0 AS debit, amount AS credit, method
                   FROM payments WHERE tenant_id = ?`).all(tenantId)
      .map((p) => ({ ...p, description: `Payment (${p.method})` })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'invoice' ? -1 : 1));

  let balance = 0;
  for (const e of entries) {
    balance += e.debit - e.credit;
    e.balance = balance;
  }
  const { overdue } = db.prepare(`
    SELECT COALESCE(SUM(total - amount_paid), 0) AS overdue FROM invoices
    WHERE tenant_id = ? AND status IN ('open', 'partial') AND due_date < ?`).get(tenantId, today());

  return {
    tenant,
    currency: org.currency,
    entries,
    balance,
    overdue,
    leases: db.prepare(`
      SELECT l.id, l.status, l.start_date, l.end_date, l.rent_amount, l.deposit_amount, u.label AS unit_label, p.name AS property_name
      FROM leases l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
      WHERE l.tenant_id = ?`).all(tenantId),
  };
}

// ---------------------------------------------------------------- dashboard

export function dashboard(db, orgId, asOf = today()) {
  const org = organizations.get(db, orgId);
  const monthKey = asOf.slice(0, 7);
  const used = usage(db, org.id);

  const activeLeases = db.prepare(`
    SELECT * FROM leases WHERE org_id = ? AND start_date <= ?
      AND (end_date IS NULL OR end_date >= ?) AND (terminated_on IS NULL OR terminated_on >= ?)`)
    .all(org.id, asOf, asOf, asOf);
  const occupiedUnits = new Set(activeLeases.map((l) => l.unit_id)).size;

  const byProperty = db.prepare(`
    SELECT p.id, p.name, p.type, COUNT(u.id) AS units,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM leases l WHERE l.unit_id = u.id AND l.start_date <= ?
          AND (l.end_date IS NULL OR l.end_date >= ?) AND (l.terminated_on IS NULL OR l.terminated_on >= ?)
      ) THEN 1 ELSE 0 END) AS occupied
    FROM properties p LEFT JOIN units u ON u.property_id = p.id
    WHERE p.org_id = ? GROUP BY p.id ORDER BY p.name`).all(asOf, asOf, asOf, org.id);

  const scalar = (sql, ...params) => Object.values(db.prepare(sql).get(...params))[0] ?? 0;

  const billedThisMonth = scalar(`SELECT COALESCE(SUM(total), 0) FROM invoices WHERE org_id = ? AND period = ? AND status != 'void'`, org.id, monthKey);
  const collectedThisMonth = scalar(`SELECT COALESCE(SUM(amount), 0) FROM payments WHERE org_id = ? AND substr(paid_on, 1, 7) = ?`, org.id, monthKey);
  const platformFeesThisMonth = scalar(`SELECT COALESCE(SUM(platform_fee), 0) FROM payments WHERE org_id = ? AND substr(paid_on, 1, 7) = ?`, org.id, monthKey);
  const outstanding = scalar(`SELECT COALESCE(SUM(total - amount_paid), 0) FROM invoices WHERE org_id = ? AND status IN ('open', 'partial')`, org.id);
  const arrears = scalar(`SELECT COALESCE(SUM(total - amount_paid), 0) FROM invoices WHERE org_id = ? AND status IN ('open', 'partial') AND due_date < ?`, org.id, asOf);

  const topArrears = db.prepare(`
    SELECT t.id, t.name, SUM(i.total - i.amount_paid) AS overdue
    FROM invoices i JOIN tenants t ON t.id = i.tenant_id
    WHERE i.org_id = ? AND i.status IN ('open', 'partial') AND i.due_date < ?
    GROUP BY t.id ORDER BY overdue DESC LIMIT 5`).all(org.id, asOf);

  const leasesExpiring = db.prepare(`
    SELECT l.id, l.end_date, t.name AS tenant_name, u.label AS unit_label
    FROM leases l JOIN tenants t ON t.id = l.tenant_id JOIN units u ON u.id = l.unit_id
    WHERE l.org_id = ? AND l.status = 'active' AND l.end_date BETWEEN ? AND date(?, '+90 days')
    ORDER BY l.end_date`).all(org.id, asOf, asOf);

  return {
    as_of: asOf,
    organization: { id: org.id, name: org.name, currency: org.currency, plan: org.plan, billing_cycle: org.billing_cycle },
    properties: used.properties,
    units: used.units,
    occupied_units: occupiedUnits,
    occupancy_rate: used.units ? Math.round((occupiedUnits / used.units) * 1000) / 10 : 0,
    monthly_rent_roll: sum(activeLeases.map((l) => rentAt(l, asOf))),
    billed_this_month: billedThisMonth,
    collected_this_month: collectedThisMonth,
    collection_rate: billedThisMonth ? Math.round((collectedThisMonth / billedThisMonth) * 1000) / 10 : null,
    outstanding,
    arrears,
    open_maintenance: scalar(`SELECT COUNT(*) FROM maintenance_requests WHERE org_id = ? AND status IN ('open', 'in_progress')`, org.id),
    by_property: byProperty,
    top_arrears: topArrears,
    leases_expiring_90_days: leasesExpiring,
    subscription: {
      ...quoteSubscription({ plan: org.plan, units: used.units, cycle: org.billing_cycle }),
      platform_fees_this_month: platformFeesThisMonth,
    },
  };
}

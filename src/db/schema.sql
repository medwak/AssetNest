-- Money columns are INTEGER minor units (cents). Dates are TEXT YYYY-MM-DD.

PRAGMA foreign_keys = ON;

-- A landlord or property management company using AssetNest.
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  vat_rate REAL NOT NULL DEFAULT 0,
  late_fee_type TEXT NOT NULL DEFAULT 'none' CHECK (late_fee_type IN ('none', 'flat', 'percent')),
  late_fee_value REAL NOT NULL DEFAULT 0,
  late_fee_grace_days INTEGER NOT NULL DEFAULT 5,
  plan TEXT NOT NULL DEFAULT 'starter',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  address TEXT,
  city TEXT,
  country TEXT,
  area_unit TEXT NOT NULL DEFAULT 'sqft' CHECK (area_unit IN ('sqft', 'm2')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anything rentable: an apartment, a shop in a mall, an office floor, a
-- parking bay, a billboard.
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  floor TEXT,
  area REAL,
  bedrooms INTEGER,
  bathrooms INTEGER,
  market_rent INTEGER,
  notes TEXT,
  UNIQUE (property_id, label)
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual', 'business')),
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  id_number TEXT,
  tax_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leases (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  start_date TEXT NOT NULL,
  end_date TEXT,
  rent_amount INTEGER NOT NULL CHECK (rent_amount >= 0),
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 31),
  escalation_rate REAL NOT NULL DEFAULT 0,
  escalation_interval_months INTEGER NOT NULL DEFAULT 12,
  vat_applicable INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
  terminated_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recurring charges on a lease besides rent.
CREATE TABLE IF NOT EXISTS lease_charges (
  id INTEGER PRIMARY KEY,
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  charge_type TEXT NOT NULL,
  description TEXT,
  method TEXT NOT NULL CHECK (method IN ('fixed', 'per_area', 'percent_of_rent', 'metered', 'turnover')),
  amount INTEGER,
  rate REAL,
  breakpoint INTEGER,
  taxable INTEGER,
  prorate INTEGER NOT NULL DEFAULT 1
);

-- Meter readings, keyed by the billing period they are invoiced in.
CREATE TABLE IF NOT EXISTS meter_readings (
  id INTEGER PRIMARY KEY,
  lease_charge_id INTEGER NOT NULL REFERENCES lease_charges(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  previous_reading REAL NOT NULL,
  current_reading REAL NOT NULL,
  read_on TEXT,
  UNIQUE (lease_charge_id, period)
);

-- Tenant gross sales for a month, used for turnover rent the month after.
CREATE TABLE IF NOT EXISTS sales_reports (
  id INTEGER PRIMARY KEY,
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  gross_sales INTEGER NOT NULL,
  UNIQUE (lease_id, period)
);

-- Ad-hoc charges (late fees, repairs, key replacement...) added to the
-- next invoice.
CREATE TABLE IF NOT EXISTS one_time_charges (
  id INTEGER PRIMARY KEY,
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  charge_type TEXT NOT NULL,
  description TEXT,
  amount INTEGER NOT NULL,
  taxable INTEGER,
  charge_date TEXT NOT NULL,
  source_invoice_id INTEGER REFERENCES invoices(id),
  invoice_id INTEGER REFERENCES invoices(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id INTEGER NOT NULL REFERENCES leases(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  number TEXT NOT NULL UNIQUE,
  period TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'paid', 'void')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One live invoice per lease per month; a voided one can be re-issued.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_lease_period
  ON invoices(lease_id, period) WHERE status != 'void';

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  charge_type TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  amount INTEGER NOT NULL,
  taxable INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  source_id INTEGER
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL,
  reference TEXT,
  paid_on TEXT NOT NULL,
  platform_fee INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id),
  tenant_id INTEGER REFERENCES tenants(id),
  lease_id INTEGER REFERENCES leases(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  cost INTEGER NOT NULL DEFAULT 0,
  recharge_to_tenant INTEGER NOT NULL DEFAULT 0,
  recharged_charge_id INTEGER REFERENCES one_time_charges(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_on TEXT
);

CREATE INDEX IF NOT EXISTS idx_units_property ON units(property_id);
CREATE INDEX IF NOT EXISTS idx_leases_unit ON leases(unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_tenant ON leases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_allocations_invoice ON payment_allocations(invoice_id);

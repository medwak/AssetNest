# AssetNest

Rental management for landlords of every kind: shopping malls, office blocks, apartment buildings, warehouses, mixed-use developments and single homes. It also covers their tenants, both individuals and businesses.

AssetNest keeps track of properties, units, tenants and leases. It invoices rent and every related charge each month, records payments, applies late fees and VAT, and shows the landlord where the money is.

## Features

- **Any property, any space.** Malls, office buildings, apartments, warehouses and land. Units can be apartments, shops, kiosks, offices, parking bays or billboards, with area in sq ft or m².
- **Leases.** Rent, deposits, due day, annual escalation and VAT applicability. Fixed-term or open-ended. Terminating a lease prorates the final month.
- **Every charge.** Service charge per sq ft, marketing levy as a % of rent, metered water and electricity, turnover rent from tenant sales, parking, signage, late fees, repairs and more. See [docs/PRICING.md](docs/PRICING.md).
- **Monthly billing.** One click (or one API call) invoices every lease, with proration, VAT and deposits handled. It's safe to re-run.
- **Payments.** Cash, cheque, bank, card and mobile money. Payments are applied to the oldest invoice first, and overpayments become credit.
- **Late fees.** Flat or percentage, with a grace period, charged once per overdue invoice.
- **Tenant statements** with a running balance.
- **Maintenance** requests, with optional recharge of repair costs to the tenant.
- **Dashboard.** Occupancy, rent roll, billed vs collected, arrears, top debtors and leases expiring within 90 days.
- **AssetNest's own pricing.** Four plans with enforced unit and property limits, add-ons, annual discount, transaction fees and a price calculator.

## Quick start

Requires Node.js 22.13 or newer. The database is the built-in `node:sqlite`, so there are no native modules to compile.

```bash
npm install
npm run seed      # optional: loads a demo mall, office park and apartment block
npm start         # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with auto-restart on file changes |
| `npm run seed` | Create demo data (`-- --force` replaces an existing database) |
| `npm test` | Run the test suite |

Environment variables (see `.env.example`):

- `PORT`: defaults to `3000`
- `DATABASE_PATH`: defaults to `./data/assetnest.db`; use `:memory:` for a throwaway database

## Money and dates

- Every amount in the API is an **integer in minor units** (cents). For example, KES 45,000.00 is `4500000`. The web UI converts for you.
- Dates are `YYYY-MM-DD`. Billing months are `YYYY-MM`.
- Each organization has its own currency. AssetNest's subscription prices are in USD.

## API

All endpoints are under `/api` and use JSON.

| Area | Endpoints |
|---|---|
| Pricing | `GET /pricing`, `POST /pricing/quote` |
| Reference | `GET /charge-types` (charge catalog, calculation methods, property and unit types) |
| Organizations | `GET/POST /organizations`, `GET/PATCH /organizations/:id`, `GET /organizations/:id/dashboard` |
| Properties | `GET/POST /properties`, `GET/PATCH /properties/:id` |
| Units | `GET/POST /units`, `GET/PATCH /units/:id` |
| Tenants | `GET/POST /tenants`, `GET/PATCH /tenants/:id`, `GET /tenants/:id/statement` |
| Leases | `GET/POST /leases`, `GET/PATCH /leases/:id`, `POST /leases/:id/terminate` |
| Lease charges | `GET/POST /leases/:id/charges`, `DELETE /leases/:id/charges/:chargeId` |
| Usage data | `GET/POST /meter-readings`, `GET/POST /sales-reports` |
| One-off charges | `GET/POST /one-time-charges` |
| Billing | `POST /billing/run`, `POST /billing/late-fees` |
| Invoices | `GET /invoices`, `GET /invoices/:id`, `POST /invoices/:id/void` |
| Payments | `GET/POST /payments`, `GET /payments/:id` |
| Maintenance | `GET/POST /maintenance`, `GET/PATCH /maintenance/:id` |

List endpoints accept filters as query parameters, e.g. `/invoices?org_id=1&status=open`.

Example: a mall shop lease with a service charge, marketing levy and turnover rent:

```bash
curl -X POST localhost:3000/api/leases -H 'Content-Type: application/json' -d '{
  "unit_id": 2, "tenant_id": 3,
  "start_date": "2026-11-01", "end_date": "2031-10-31",
  "rent_amount": 25000000, "deposit_amount": 50000000,
  "escalation_rate": 7.5, "vat_applicable": true,
  "charges": [
    { "charge_type": "service_charge", "method": "per_area", "rate": 4500 },
    { "charge_type": "marketing_levy", "method": "percent_of_rent", "rate": 2 },
    { "charge_type": "turnover_rent", "method": "turnover", "rate": 8 }
  ]
}'

curl -X POST localhost:3000/api/billing/run -H 'Content-Type: application/json' \
  -d '{ "org_id": 1, "year": 2026, "month": 11 }'
```

## Project layout

```
src/
  config/pricing.js       AssetNest plans, add-ons and fees
  config/chargeTypes.js   Tenant charge catalog, property and unit types
  billing/                Pure billing logic (invoice engine, proration, escalation,
                          allocation, late fees, subscription quotes)
  services/               Database operations and business rules
  routes/api.js           REST API
  db/schema.sql           SQLite schema
  demo.js                 Demo portfolio used by `npm run seed`
public/                   Web dashboard (plain HTML/CSS/JS, no build step)
test/                     node:test suites
docs/PRICING.md           Pricing and charge rules in detail
```

## Not built yet

This is the first working version. Before taking real customers, it still needs:

- **Login and permissions.** There is no authentication yet, so don't expose the server publicly.
- **Payment gateways.** Card and mobile-money payments are recorded and their fees calculated, but no money moves. Integrate a gateway such as Stripe, Flutterwave or M-Pesa Daraja.
- **Billing landlords for their subscription.** Quotes and plan limits work, but there's no checkout for AssetNest's own fees.
- **Plan feature gating.** Plans limit units, properties and pricing, but every feature is currently available on every plan.
- **SMS and email reminders, e-signatures, tenant screening** (priced, not yet integrated).
- **Tenant portal** for tenants to log in, view statements, pay and raise maintenance requests.
- **Billing cycles other than monthly**, deposit refunds at move-out, and withholding tax.
- PDF invoices (the browser's print view works for now).

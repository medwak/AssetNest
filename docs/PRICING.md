# AssetNest pricing and charges

There are two kinds of money in AssetNest:

1. **What landlords pay AssetNest**: subscription plans, add-ons, one-off services and fees on rent collected online.
2. **What tenants pay landlords**: rent and every related charge, invoiced by AssetNest on the landlord's behalf.

All prices live in code so they can be changed in one place:

- [`src/config/pricing.js`](../src/config/pricing.js): plans, add-ons, one-off fees, transaction fees
- [`src/config/chargeTypes.js`](../src/config/chargeTypes.js): tenant charge catalog

The prices below are suggested launch prices in USD. Adjust them to your market before going live.

---

## 1. AssetNest subscription plans

Plans are priced by the number of rentable units under management. A unit can be an apartment, a shop, an office, a kiosk, a parking bay or a billboard.

| | **Starter** | **Growth** | **Business** | **Enterprise** |
|---|---|---|---|---|
| Price / month | Free | $29 | $99 | $399 |
| Units included | 5 | 50 | 200 | 1,000 |
| Extra units | n/a (max 5) | $0.75 each (max 200) | $0.50 each (max 1,000) | $0.30 each (no max) |
| Properties | 2 | Unlimited | Unlimited | Unlimited |
| Team members | 1 | 3 | 10 | Unlimited |
| SMS reminders / month | 0 | 200 | 1,000 | 5,000 |
| Card payment fee | 2.9% + $0.30 | 2.5% + $0.30 | 2.0% + $0.30 | 1.5% + $0.30 |
| Best for | Individual landlords | Residential portfolios | Commercial landlords, office blocks, malls | Large portfolios, management firms |

**Annual billing:** pay for 10 months and get 12 (two months free, about 17% off).

**Plan limits are enforced.** Adding a property or unit beyond the plan's limit returns `402 Payment Required` with an upgrade message. Downgrading to a plan the portfolio no longer fits in is refused.

### Add-ons

| Add-on | Price | Included in |
|---|---|---|
| Extra team member | $5 / user / month | |
| SMS beyond plan allowance | $0.03 / SMS | |
| Lease e-signature | $1 / signed lease | |
| Tenant screening report | $15 / report (can be passed on to applicants) | |
| Premium support (phone, 4-hour response) | $49 / month | Enterprise |
| White-label tenant portal | $79 / month | Enterprise |
| Extra document storage | $5 / 10 GB / month | |

### One-off services

| Service | Price | Included in |
|---|---|---|
| Assisted data migration | $199 | Enterprise |
| Onboarding and staff training (2 hours) | $99 | Enterprise |

### Rent collection fees

These are charged to the landlord on rent paid **through** AssetNest. Payments the landlord records by hand are free.

| Method | Fee |
|---|---|
| Card | Plan rate (2.9% to 1.5%) + $0.30 |
| Mobile money (e.g. M-Pesa) | 1.5% |
| Bank transfer / ACH | $1.00 flat |
| Cash, cheque, manual bank deposit | Free |

Fixed per-transaction fees are in USD. For an organization billing in another currency, only the percentage part is applied until local fee tables are added.

The fee is stored on every payment (`platform_fee`) and totalled on the dashboard.

Get a live quote: `POST /api/pricing/quote` or the calculator on the **Pricing** tab.

---

## 2. Charges landlords bill tenants

### Charge catalog

| Category | Charge types |
|---|---|
| Rent | Rent, turnover (percentage) rent |
| Services | Service charge / CAM, security, garbage, cleaning, parking, internet, storage, signage / advertising space, mall marketing levy, insurance recovery |
| Utilities | Water, electricity, gas |
| Deposits (refundable) | Security deposit, fit-out deposit, utility deposit |
| Penalties | Late payment fee, bounced payment fee |
| Fees | Application / screening, legal fees and stamp duty, move-in, move-out / exit cleaning, keys / access cards, maintenance recharges, other |

### How recurring charges are calculated

Each recurring charge on a lease uses one of these methods:

| Method | Calculation | Typical use |
|---|---|---|
| `fixed` | Fixed amount per month | Garbage, parking, internet |
| `per_area` | Rate × unit area (sq ft or m²) per month | Service charge in malls and offices |
| `percent_of_rent` | % of current monthly rent | Marketing levy |
| `metered` | (current − previous reading) × rate | Water, electricity, gas |
| `turnover` | % of tenant's gross sales | Percentage rent in malls |

### Billing rules

- **Monthly invoices.** `POST /api/billing/run` creates one invoice per lease per month. Running it again skips leases already invoiced.
- **Proration.** In a move-in or move-out month, rent and `fixed` / `per_area` / `percent_of_rent` charges are prorated by days occupied. Set `prorate: 0` on a charge to always bill it in full.
- **Rent escalation.** `escalation_rate` % compounds every `escalation_interval_months` (default 12) from the lease start.
- **Deposit.** Billed on the lease's first invoice, without VAT.
- **Metered utilities.** Readings are recorded against the billing month they are invoiced in.
- **Turnover rent** is billed in arrears on the previous month's sales report.
  - With a `breakpoint`: rate % × (sales − breakpoint).
  - Without one (a natural breakpoint): the tenant pays the higher of base rent or rate % × sales, so only the excess over base rent is invoiced.
- **VAT.** The organization sets `vat_rate`. VAT is added only on leases marked `vat_applicable` (commercial leases usually are, residential usually are not), and only on charge types that are taxable. A lease charge can override taxability.
- **Late fees.** The organization sets `late_fee_type` (`none`, `flat` or `percent` of the overdue balance), `late_fee_value` and `late_fee_grace_days`. `POST /api/billing/late-fees` adds one late fee per overdue invoice, billed on the next invoice.
- **One-off charges** (key replacement, legal fees, a late fee, a repair) are added to the next invoice.
- **Maintenance recharges.** Completing a maintenance request marked `recharge_to_tenant` bills its cost to the tenant.
- **Payments** are applied to the tenant's oldest unpaid invoice first. Overpayments are held as credit and applied automatically to the next invoice.

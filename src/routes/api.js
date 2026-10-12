import { Router } from 'express';

import { CHARGE_TYPES, METHODS, PROPERTY_TYPES, UNIT_TYPES } from '../config/chargeTypes.js';
import {
  ADDONS,
  ANNUAL_MONTHS_CHARGED,
  ONE_TIME_FEES,
  PLANS,
  PRICING_CURRENCY,
  TRANSACTION_FEES,
} from '../config/pricing.js';
import { quoteSubscription, recommendPlan } from '../billing/subscription.js';
import { badRequest } from '../services/crud.js';
import {
  leaseCharges,
  leases,
  maintenance,
  meterReadings,
  oneTimeCharges,
  organizations,
  properties,
  salesReports,
  tenants,
  units,
} from '../services/portfolio.js';
import {
  assessLateFees,
  dashboard,
  invoices,
  payments,
  runBilling,
  tenantStatement,
} from '../services/billing.js';

// Standard list / get / create / update routes for a service.
function resource(router, path, service) {
  router.get(path, (req, res) => res.json(service.list(req.db, req.query)));
  router.get(`${path}/:id`, (req, res) => res.json(service.get(req.db, req.params.id)));
  router.post(path, (req, res) => res.status(201).json(service.create(req.db, req.body)));
  router.patch(`${path}/:id`, (req, res) => res.json(service.update(req.db, req.params.id, req.body)));
}

export function apiRouter() {
  const r = Router();

  // ------------------------------------------------------------ reference data
  r.get('/pricing', (_req, res) =>
    res.json({
      currency: PRICING_CURRENCY,
      annual_months_charged: ANNUAL_MONTHS_CHARGED,
      plans: PLANS,
      addons: ADDONS,
      one_time_fees: ONE_TIME_FEES,
      transaction_fees: TRANSACTION_FEES,
    }));
  r.post('/pricing/quote', (req, res) => {
    const body = { ...req.body };
    body.plan ??= recommendPlan(body.units ?? 0);
    try {
      res.json(quoteSubscription(body));
    } catch (err) {
      throw badRequest(err.message);
    }
  });
  r.get('/charge-types', (_req, res) =>
    res.json({ charge_types: CHARGE_TYPES, methods: METHODS, property_types: PROPERTY_TYPES, unit_types: UNIT_TYPES }));

  // ------------------------------------------------------------ portfolio
  resource(r, '/organizations', organizations);
  r.get('/organizations/:id/dashboard', (req, res) => res.json(dashboard(req.db, req.params.id, req.query.as_of)));
  resource(r, '/properties', properties);
  resource(r, '/units', units);
  resource(r, '/tenants', tenants);
  r.get('/tenants/:id/statement', (req, res) => res.json(tenantStatement(req.db, req.params.id)));

  resource(r, '/leases', leases);
  r.post('/leases/:id/terminate', (req, res) => res.json(leases.terminate(req.db, req.params.id, req.body)));
  r.get('/leases/:id/charges', (req, res) => res.json(leaseCharges.list(req.db, req.params.id)));
  r.post('/leases/:id/charges', (req, res) => res.status(201).json(leaseCharges.create(req.db, req.params.id, req.body)));
  r.delete('/leases/:id/charges/:chargeId', (req, res) => {
    leaseCharges.remove(req.db, req.params.id, req.params.chargeId);
    res.status(204).end();
  });

  r.get('/meter-readings', (req, res) => res.json(meterReadings.list(req.db, req.query)));
  r.post('/meter-readings', (req, res) => res.status(201).json(meterReadings.create(req.db, req.body)));
  r.get('/sales-reports', (req, res) => res.json(salesReports.list(req.db, req.query)));
  r.post('/sales-reports', (req, res) => res.status(201).json(salesReports.create(req.db, req.body)));
  r.get('/one-time-charges', (req, res) => res.json(oneTimeCharges.list(req.db, req.query)));
  r.post('/one-time-charges', (req, res) => res.status(201).json(oneTimeCharges.create(req.db, req.body)));
  resource(r, '/maintenance', maintenance);

  // ------------------------------------------------------------ billing
  r.post('/billing/run', (req, res) => res.json(runBilling(req.db, req.body)));
  r.post('/billing/late-fees', (req, res) => res.json(assessLateFees(req.db, req.body)));
  r.get('/invoices', (req, res) => res.json(invoices.list(req.db, req.query)));
  r.get('/invoices/:id', (req, res) => res.json(invoices.get(req.db, req.params.id)));
  r.post('/invoices/:id/void', (req, res) => res.json(invoices.void(req.db, req.params.id)));
  r.get('/payments', (req, res) => res.json(payments.list(req.db, req.query)));
  r.get('/payments/:id', (req, res) => res.json(payments.get(req.db, req.params.id)));
  r.post('/payments', (req, res) => res.status(201).json(payments.record(req.db, req.body)));

  return r;
}

// Quotes what a landlord pays AssetNest, and the fee on each online payment.

import {
  ADDONS,
  ANNUAL_MONTHS_CHARGED,
  ONE_TIME_FEES,
  PLANS,
  PRICING_CURRENCY,
  TRANSACTION_FEES,
} from '../config/pricing.js';
import { percentOf, sum } from './money.js';

export function getPlan(code) {
  const plan = PLANS[code];
  if (!plan) throw new Error(`Unknown plan "${code}". Choose one of: ${Object.keys(PLANS).join(', ')}`);
  return plan;
}

// The cheapest plan that can hold this many units.
export function recommendPlan(units) {
  const fits = Object.entries(PLANS).filter(([, p]) => p.maxUnits == null || units <= p.maxUnits);
  let best = null;
  for (const [code] of fits) {
    const q = quoteSubscription({ plan: code, units });
    if (!best || q.monthlyEquivalent < best.monthlyEquivalent) best = { code, ...q };
  }
  return best.code;
}

function includedIn(item, planCode) {
  return item.includedIn?.includes(planCode) ?? false;
}

/**
 * @param {object} input
 * @param {string} input.plan
 * @param {number} input.units          rentable units under management
 * @param {'monthly'|'annual'} [input.cycle]
 * @param {number} [input.users]        team members needing a login
 * @param {number} [input.smsPerMonth]
 * @param {number} [input.storageBlocks] extra 10 GB blocks
 * @param {boolean} [input.premiumSupport]
 * @param {boolean} [input.whiteLabel]
 * @param {number} [input.eSignatures]  per month
 * @param {number} [input.screenings]   per month
 * @param {boolean} [input.dataMigration]   one-off
 * @param {boolean} [input.onboardingTraining] one-off
 */
export function quoteSubscription(input) {
  const {
    plan: planCode,
    units = 0,
    cycle = 'monthly',
    users = 1,
    smsPerMonth = 0,
    storageBlocks = 0,
    premiumSupport = false,
    whiteLabel = false,
    eSignatures = 0,
    screenings = 0,
    dataMigration = false,
    onboardingTraining = false,
  } = input;
  const plan = getPlan(planCode);
  if (!['monthly', 'annual'].includes(cycle)) throw new Error('cycle must be "monthly" or "annual"');

  const warnings = [];
  const lines = [];
  const add = (description, quantity, unitPrice) => {
    if (quantity > 0) lines.push({ description, quantity, unit_price: unitPrice, amount: quantity * unitPrice });
  };

  if (plan.maxUnits != null && units > plan.maxUnits) {
    warnings.push(
      `${plan.name} allows up to ${plan.maxUnits} units; ${units} needs the ${PLANS[recommendPlan(units)].name} plan.`,
    );
  }

  lines.push({
    description: `${plan.name} plan (includes ${plan.includedUnits} units)`,
    quantity: 1,
    unit_price: plan.monthlyPrice,
    amount: plan.monthlyPrice,
  });

  const extraUnits = Math.max(0, units - plan.includedUnits);
  if (extraUnits > 0 && plan.extraUnitPrice != null) {
    add('Additional units', extraUnits, plan.extraUnitPrice);
  }

  if (plan.includedUsers != null) {
    add(ADDONS.extraUser.name, Math.max(0, users - plan.includedUsers), ADDONS.extraUser.price);
  }
  add(ADDONS.sms.name, Math.max(0, smsPerMonth - plan.includedSms), ADDONS.sms.price);
  add(ADDONS.storage.name, storageBlocks, ADDONS.storage.price);
  if (premiumSupport && !includedIn(ADDONS.premiumSupport, planCode)) {
    add(ADDONS.premiumSupport.name, 1, ADDONS.premiumSupport.price);
  }
  if (whiteLabel && !includedIn(ADDONS.whiteLabel, planCode)) {
    add(ADDONS.whiteLabel.name, 1, ADDONS.whiteLabel.price);
  }
  add(ADDONS.eSignature.name, eSignatures, ADDONS.eSignature.price);
  add(ADDONS.tenantScreening.name, screenings, ADDONS.tenantScreening.price);

  const monthlyTotal = sum(lines.map((l) => l.amount));
  const recurringTotal = cycle === 'annual' ? monthlyTotal * ANNUAL_MONTHS_CHARGED : monthlyTotal;

  const oneTime = [];
  for (const [key, wanted] of [['dataMigration', dataMigration], ['onboardingTraining', onboardingTraining]]) {
    if (!wanted) continue;
    const fee = ONE_TIME_FEES[key];
    const price = includedIn(fee, planCode) ? 0 : fee.price;
    oneTime.push({ description: fee.name, quantity: 1, unit_price: price, amount: price });
  }
  const oneTimeTotal = sum(oneTime.map((l) => l.amount));

  return {
    currency: PRICING_CURRENCY,
    plan: planCode,
    cycle,
    lines,
    monthlyTotal,
    recurringTotal,
    annualSavings: cycle === 'annual' ? monthlyTotal * 12 - recurringTotal : 0,
    monthlyEquivalent: cycle === 'annual' ? Math.round(recurringTotal / 12) : monthlyTotal,
    oneTime,
    oneTimeTotal,
    dueToday: recurringTotal + oneTimeTotal,
    onlinePaymentFeePercent: plan.onlinePaymentFeePercent,
    warnings,
  };
}

// Fee AssetNest keeps from a tenant payment made through the platform.
// Fixed per-transaction fees are priced in PRICING_CURRENCY, so callers
// billing in another currency pass includeFixed: false.
export function platformFee(planCode, method, amount, { includeFixed = true } = {}) {
  const fee = TRANSACTION_FEES[method];
  if (!fee) throw new Error(`Unknown payment method "${method}"`);
  const percent = fee.usesPlanPercent ? getPlan(planCode).onlinePaymentFeePercent : fee.percent;
  return percentOf(amount, percent) + (includeFixed ? fee.fixed : 0);
}

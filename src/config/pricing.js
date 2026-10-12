// AssetNest subscription pricing: what landlords pay to use the software.
//
// All amounts are integers in minor units (cents) of PRICING_CURRENCY.
// These are launch prices; change them here and every quote, the pricing
// page and the API pick them up.

export const PRICING_CURRENCY = 'USD';

// Annual billing charges 10 months for 12 (two months free).
export const ANNUAL_MONTHS_CHARGED = 10;

export const PLANS = {
  starter: {
    name: 'Starter',
    tagline: 'For individual landlords getting organised.',
    monthlyPrice: 0,
    includedUnits: 5,
    extraUnitPrice: null, // no extra units: upgrade instead
    maxUnits: 5,
    maxProperties: 2,
    includedUsers: 1,
    includedSms: 0,
    onlinePaymentFeePercent: 2.9,
    features: [
      'Properties, units, tenants and leases',
      'Automatic monthly rent invoicing',
      'Manual payment recording (cash, bank, cheque)',
      'Tenant statements',
      'Maintenance requests',
    ],
  },
  growth: {
    name: 'Growth',
    tagline: 'For growing residential portfolios.',
    monthlyPrice: 2900,
    includedUnits: 50,
    extraUnitPrice: 75,
    maxUnits: 200,
    maxProperties: null,
    includedUsers: 3,
    includedSms: 200,
    onlinePaymentFeePercent: 2.5,
    features: [
      'Everything in Starter',
      'Online rent collection (card, mobile money, bank)',
      'Recurring charges: service charge, utilities, parking, etc.',
      'Metered utility billing from meter readings',
      'Automatic late fees and VAT',
      'SMS and email rent reminders',
    ],
  },
  business: {
    name: 'Business',
    tagline: 'For commercial landlords, office blocks and malls.',
    monthlyPrice: 9900,
    includedUnits: 200,
    extraUnitPrice: 50,
    maxUnits: 1000,
    maxProperties: null,
    includedUsers: 10,
    includedSms: 1000,
    onlinePaymentFeePercent: 2.0,
    features: [
      'Everything in Growth',
      'Turnover (percentage) rent from tenant sales reports',
      'Service charge per area (sq ft / m²)',
      'Rent escalation schedules',
      'Maintenance cost recharges to tenants',
      'API access',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    tagline: 'For large portfolios and property management firms.',
    monthlyPrice: 39900,
    includedUnits: 1000,
    extraUnitPrice: 30,
    maxUnits: null,
    maxProperties: null,
    includedUsers: null, // unlimited
    includedSms: 5000,
    onlinePaymentFeePercent: 1.5,
    features: [
      'Everything in Business',
      'Unlimited users',
      'White-label tenant portal included',
      'Premium support included',
      'Free data migration',
      'Custom integrations',
    ],
  },
};

// Optional extras on top of a plan.
export const ADDONS = {
  extraUser: {
    name: 'Extra team member',
    unit: 'user / month',
    price: 500,
  },
  sms: {
    name: 'SMS reminders beyond plan allowance',
    unit: 'SMS',
    price: 3,
  },
  eSignature: {
    name: 'Lease e-signature',
    unit: 'signed lease',
    price: 100,
  },
  tenantScreening: {
    name: 'Tenant screening report',
    unit: 'report',
    price: 1500,
    note: 'Can be passed on to the applicant as an application fee.',
  },
  premiumSupport: {
    name: 'Premium support (phone, 4-hour response)',
    unit: 'month',
    price: 4900,
    includedIn: ['enterprise'],
  },
  whiteLabel: {
    name: 'White-label tenant portal (your logo and domain)',
    unit: 'month',
    price: 7900,
    includedIn: ['enterprise'],
  },
  storage: {
    name: 'Extra document storage',
    unit: '10 GB / month',
    price: 500,
  },
};

// One-off charges.
export const ONE_TIME_FEES = {
  dataMigration: {
    name: 'Assisted data migration from spreadsheets or another system',
    price: 19900,
    includedIn: ['enterprise'],
  },
  onboardingTraining: {
    name: 'Live onboarding and staff training session (2 hours)',
    price: 9900,
    includedIn: ['enterprise'],
  },
};

// Fees on rent collected through AssetNest. Charged to the landlord and
// deducted from the payout. Manually recorded payments are free.
export const TRANSACTION_FEES = {
  card: { name: 'Card', percent: null, fixed: 30, usesPlanPercent: true },
  mobile_money: { name: 'Mobile money', percent: 1.5, fixed: 0 },
  bank_transfer: { name: 'Bank transfer / ACH', percent: 0, fixed: 100 },
  cash: { name: 'Cash (recorded manually)', percent: 0, fixed: 0 },
  cheque: { name: 'Cheque (recorded manually)', percent: 0, fixed: 0 },
  manual_bank: { name: 'Bank deposit (recorded manually)', percent: 0, fixed: 0 },
};

export const PAYMENT_METHODS = Object.keys(TRANSACTION_FEES);

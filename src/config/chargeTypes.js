// Every kind of charge a landlord can bill a tenant.
//
// taxable:   default for whether VAT applies. VAT is only added when the
//            lease itself is marked vat_applicable (commercial leases usually
//            are, residential usually are not), and a lease charge can
//            override this default.
// refundable: held on the tenant's behalf and returned at move-out.
// defaultMethod: how the amount is usually calculated (see METHODS).

export const CHARGE_TYPES = {
  rent: { name: 'Rent', category: 'rent', taxable: true },
  turnover_rent: {
    name: 'Turnover (percentage) rent',
    category: 'rent',
    taxable: true,
    defaultMethod: 'turnover',
  },

  service_charge: {
    name: 'Service charge / common area maintenance',
    category: 'service',
    taxable: true,
    defaultMethod: 'per_area',
  },
  security_fee: { name: 'Security services', category: 'service', taxable: true },
  garbage: { name: 'Garbage collection', category: 'service', taxable: true },
  cleaning: { name: 'Cleaning', category: 'service', taxable: true },
  parking: { name: 'Parking', category: 'service', taxable: true },
  internet: { name: 'Internet', category: 'service', taxable: true },
  storage: { name: 'Storage space', category: 'service', taxable: true },
  signage: {
    name: 'Signage / advertising space',
    category: 'service',
    taxable: true,
  },
  marketing_levy: {
    name: 'Marketing levy (mall promotions fund)',
    category: 'service',
    taxable: true,
    defaultMethod: 'percent_of_rent',
  },
  insurance: { name: 'Building insurance recovery', category: 'service', taxable: false },

  water: { name: 'Water', category: 'utility', taxable: false, defaultMethod: 'metered' },
  electricity: {
    name: 'Electricity',
    category: 'utility',
    taxable: true,
    defaultMethod: 'metered',
  },
  gas: { name: 'Gas', category: 'utility', taxable: true, defaultMethod: 'metered' },

  security_deposit: {
    name: 'Security deposit',
    category: 'deposit',
    taxable: false,
    refundable: true,
  },
  fit_out_deposit: {
    name: 'Fit-out / renovation deposit',
    category: 'deposit',
    taxable: false,
    refundable: true,
  },
  utility_deposit: {
    name: 'Utility deposit',
    category: 'deposit',
    taxable: false,
    refundable: true,
  },

  late_fee: { name: 'Late payment fee', category: 'penalty', taxable: false },
  bounced_payment_fee: {
    name: 'Bounced payment fee',
    category: 'penalty',
    taxable: false,
  },

  application_fee: { name: 'Application / screening fee', category: 'fee', taxable: false },
  legal_fee: {
    name: 'Lease preparation / legal fees and stamp duty',
    category: 'fee',
    taxable: true,
  },
  move_in_fee: { name: 'Move-in fee', category: 'fee', taxable: true },
  move_out_fee: { name: 'Move-out / exit cleaning fee', category: 'fee', taxable: true },
  key_card: { name: 'Keys / access cards', category: 'fee', taxable: true },
  maintenance_recharge: {
    name: 'Maintenance and repairs recharge',
    category: 'fee',
    taxable: true,
  },
  other: { name: 'Other charge', category: 'fee', taxable: true },
};

// How a recurring lease charge is calculated each month.
export const METHODS = {
  fixed: 'Fixed amount per month (amount)',
  per_area: 'Rate per sq ft / m² of the unit per month (rate x unit area)',
  percent_of_rent: 'Percentage of the current monthly rent (rate %)',
  metered: 'Consumption from meter readings x rate per unit',
  turnover: 'Percentage of reported gross sales (rate %), above a breakpoint',
};

export const PROPERTY_TYPES = [
  'apartment_building',
  'single_family',
  'office_building',
  'shopping_mall',
  'retail_strip',
  'warehouse',
  'industrial',
  'mixed_use',
  'student_housing',
  'hotel_serviced_apartments',
  'land',
  'other',
];

export const UNIT_TYPES = [
  'apartment',
  'studio',
  'house',
  'room',
  'office',
  'shop',
  'kiosk',
  'stall',
  'restaurant',
  'warehouse_bay',
  'parking_bay',
  'billboard',
  'land_plot',
  'other',
];

export function isChargeType(code) {
  return Object.hasOwn(CHARGE_TYPES, code);
}

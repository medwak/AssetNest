// Money is always an integer number of minor units (cents). Rounding happens
// once per calculated line, half away from zero.

export function round(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function percentOf(amount, percent) {
  return round((amount * percent) / 100);
}

export function sum(values) {
  return values.reduce((total, v) => total + v, 0);
}

export function assertMinor(value, field) {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer amount in minor units (e.g. cents)`);
  }
  return value;
}

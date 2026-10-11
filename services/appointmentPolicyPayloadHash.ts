import crypto from 'crypto';

const stableValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result: any, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
};

export const payloadHash = (value: any) =>
  crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');

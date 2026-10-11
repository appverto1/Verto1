import crypto from 'crypto';

const stableValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((acc: any, key) => {
    if (value[key] !== undefined) acc[key] = stableValue(value[key]);
    return acc;
  }, {});
  return value;
};
export const payloadHash = (payload: any) => crypto.createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex');

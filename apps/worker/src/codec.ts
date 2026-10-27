// JSON for engine results, which hold Maps (a progression's players by id): they travel as
// { "$map": [[key, value], …] } and are rebuilt on arrival.

export const encode = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v instanceof Map ? { $map: [...v.entries()] } : v instanceof Set ? { $set: [...v] } : v,
  );
export const decode = (text: string): unknown =>
  JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$map') return new Map((v as { $map: [] }).$map);
      if (keys.length === 1 && keys[0] === '$set') return new Set((v as { $set: [] }).$set);
    }
    return v;
  });

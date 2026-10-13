// seeded random (mulberry32) so a run can be repeated from its seed
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    normal: () => {
      const u = Math.max(next(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    // pick a key from {key: weight}
    weighted: (weights) => {
      let total = 0;
      for (const k in weights) total += weights[k];
      let r = next() * total;
      for (const k in weights) {
        r -= weights[k];
        if (r <= 0) return k;
      }
      return Object.keys(weights).pop();
    },
  };
}

module.exports = { makeRng };

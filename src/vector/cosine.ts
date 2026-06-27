/** 向量基础运算：归一化 + 点积（向量归一化后点积即余弦相似度） */

export function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

/** 已归一化向量的点积 = 余弦相似度 */
export function dot(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < len; i++) s += a[i]! * b[i]!;
  return s;
}

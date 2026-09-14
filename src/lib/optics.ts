// 屈光度 / 轴位 / 瞳距的原文解析与球柱镜转写规则
//
// 支持的抄录写法（中老年配镜场景常见，含不规范写法）：
//   -1.25  +2.00  0.00  -025  +200   → 按 0.01D 解析
//   -1.25DS / -1.25 D.S. / -1,25     → 去掉单位与千分位逗号
//   180 / 5 / 005 / 175°             → 轴位（0–180）
//   pl / PL / plano / 平光            → 0
//   32 / 32.5 / 62mm                  → 瞳距 mm

import type { TransForm, TransStep } from '../types';

export interface ParsedPower {
  /** 规范屈光度（D），如 -1.25；平光为 0 */
  diopters: number;
  /** 是否平光写法（plano） */
  plano: boolean;
  /** 原始记号的正负柱镜形式无法从单值判断，该字段留给配对比较使用 */
}

function normalizeRaw(raw: string): string {
  return raw
    .trim()
    .replace(/[，]/g, ',')
    .replace(/[°º]/g, '')
    .replace(/\s+/g, '');
}

const PLANO_RE = /^(pl|plano|平光|∞|inf)$/i;

/**
 * 解析屈光度原文。
 * @returns 数值（D）或 null（看不清 / 未提供 / 无法识别时不得猜值）
 */
export function parsePower(raw: string): number | null {
  const s = normalizeRaw(raw);
  if (!s) return null;
  if (PLANO_RE.test(s)) return 0;

  // 去掉 DS / D / SPH / CYL / ADD 等单位后缀
  let body = s
    .replace(/(?:\.?0+)?(?:ds|d\.s\.?|d|sph|cyl|add)\.?$/i, '')
    .replace(/[×x](\d{1,3})$/, ''); // "-1.25×180" 中的轴位部分不属于球镜
  // 处理形如 -1.25/-0.50×180 的整串抄录时只取第一段
  body = body.split(/[\/／]/)[0];

  // 纯 3 位整数且无小数点：按眼镜行业惯例视作百分位 D，如 +200 = +2.00D、-025 = -0.25D；
  // 老花镜包装上无符号的“175”按 +1.75D 处理（该解析器仅用于球/柱/ADD 字段，轴位字段走 parseAxis）。
  let m = body.match(/^([+-]?)(\d{3})$/);
  if (m) {
    const v = parseInt(m[2], 10) / 100;
    return m[1] === '-' ? -v : v;
  }

  // 形如 -25 / +50 的 1–2 位整数带符号：按百分位 D；无符号的 1–2 位整数（如 90）无法区分
  // 是 0.90D 还是轴位，不做猜测，要求用户照写 +090 / +0.90
  m = body.match(/^([+-])(\d{1,2})$/);
  if (m) {
    const v = parseInt(m[2], 10) / 100;
    return m[1] === '-' ? -v : v;
  }

  // 无符号 1–2 位纯数字：拒绝猜测
  if (/^\d{1,2}$/.test(body)) return null;

  const num = Number(body.replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  // 限制在合理范围内，避免把轴位 175 误当 +1.75D（无符号、大于 20 的数不视为屈光度）
  if (Math.abs(num) > 30) return null;
  return roundQ(num);
}

/** 是否为平光写法 */
export function isPlano(raw: string): boolean {
  return PLANO_RE.test(normalizeRaw(raw));
}

/**
 * 解析轴位（0–180 的整数）。
 * 支持 180、005、5、175° 等写法；超出 0–180 或含小数的一律视为无法识别。
 */
export function parseAxis(raw: string): number | null {
  const s = normalizeRaw(raw).replace(/[^0-9.]/g, '');
  if (!s) return null;
  if (!/^\d{1,3}(\.0+)?$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (n < 0 || n > 180) return null;
  return n === 0 ? 180 : n; // 0° 与 180° 同一轴位
}

/** 解析瞳距（mm，允许 20–90，可带一位小数） */
export function parsePd(raw: string): number | null {
  const s = normalizeRaw(raw).toLowerCase().replace(/mm|pd|瞳距?/g, '');
  const num = Number(s.replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  if (num < 20 || num > 90) return null;
  return Math.round(num * 10) / 10;
}

/** 屈光度量化到 0.25D 档（展示差值时用） */
export function roundQ(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 按 0.25D 档对齐误差，避免浮点噪声 */
export function diffPower(a: number, b: number): number {
  return roundQ(Math.abs(roundQ(a) - roundQ(b)));
}

/**
 * 轴位按 180° 周期比较的环形差值（结果落在 0–90 度）。
 * 轴位 0 与 180 等价，例如 5 与 175 的环形差为 10°。
 */
export function diffAxis(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return d > 90 ? 180 - d : d;
}

export function diffPd(a: number, b: number): number {
  return Math.abs(Math.round(a * 10) - Math.round(b * 10)) / 10;
}

/* ---------- 球柱镜转写（负柱镜 ⇄ 正柱镜） ---------- */

export interface SphCylAxis {
  sph: number;
  cyl: number;
  axis: number;
  form: TransForm | null;
}

/**
 * 球柱镜转写：代数和 / 变号 / 轴位转 90°。
 * 规则：
 *   新球镜 SPH' = SPH + CYL
 *   新柱镜 CYL' = -CYL
 *   新轴位 AXIS' = AXIS ± 90°（保持在 1–180）
 */
export function transpose(lens: { sph: number; cyl: number; axis: number }): SphCylAxis {
  const sph = roundQ(lens.sph + lens.cyl);
  const cyl = roundQ(-lens.cyl);
  let axis = lens.axis + 90;
  if (axis > 180) axis -= 180;
  if (axis === 0) axis = 180;
  return { sph, cyl, axis, form: lens.cyl < 0 ? 'positive' : 'negative' };
}

/** 生成逐步转写依据，供页面展示 */
export function transposeSteps(input: {
  sph: number;
  cyl: number;
  axis: number;
}): { result: SphCylAxis; steps: TransStep[] } {
  const result = transpose(input);
  const targetName = input.cyl < 0 ? '正柱镜' : '负柱镜';
  const steps: TransStep[] = [
    {
      label: '第 1 步 · 球镜相加',
      detail: `新球镜 = 原球镜 + 原柱镜 = ${fmtD(input.sph)} + (${fmtD(input.cyl)}) = ${fmtD(result.sph)}`,
    },
    {
      label: '第 2 步 · 柱镜变号',
      detail: `新柱镜 = -原柱镜 = -(${fmtD(input.cyl)}) = ${fmtD(result.cyl)}`,
    },
    {
      label: '第 3 步 · 轴位转 90°',
      detail: `新轴位 = 原轴位 ${input.axis}° ± 90° = ${result.axis}°（轴位按 180° 周期，0° 即 180°）`,
    },
    {
      label: `完成 · 等价的${targetName}记法`,
      detail: `转写后为 SPH ${fmtD(result.sph)} / CYL ${fmtD(result.cyl)} × ${result.axis}°`,
    },
  ];
  return { result, steps };
}

/** 屈光度格式化：+2.00 / -1.25 / 0.00（平光写 PL） */
export function fmtD(v: number | null): string {
  if (v === null) return '—';
  if (v === 0) return 'PL（0.00）';
  const s = v.toFixed(2);
  return v > 0 ? `+${s}` : s;
}

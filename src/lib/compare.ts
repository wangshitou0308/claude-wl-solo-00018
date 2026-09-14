// 三来源逐项核对引擎
//
// 重要原则：
//  1. 缺失 / 看不清的字段一律不参与判定，绝不用缺失值“补齐”一致结论；
//  2. 球镜 SPH、柱镜 CYL、轴位 AXIS 作为一个球柱镜组联合比较，
//     自动识别负柱镜与正柱镜的等价记法（转写后比较）；
//  3. 轴位按 180° 周期比较；
//  4. 本侧不符、交叉（左右对调）后相符时，给出“疑似左右互换”，仍由用户确认。

import type {
  Eye,
  EyeFieldKey,
  EyeRecord,
  FieldResult,
  FieldStatus,
  FieldValue,
  MatchVerdict,
  PairCompareResult,
  PdDeriveCheck,
  SourceDocument,
  SourceId,
  Tolerance,
  TransStep,
} from '../types';
import {
  diffAxis,
  diffPd,
  diffPower,
  fmtD,
  parseAxis,
  parsePd,
  parsePower,
  roundQ,
  transposeSteps,
} from './optics';

export const EYE_FIELDS: { key: EyeFieldKey; label: string; unit: string }[] = [
  { key: 'sph', label: '球镜 SPH', unit: 'D' },
  { key: 'cyl', label: '柱镜 CYL', unit: 'D' },
  { key: 'axis', label: '轴位 AXIS', unit: '°' },
  { key: 'add', label: '下加光 ADD', unit: 'D' },
  { key: 'pdMonocular', label: '单眼瞳距 PD', unit: 'mm' },
];

export const FIELD_LABEL: Record<EyeFieldKey | 'pdBinocular', string> = {
  sph: '球镜 SPH',
  cyl: '柱镜 CYL',
  axis: '轴位 AXIS',
  add: '下加光 ADD',
  pdMonocular: '单眼瞳距',
  pdBinocular: '双眼瞳距',
};

const emptyField = (): FieldValue => ({ raw: '', status: 'provided' });

export function emptyEyeRecord(): EyeRecord {
  return {
    sph: emptyField(),
    cyl: emptyField(),
    axis: emptyField(),
    add: emptyField(),
    pdMonocular: emptyField(),
  };
}

export function emptySourceDocument(id: SourceId): SourceDocument {
  return {
    id,
    note: '',
    pdBinocular: emptyField(),
    OD: emptyEyeRecord(),
    OS: emptyEyeRecord(),
  };
}

/* ------------------------------------------------------------------ */
/* 单字段比较（用于 ADD、瞳距等独立字段，以及资料不全时的逐字段比较） */
/* ------------------------------------------------------------------ */

interface SimpleCompareOpts {
  kind: 'power' | 'axis' | 'pd';
  tol: number;
}

function unknownResult(
  key: FieldResult['key'],
  a: FieldValue,
  b: FieldValue,
  reason: string,
  canonA: string = '—',
  canonB: string = '—',
): FieldResult {
  return {
    key,
    statusA: a.status,
    statusB: b.status,
    rawA: a.raw,
    rawB: b.raw,
    canonA,
    canonB,
    verdict: 'unknown',
    reason,
    diff: null,
  };
}

function compareSimple(
  key: FieldResult['key'],
  a: FieldValue,
  b: FieldValue,
  opts: SimpleCompareOpts,
): FieldResult {
  if (a.status !== 'provided' || b.status !== 'provided') {
    const note = (v: FieldValue) =>
      v.status === 'unreadable' ? '看不清' : v.status === 'missing' ? '未提供' : '空白';
    return unknownResult(
      key,
      a,
      b,
      `一侧“${note(a)}”、另一侧“${note(b)}”，不做一致或不符的判定`,
    );
  }

  const parse = opts.kind === 'power' ? parsePower : opts.kind === 'axis' ? parseAxis : parsePd;
  const va = parse(a.raw);
  const vb = parse(b.raw);
  const fmt = (v: number | null) =>
    v === null ? '无法识别' : opts.kind === 'power' ? fmtD(v) : opts.kind === 'axis' ? `${v}°` : `${v} mm`;

  if (va === null || vb === null) {
    return unknownResult(key, a, b, '原文无法识别为数值，请重新核对抄录', fmt(va), fmt(vb));
  }

  const diff =
    opts.kind === 'power' ? diffPower(va, vb) : opts.kind === 'axis' ? diffAxis(va, vb) : diffPd(va, vb);

  if (diff <= opts.tol + 1e-9) {
    return {
      key,
      statusA: a.status,
      statusB: b.status,
      rawA: a.raw,
      rawB: b.raw,
      canonA: fmt(va),
      canonB: fmt(vb),
      verdict: 'match',
      reason:
        diff === 0
          ? opts.kind === 'axis'
            ? '轴位按 180° 周期比较，一致'
            : '数值一致'
          : `相差 ${opts.kind === 'pd' ? diff.toFixed(1) : diff.toFixed(2)}${opts.kind === 'axis' ? '°' : opts.kind === 'pd' ? ' mm' : 'D'}，在允许差值 ${opts.tol} 以内`,
      diff,
    };
  }

  return {
    key,
    statusA: a.status,
    statusB: b.status,
    rawA: a.raw,
    rawB: b.raw,
    canonA: fmt(va),
    canonB: fmt(vb),
    verdict: 'mismatch',
    reason: `相差 ${opts.kind === 'pd' ? diff.toFixed(1) : diff.toFixed(2)}${opts.kind === 'axis' ? '°' : opts.kind === 'pd' ? ' mm' : 'D'}，超出允许差值 ${opts.tol}`,
    diff,
  };
}

/* ------------------------------------------------------------------ */
/* 球柱镜组（SPH / CYL / AXIS）联合比较，含正负柱镜转写识别            */
/* ------------------------------------------------------------------ */

type SCFieldKey = 'sph' | 'cyl' | 'axis';

interface SCGroup {
  results: Record<SCFieldKey, FieldResult>;
  /** 球柱镜组的整体判定 */
  verdict: MatchVerdict;
  /** 若通过转写达成一致，附带逐步依据 */
  transSteps: TransStep[] | null;
  /** 转写方向说明，例如“处方为负柱镜记法、镜袋为正柱镜记法” */
  transNote: string;
}

function scUnknownFields(
  a: EyeRecord,
  b: EyeRecord,
  reason: string,
  partial?: Partial<Record<SCFieldKey, FieldResult>>,
): SCGroup {
  const mk = (key: SCFieldKey): FieldResult =>
    partial?.[key] ??
    unknownResult(key, a[key], b[key], reason);
  return {
    results: { sph: mk('sph'), cyl: mk('cyl'), axis: mk('axis') },
    verdict: 'unknown',
    transSteps: null,
    transNote: '',
  };
}

function compareSpheroCylinder(a: EyeRecord, b: EyeRecord, tol: Tolerance): SCGroup {
  const keys: SCFieldKey[] = ['sph', 'cyl', 'axis'];

  // 任何一侧的任一字段不是“已提供”，整组不做联合判定（缺失值不补齐结论）
  for (const k of keys) {
    if (a[k].status !== 'provided' || b[k].status !== 'provided') {
      const note = (s: FieldStatus) => (s === 'unreadable' ? '看不清' : s === 'missing' ? '未提供' : '空白');
      return scUnknownFields(
        a,
        b,
        `字段一侧为“${note(a[k].status)}”、另一侧为“${note(b[k].status)}”，球柱镜组不做判定`,
      );
    }
  }

  // CYL 平光 / 留空按 0 处理（无散光），此时 AXIS 无意义
  const cylAplano = a.cyl.raw.trim() === '' || parsePower(a.cyl.raw) === 0;
  const cylBplano = b.cyl.raw.trim() === '' || parsePower(b.cyl.raw) === 0;

  const sphA = parsePower(a.sph.raw);
  const sphB = parsePower(b.sph.raw);
  if (sphA === null || sphB === null) {
    return scUnknownFields(a, b, '球镜 SPH 原文无法识别，请重新核对抄录');
  }

  if (cylAplano && cylBplano) {
    const d = diffPower(sphA, sphB);
    const r: FieldResult = {
      key: 'sph',
      statusA: 'provided',
      statusB: 'provided',
      rawA: a.sph.raw,
      rawB: b.sph.raw,
      canonA: fmtD(sphA),
      canonB: fmtD(sphB),
      verdict: d <= tol.power + 1e-9 ? 'match' : 'mismatch',
      reason:
        d <= tol.power + 1e-9
          ? d === 0
            ? '球镜一致（两侧均无散光）'
            : `球镜相差 ${d.toFixed(2)}D，在允许差值内（两侧均无散光）`
          : `球镜相差 ${d.toFixed(2)}D，超出允许差值 ${tol.power}D`,
      diff: d,
    };
    return {
      results: {
        sph: r,
        cyl: unknownResult(
          'cyl',
          a.cyl,
          b.cyl,
          '两侧均无散光（柱镜平光），该项不参与判定',
          'PL',
          'PL',
        ),
        axis: unknownResult('axis', a.axis, b.axis, '无散光时轴位无意义，不参与判定', '—', '—'),
      },
      verdict: r.verdict,
      transSteps: null,
      transNote: '',
    };
  }

  // 一侧有散光、另一侧没有：散光度数不可能靠转写消除，直接判不符
  if (cylAplano || cylBplano) {
    const side = cylAplano ? 'A' : 'B';
    const grp = scUnknownFields(a, b, `一侧无散光而${side === 'A' ? 'B' : 'A'}侧有散光，球柱镜组合不符`);
    grp.results.sph = {
      key: 'sph',
      statusA: 'provided',
      statusB: 'provided',
      rawA: a.sph.raw,
      rawB: b.sph.raw,
      canonA: fmtD(sphA),
      canonB: fmtD(sphB),
      verdict: 'mismatch',
      reason: '一侧无散光、另一侧有散光，球镜无法直接等同',
      diff: diffPower(sphA, sphB),
    };
    grp.verdict = 'mismatch';
    return grp;
  }

  const cylA = parsePower(a.cyl.raw);
  const cylB = parsePower(b.cyl.raw);
  const axisA = parseAxis(a.axis.raw);
  const axisB = parseAxis(b.axis.raw);

  if (cylA === null || cylB === null) {
    return scUnknownFields(a, b, '柱镜 CYL 原文无法识别，请重新核对抄录');
  }
  if (axisA === null || axisB === null) {
    return scUnknownFields(a, b, '轴位 AXIS 原文无法识别（应为 1–180 的整数），请重新核对抄录');
  }

  const powerOk = (x: number, y: number) => diffPower(x, y) <= tol.power + 1e-9;
  const axisOk = (x: number, y: number) => diffAxis(x, y) <= tol.axis + 1e-9;

  // 直接比较
  const direct =
    powerOk(sphA, sphB) && powerOk(cylA, cylB) && (cylA === 0 || axisOk(axisA, axisB));
  if (direct) {
    const mk = (key: SCFieldKey, va: number, vb: number, isAxis: boolean): FieldResult => {
      const d = isAxis ? diffAxis(va, vb) : diffPower(va, vb);
      return {
        key,
        statusA: 'provided',
        statusB: 'provided',
        rawA: a[key].raw,
        rawB: b[key].raw,
        canonA: isAxis ? `${va}°` : fmtD(va),
        canonB: isAxis ? `${vb}°` : fmtD(vb),
        verdict: 'match',
        reason:
          d === 0
            ? isAxis
              ? '轴位一致（按 180° 周期比较）'
              : '数值一致'
            : `相差 ${isAxis ? `${d}°` : `${d.toFixed(2)}D`}，在允许差值内`,
        diff: d,
      };
    };
    return {
      results: {
        sph: mk('sph', sphA, sphB, false),
        cyl: mk('cyl', cylA, cylB, false),
        axis: mk('axis', axisA, axisB, true),
      },
      verdict: 'match',
      transSteps: null,
      transNote:
        (cylA < 0 && cylB < 0) || (cylA > 0 && cylB > 0)
          ? cylA < 0
            ? '两侧同为负柱镜记法'
            : '两侧同为正柱镜记法'
          : '',
    };
  }

  // 转写 A 后再与 B 比较
  const { result: tA, steps } = transposeSteps({ sph: sphA, cyl: cylA, axis: axisA });
  const viaTranspose =
    powerOk(tA.sph, sphB) && powerOk(tA.cyl, cylB) && axisOk(tA.axis, axisB);

  if (viaTranspose) {
    const mk = (key: SCFieldKey, vb: number, isAxis: boolean): FieldResult => ({
      key,
      statusA: 'provided',
      statusB: 'provided',
      rawA: a[key].raw,
      rawB: b[key].raw,
      canonA: isAxis ? `${tA.axis}°` : key === 'sph' ? fmtD(tA.sph) : fmtD(tA.cyl),
      canonB: isAxis ? `${vb}°` : fmtD(vb),
      verdict: 'match',
      reason: '原值写法不同，按球柱镜转写规则换算后一致（详见逐步依据）',
      diff: 0,
    });
    return {
      results: {
        sph: mk('sph', sphB, false),
        cyl: mk('cyl', cylB, false),
        axis: mk('axis', axisB, true),
      },
      verdict: 'match',
      transSteps: steps,
      transNote:
        cylA < 0
          ? 'A 侧为负柱镜记法、B 侧为正柱镜记法，二者是同一副镜片的等价写法'
          : 'A 侧为正柱镜记法、B 侧为负柱镜记法，二者是同一副镜片的等价写法',
    };
  }

  // 直接比较与转写后比较均不符
  const mismatch = (key: SCFieldKey, va: number, vb: number, isAxis: boolean): FieldResult => {
    const d = isAxis ? diffAxis(va, vb) : diffPower(va, vb);
    return {
      key,
      statusA: 'provided',
      statusB: 'provided',
      rawA: a[key].raw,
      rawB: b[key].raw,
      canonA: isAxis ? `${va}°` : fmtD(va),
      canonB: isAxis ? `${vb}°` : fmtD(vb),
      verdict: 'mismatch',
      reason: `直接比较相差 ${isAxis ? `${d}°（180° 周期）` : `${d.toFixed(2)}D`}，转写为另一柱镜形式后仍不符`,
      diff: d,
    };
  };
  return {
    results: {
      sph: mismatch('sph', sphA, sphB, false),
      cyl: mismatch('cyl', cylA, cylB, false),
      axis: mismatch('axis', axisA, axisB, true),
    },
    verdict: 'mismatch',
    transSteps: null,
    transNote: '',
  };
}

/* ------------------------------------------------------------------ */
/* 整眼 / 来源对比较                                                    */
/* ------------------------------------------------------------------ */

interface EyeComparison {
  result: {
    fields: FieldResult[];
    verdict: MatchVerdict;
    comparableCount: number;
  };
  scGroup: SCGroup;
}

function compareEye(recA: EyeRecord, recB: EyeRecord, tol: Tolerance): EyeComparison {
  const sc = compareSpheroCylinder(recA, recB, tol);
  const add = compareSimple('add', recA.add, recB.add, { kind: 'power', tol: tol.power });
  const pdM = compareSimple('pdMonocular', recA.pdMonocular, recB.pdMonocular, {
    kind: 'pd',
    tol: tol.pd,
  });

  const fields: FieldResult[] = [sc.results.sph, sc.results.cyl, sc.results.axis, add, pdM];

  let comparable = 0;
  let mismatch = false;
  let match = false;
  for (const f of fields) {
    if (f.verdict === 'match') {
      comparable++;
      match = true;
    } else if (f.verdict === 'mismatch') {
      comparable++;
      mismatch = true;
    }
  }
  // 球柱镜组若整体为 match，三个字段中 PL/无轴位的 unknown 不重复计数
  // 以“组”为一个可比项计数更贴近用户理解：重新统计
  comparable = 0;
  mismatch = false;
  match = false;
  if (sc.verdict !== 'unknown') {
    comparable++;
    if (sc.verdict === 'match') match = true;
    else mismatch = true;
  }
  for (const f of [add, pdM]) {
    if (f.verdict !== 'unknown') {
      comparable++;
      if (f.verdict === 'match') match = true;
      else mismatch = true;
    }
  }

  const verdict: MatchVerdict = mismatch ? 'mismatch' : match ? 'match' : 'unknown';
  return { result: { fields, verdict, comparableCount: comparable }, scGroup: sc };
}

export function comparePair(a: SourceDocument, b: SourceDocument, tol: Tolerance): PairCompareResult {
  const odSame = compareEye(a.OD, b.OD, tol);
  const osSame = compareEye(a.OS, b.OS, tol);
  // 交叉：A 的右眼对 B 的左眼，A 的左眼对 B 的右眼
  const odCross = compareEye(a.OD, b.OS, tol);
  const osCross = compareEye(a.OS, b.OD, tol);

  const pdBinocular = compareSimple('pdBinocular', a.pdBinocular, b.pdBinocular, {
    kind: 'pd',
    tol: tol.pd,
  });

  // 疑似左右互换判定：
  //  支持：某眼本侧不符而交叉相符；
  //  矛盾：某眼本侧相符而交叉不符（则不是单纯互换）；
  //  无散光/缺失等无法判定的眼不参与。
  let supporting = 0;
  let contradicting = 0;
  const eyes: { eye: Eye; same: EyeComparison; cross: EyeComparison }[] = [
    { eye: 'OD', same: odSame, cross: odCross },
    { eye: 'OS', same: osSame, cross: osCross },
  ];
  for (const e of eyes) {
    if (e.same.result.verdict === 'mismatch' && e.cross.result.verdict === 'match') supporting++;
    if (e.same.result.verdict === 'match' && e.cross.result.verdict === 'mismatch') contradicting++;
  }
  const swapSuspected = supporting > 0 && contradicting === 0;

  // 带具体数值的逐步依据
  const fmtEyeVals = (ec: EyeComparison): string => {
    const parts: string[] = [];
    for (const f of ec.result.fields) {
      if (f.verdict === 'mismatch') parts.push(`${FIELD_LABEL[f.key]} ${f.rawA || '空'}→${f.rawB || '空'}`);
    }
    return parts.join('；') || '无明显单项差异';
  };
  const fmtCrossVals = (ec: EyeComparison): string => {
    const parts: string[] = [];
    for (const f of ec.result.fields) {
      if (f.verdict === 'match' && f.rawA.trim() !== '') parts.push(`${FIELD_LABEL[f.key]} ${f.rawA}=${f.rawB}`);
    }
    return parts.join('；') || '无';
  };

  const swapDetail = swapSuspected
    ? `本侧核对有 ${supporting} 只眼睛不符（${eyes
        .filter((e) => e.same.result.verdict === 'mismatch')
        .map((e) => `${e.eye === 'OD' ? '右眼' : '左眼'}：${fmtEyeVals(e.same)}`)
        .join('；')}）；把两侧的左右眼对调后核对，对应项全部相符（${eyes
        .filter((e) => e.cross.result.verdict === 'match')
        .map((e) => `${e.eye === 'OD' ? '右↔左' : '左↔右'}：${fmtCrossVals(e.cross)}`)
        .join('；')}）。疑似${b.id === 'pack' ? '镜袋' : '凭据'}左右拿反，请人工确认后再作结论。`
    : '';

  return {
    a: a.id,
    b: b.id,
    same: {
      OD: odSame.result.fields,
      OS: osSame.result.fields,
      verdictOD: odSame.result.verdict,
      verdictOS: osSame.result.verdict,
      comparableCountOD: odSame.result.comparableCount,
      comparableCountOS: osSame.result.comparableCount,
      transOD: odSame.scGroup.transSteps,
      transOS: osSame.scGroup.transSteps,
      transNoteOD: odSame.scGroup.transNote,
      transNoteOS: osSame.scGroup.transNote,
    },
    cross: {
      OD: odCross.result.fields,
      OS: osCross.result.fields,
      verdictOD: odCross.result.verdict,
      verdictOS: osCross.result.verdict,
      comparableCountOD: odCross.result.comparableCount,
      comparableCountOS: osCross.result.comparableCount,
      transOD: odCross.scGroup.transSteps,
      transOS: osCross.scGroup.transSteps,
      transNoteOD: odCross.scGroup.transNote,
      transNoteOS: osCross.scGroup.transNote,
    },
    pdBinocular,
    pdDeriveA: [],
    pdDeriveB: [],
    swapSuspected,
    swapDetail,
  };
}

/** 单眼瞳距之和 与 双眼瞳距 的同单派生核对（不跨来源） */
export function derivePdChecks(doc: SourceDocument, tol: Tolerance): PdDeriveCheck[] {
  const out: PdDeriveCheck[] = [];
  const od = doc.OD.pdMonocular;
  const os = doc.OS.pdMonocular;
  const bin = doc.pdBinocular;
  if (od.status === 'provided' && os.status === 'provided' && bin.status === 'provided') {
    const vod = parsePd(od.raw);
    const vos = parsePd(os.raw);
    const vbin = parsePd(bin.raw);
    if (vod !== null && vos !== null && vbin !== null) {
      const sum = Math.round((vod + vos) * 10) / 10;
      const d = diffPd(sum, vbin);
      out.push({
        eye: 'OD',
        mono: `${vod} + ${vos}`,
        otherMono: '',
        binocular: `${vbin}`,
        verdict: d <= tol.pd + 1e-9 ? 'match' : 'mismatch',
        reason:
          d <= tol.pd + 1e-9
            ? `单眼瞳距之和 ${sum} mm 与双眼瞳距 ${vbin} mm 一致`
            : `单眼瞳距之和 ${sum} mm 与双眼瞳距 ${vbin} mm 相差 ${d.toFixed(1)} mm`,
        diff: d,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 指纹与导出                                                           */
/* ------------------------------------------------------------------ */

/** 数据指纹：任何一处抄录 / 容差 / 镜种变化都会使旧确认立即作废 */
export function fingerprint(state: {
  lensType: string;
  tolerance: Tolerance;
  sources: Record<SourceId, SourceDocument>;
}): string {
  const slim = {
    lensType: state.lensType,
    tolerance: state.tolerance,
    sources: state.sources,
  };
  let h = 5381;
  const str = JSON.stringify(slim);
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return `fp_${(h >>> 0).toString(36)}_${str.length}`;
}

export interface ExportDisputedField {
  eye: Eye | 'BIN';
  field: EyeFieldKey | 'pdBinocular';
  label: string;
  valueA: string;
  valueB: string;
  note: string;
}

export interface ExportHandoff {
  type: 'eyeglass-pickup-handoff';
  generatedAt: string;
  pair: { from: SourceId; to: SourceId };
  sources: SourceId[];
  disputedFields: ExportDisputedField[];
  swapSuspected: boolean;
  confirmation: {
    status: string;
    comment: string;
    confirmedAt: string | null;
    stale: boolean;
  };
}

export const SOURCE_LABELS: Record<SourceId, string> = {
  rx: '验光处方',
  job: '加工单',
  pack: '镜片包装 / 镜袋',
};

export function buildHandoff(
  pair: { a: SourceId; b: SourceId },
  result: PairCompareResult,
  confirmation:
    | { status: string; comment: string; confirmedAt: number; fingerprint: string }
    | undefined,
  currentFp: string,
): ExportHandoff {
  const disputed: ExportDisputedField[] = [];
  const pushEye = (eye: Eye, fields: FieldResult[]) => {
    for (const f of fields) {
      if (f.verdict === 'mismatch') {
        disputed.push({
          eye,
          field: f.key as EyeFieldKey,
          label: FIELD_LABEL[f.key as EyeFieldKey] ?? f.key,
          valueA: f.rawA || '（空）',
          valueB: f.rawB || '（空）',
          note: f.reason,
        });
      }
    }
  };
  pushEye('OD', result.same.OD);
  pushEye('OS', result.same.OS);
  if (result.pdBinocular.verdict === 'mismatch') {
    disputed.push({
      eye: 'BIN',
      field: 'pdBinocular',
      label: FIELD_LABEL.pdBinocular,
      valueA: result.pdBinocular.rawA || '（空）',
      valueB: result.pdBinocular.rawB || '（空）',
      note: result.pdBinocular.reason,
    });
  }

  return {
    type: 'eyeglass-pickup-handoff',
    generatedAt: new Date().toISOString(),
    pair: { from: pair.a, to: pair.b },
    sources: [pair.a, pair.b],
    disputedFields: disputed,
    swapSuspected: result.swapSuspected,
    confirmation: {
      status: confirmation?.status ?? 'unconfirmed',
      comment: confirmation?.comment ?? '',
      confirmedAt: confirmation ? new Date(confirmation.confirmedAt).toISOString() : null,
      stale: confirmation ? confirmation.fingerprint !== currentFp : false,
    },
  };
}

export function _roundQ(v: number) {
  return roundQ(v);
}

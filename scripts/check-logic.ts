import { parsePower, parseAxis, diffAxis, transpose, parsePd } from '../src/lib/optics';
import { comparePair, emptySourceDocument, derivePdChecks } from '../src/lib/compare';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('FAIL:', msg);
  }
}

// --- 解析 ---
assert(parsePower('+200') === 2, '+200 = +2.00D');
assert(parsePower('-025') === -0.25, '-025 = -0.25D');
assert(parsePower('-1.25') === -1.25, '-1.25');
assert(parsePower('+2.00') === 2, '+2.00');
assert(parsePower('PL') === 0, 'PL plano');
assert(parsePower('平光') === 0, '平光');
assert(parsePower('-1.25DS') === -1.25, '-1.25DS');
assert(parsePower('175') === 1.75, '无符号 175 在球镜字段按 +1.75D（老花镜包装简写）');
assert(parsePower('90') === null, '无符号两位数 90 不做猜测');
assert(parseAxis('175') === 175, '轴位字段 175 正常解析');
assert(parseAxis('180') === 180, 'axis 180');
assert(parseAxis('005') === 5, 'axis 005');
assert(parseAxis('0') === 180, 'axis 0 = 180');
assert(parsePd('62') === 62, 'pd 62');
assert(parsePd('32.5') === 32.5, 'pd 32.5');

// --- 轴位周期 ---
assert(diffAxis(5, 175) === 10, '轴位 5 vs 175 环形差 10°');
assert(diffAxis(0, 180) === 0, '轴位 0 vs 180 等价');
assert(diffAxis(100, 80) === 20, '轴位 100 vs 80 差 20°');

// --- 转写 ---
const t = transpose({ sph: -2, cyl: -1, axis: 180 });
assert(t.sph === -3 && t.cyl === 1 && t.axis === 90, '-2/-1x180 转写为 -3/+1x90');
const t2 = transpose({ sph: -3, cyl: 1, axis: 90 });
assert(t2.sph === -2 && t2.cyl === -1 && t2.axis === 180, '逆转写一致');

// --- 构造来源文档 ---
function doc(id: 'rx' | 'job' | 'pack', data: Record<string, [string, string]>) {
  const d = emptySourceDocument(id);
  const set = (eye: 'OD' | 'OS', k: string, raw: string) => {
    (d[eye] as unknown as Record<string, { raw: string; status: string }>)[k] = {
      raw,
      status: raw === '?' ? 'unreadable' : raw === '-' ? 'missing' : 'provided',
    };
  };
  for (const [k, [od, os]] of Object.entries(data)) {
    if (k === 'pdBinocular') continue;
    set('OD', k, od);
    set('OS', k, os);
  }
  if (data.pdBinocular) d.pdBinocular = { raw: data.pdBinocular[0], status: 'provided' };
  return d;
}

const tol = { power: 0, axis: 0, pd: 0 };

// 1) 正负柱镜等价记法
const rx1 = doc('rx', {
  sph: ['-2.00', '-1.00'],
  cyl: ['-1.00', '-0.50'],
  axis: ['180', '90'],
});
const pack1 = doc('pack', {
  sph: ['-3.00', '-1.50'],
  cyl: ['+1.00', '+0.50'],
  axis: ['90', '180'],
});
const r1 = comparePair(rx1, pack1, tol);
assert(r1.same.verdictOD === 'match', '负柱镜 vs 正柱镜等价记法 右眼应一致');
assert(r1.same.verdictOS === 'match', '负柱镜 vs 正柱镜等价记法 左眼应一致');
assert(!!r1.same.transOD, '应附转写逐步依据');
assert(!r1.swapSuspected, '等价记法不应报互换');

// 2) 缺失字段不得补齐为一致
const rx2 = doc('rx', {
  sph: ['-2.00', '-1.00'],
  cyl: ['-', '-0.50'],
  axis: ['-', '90'],
});
const pack2 = doc('pack', {
  sph: ['-2.00', '-1.00'],
  cyl: ['-1.00', '-0.50'],
  axis: ['180', '90'],
});
const r2 = comparePair(rx2, pack2, tol);
assert(r2.same.verdictOD === 'unknown', '右眼柱镜/轴位缺失 → 无法判定，不得补齐');
assert(r2.same.verdictOS === 'match', '左眼完整且一致 → match');

// 3) 疑似左右互换
const rx3 = doc('rx', {
  sph: ['-2.00', '-1.00'],
  cyl: ['-0.50', '-0.50'],
  axis: ['180', '90'],
});
const pack3 = doc('pack', {
  sph: ['-1.00', '-2.00'],
  cyl: ['-0.50', '-0.50'],
  axis: ['90', '180'],
});
const r3 = comparePair(rx3, pack3, tol);
assert(r3.same.verdictOD === 'mismatch' && r3.same.verdictOS === 'mismatch', '本侧双眼均不符');
assert(r3.cross.verdictOD === 'match' && r3.cross.verdictOS === 'match', '交叉后双眼均相符');
assert(r3.swapSuspected === true, '应提示疑似左右互换');

// 4) 真实差异：转写也无法消除
const rx4 = doc('rx', {
  sph: ['-2.00', '-1.00'],
  cyl: ['-0.50', '-0.50'],
  axis: ['180', '90'],
});
const pack4 = doc('pack', {
  sph: ['-2.50', '-1.00'],
  cyl: ['-0.50', '-0.50'],
  axis: ['180', '90'],
});
const r4 = comparePair(rx4, pack4, tol);
assert(r4.same.verdictOD === 'mismatch', '球镜差 0.50D 应判不符');
assert(!r4.swapSuspected, '单纯差异不应报互换');

// 5) 无散光眼
const rx5 = doc('rx', { sph: ['+2.00', '+2.00'], cyl: ['PL', 'PL'], axis: ['', ''] });
const pack5 = doc('pack', { sph: ['+2.00', '+2.00'], cyl: ['', ''], axis: ['', ''] });
const r5 = comparePair(rx5, pack5, tol);
assert(r5.same.verdictOD === 'match' && r5.same.verdictOS === 'match', '双侧平光老花镜一致');

// 6) 轴位容差周期
const rx6 = doc('rx', { sph: ['-2.00', '-2.00'], cyl: ['-0.50', '-0.50'], axis: ['5', '175'] });
const pack6 = doc('pack', { sph: ['-2.00', '-2.00'], cyl: ['-0.50', '-0.50'], axis: ['175', '5'] });
const r6 = comparePair(rx6, pack6, { power: 0, axis: 10, pd: 0 });
const odAxis = r6.same.OD.find((f) => f.key === 'axis')!;
assert(odAxis.verdict === 'match' && odAxis.diff === 10, '轴位环形差 10° 在容差内一致');

// 7) 单眼瞳距之和 vs 双眼瞳距
const d7 = emptySourceDocument('rx');
d7.OD.pdMonocular = { raw: '31', status: 'provided' };
d7.OS.pdMonocular = { raw: '31.5', status: 'provided' };
d7.pdBinocular = { raw: '62.5', status: 'provided' };
const pd7 = derivePdChecks(d7, { power: 0, axis: 0, pd: 0 });
assert(pd7.length === 1 && pd7[0].verdict === 'match', '31+31.5=62.5 双眼瞳距派生核对一致');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// 验光数据的领域类型定义

export type Eye = 'OD' | 'OS';
/** OD = 右眼（拉丁文 Oculus Dexter），OS = 左眼（拉丁文 Oculus Sinister） */

/** 镜种 */
export type LensType = 'reading' | 'progressive';

/** 数据来源 */
export type SourceId = 'rx' | 'job' | 'pack';

/** 单个字段的抄录状态 */
export type FieldStatus = 'provided' | 'unreadable' | 'missing';

/** 字段名（球 SPH / 柱 CYL / 轴 AXIS / 下加光 ADD / 单眼瞳距 PD） */
export type EyeFieldKey = 'sph' | 'cyl' | 'axis' | 'add' | 'pdMonocular';

export interface FieldValue {
  /** 逐字抄录的原文，例如 "-1.25"、"+200"、"180" */
  raw: string;
  status: FieldStatus;
}

export interface EyeRecord {
  sph: FieldValue;
  cyl: FieldValue;
  axis: FieldValue;
  add: FieldValue;
  /** 单眼瞳距（mm） */
  pdMonocular: FieldValue;
}

/** 双眼瞳距（整副眼镜一个值，放在 rx 来源的文档级字段中） */
export type PdStatus = FieldStatus;

export interface SourceDocument {
  id: SourceId;
  note: string;
  /** 双眼瞳距 PD（mm） */
  pdBinocular: FieldValue;
  OD: EyeRecord;
  OS: EyeRecord;
}

export interface CredentialImage {
  id: string;
  source: SourceId;
  name: string;
  type: string;
  createdAt: number;
}

export interface Tolerance {
  /** 球镜 / 柱镜 / 下加光允许差值（D），0 表示必须严格一致 */
  power: number;
  /** 轴位允许差值（度），0 表示按 180° 周期严格一致 */
  axis: number;
  /** 瞳距允许差值（mm），0 表示必须严格一致 */
  pd: number;
}

export type PairConfirmStatus = 'unconfirmed' | 'consistent' | 'difference' | 'swap';

/** 某一对来源的逐项确认 */
export interface PairConfirmation {
  a: SourceId;
  b: SourceId;
  status: PairConfirmStatus;
  comment: string;
  /** 确认时所依据的数据指纹；指纹变化后该确认立即作废 */
  fingerprint: string;
  confirmedAt: number;
}

export interface AppState {
  lensType: LensType;
  tolerance: Tolerance;
  sources: Record<SourceId, SourceDocument>;
  images: CredentialImage[];
  confirmations: PairConfirmation[];
  updatedAt: number;
  /** 用于撤销的历史快照（最新在后，不持久化） */
  history: AppState[];
}

export interface StoredBlob {
  id: string;
  blob: Blob;
}

/* ---------- 核对结论类型（由数据实时推导，不入库） ---------- */

export type MatchVerdict = 'match' | 'mismatch' | 'unknown';

export type CanonicalKind = 'power' | 'axis' | 'pd';

export interface CanonicalValue {
  /** 解析后的规范数值；无法解析时为 null */
  num: number | null;
  /** 原始抄录是否可解析 */
  parseable: boolean;
  kind: CanonicalKind;
}

export type TransForm = 'negative' | 'positive';

export interface TransStep {
  label: string;
  detail: string;
}

/** 单字段比对结果 */
export interface FieldResult {
  key: EyeFieldKey | 'pdBinocular';
  statusA: FieldStatus;
  statusB: FieldStatus;
  rawA: string;
  rawB: string;
  canonA: string;
  canonB: string;
  verdict: MatchVerdict;
  reason: string;
  /** 实际差值（球柱镜为 D，轴位为度，瞳距为 mm）；无法比较时为 null */
  diff: number | null;
  /** 为达成一致所做的球柱镜转换步骤（仅在跨正/负柱镜记法时存在） */
  transSteps?: TransStep[];
}

export interface EyeCompareResult {
  OD: FieldResult[];
  OS: FieldResult[];
  verdictOD: MatchVerdict;
  verdictOS: MatchVerdict;
  comparableCountOD: number;
  comparableCountOS: number;
  transOD?: TransStep[] | null;
  transOS?: TransStep[] | null;
  transNoteOD?: string;
  transNoteOS?: string;
}

export interface PdDeriveCheck {
  eye: Eye;
  mono: string;
  otherMono: string;
  binocular: string;
  verdict: MatchVerdict;
  reason: string;
  diff: number | null;
}

export interface PairCompareResult {
  a: SourceId;
  b: SourceId;
  /** 本侧核对（A.OD 对 B.OD，A.OS 对 B.OS） */
  same: EyeCompareResult;
  /** 交叉核对（A.OD 对 B.OS，A.OS 对 B.OD） */
  cross: EyeCompareResult;
  /** 双眼瞳距核对 */
  pdBinocular: FieldResult;
  /** 单眼瞳距之和 对 双眼瞳距 的派生核对（A 侧） */
  pdDeriveA: PdDeriveCheck[];
  pdDeriveB: PdDeriveCheck[];
  /** 疑似左右互换 */
  swapSuspected: boolean;
  swapDetail: string;
}

export type OverallStatus = 'unconfirmed' | 'consistent' | 'difference' | 'swap';

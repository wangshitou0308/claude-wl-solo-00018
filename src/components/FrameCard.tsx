import type { Eye, FieldResult, MatchVerdict, TransStep } from '../types';
import { FIELD_LABEL } from '../lib/compare';

function verdictBadge(v: MatchVerdict) {
  if (v === 'match')
    return (
      <span className="badge match">一致</span>
    );
  if (v === 'mismatch') return <span className="badge mismatch">不符</span>;
  return <span className="badge unknown">无法判定</span>;
}

function Cell({ result, side }: { result: FieldResult; side: 'A' | 'B' }) {
  const raw = side === 'A' ? result.rawA : result.rawB;
  const canon = side === 'A' ? result.canonA : result.canonB;
  const status = side === 'A' ? result.statusA : result.statusB;
  const statusNote = status === 'unreadable' ? '看不清' : status === 'missing' ? '未提供' : null;

  return (
    <div className={`cell ${result.verdict}`}>
      <span className="cap">
        原值：{statusNote ? <b>{statusNote}</b> : raw.trim() === '' ? '（空白）' : raw}
      </span>
      <span className="val">
        <span className="cap" style={{ marginRight: 4, fontWeight: 400 }}>
          规范值
        </span>
        {canon}
      </span>
      {side === 'B' && <div className="why">{result.reason}</div>}
    </div>
  );
}

interface FrameCardProps {
  eye: Eye;
  fields: FieldResult[];
  verdict: MatchVerdict;
  comparableCount: number;
  nameA: string;
  nameB: string;
  cross?: boolean;
  transSteps?: TransStep[] | null;
  transNote?: string;
}

export function FrameCard({
  eye,
  fields,
  verdict,
  comparableCount,
  nameA,
  nameB,
  cross,
  transSteps,
  transNote,
}: FrameCardProps) {
  const sc = fields.filter((f) => f.key === 'sph' || f.key === 'cyl' || f.key === 'axis');
  const shownSteps = transSteps ?? (cross ? null : null);
  const note =
    transNote && !cross
      ? transNote
      : cross
        ? '交叉核对：把这一侧与另一侧的对侧眼比较'
        : '';

  return (
    <div className={`frame-card ${eye}`}>
      <div className="frame-head">
        <span className="big-eye">
          {cross ? '↔ ' : ''}
          {eye === 'OD' ? '右眼镜框' : '左眼镜框'}（{eye}）
        </span>
        <span className="eye-summary">
          {verdictBadge(verdict)}
          <span className="small" style={{ color: '#f0f0f0' }}>
            可判 {comparableCount} 项
          </span>
        </span>
      </div>
      <div className="frame-body">
        {note && (
          <p className="small" style={{ margin: '8px 2px' }}>
            {note}
          </p>
        )}
        {fields.map((f) => (
          <div className="field-row" key={`${eye}-${f.key}-${cross ? 'x' : 's'}`}>
            <div className="fname">{FIELD_LABEL[f.key] ?? f.key}</div>
            <Cell result={f} side="A" />
            <Cell result={f} side="B" />
          </div>
        ))}
        {!cross && shownSteps && shownSteps.length > 0 && (
          <details style={{ margin: '8px 2px' }}>
            <summary style={{ fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}>
              为什么写法不同也算一致？查看球柱镜转写逐步依据
            </summary>
            <ol className="steps">
              {shownSteps.map((s, i) => (
                <li key={i}>
                  <b>{s.label}</b>
                  <div>{s.detail}</div>
                </li>
              ))}
            </ol>
          </details>
        )}
        {sc.every((f) => f.verdict === 'unknown') && (
          <p className="small muted">球镜 / 柱镜 / 轴位资料不足以判定，未用缺失值补齐结论。</p>
        )}
        <p className="small muted" style={{ marginBottom: 4 }}>
          对照方向：{nameA} → {nameB}
        </p>
      </div>
    </div>
  );
}

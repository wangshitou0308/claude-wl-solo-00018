import type { EyeFieldKey, FieldStatus, FieldValue, SourceDocument } from '../types';
import { EYE_FIELDS } from '../lib/compare';

interface FieldEntryProps {
  value: FieldValue;
  field: EyeFieldKey | 'pdBinocular';
  radioName: string;
  large?: boolean;
  onChange: (next: FieldValue) => void;
}

const STATUS_OPTIONS: { value: FieldStatus; label: string }[] = [
  { value: 'provided', label: '照抄' },
  { value: 'unreadable', label: '看不清' },
  { value: 'missing', label: '未提供' },
];

const PLACEHOLDER: Record<string, string> = {
  sph: '如 -1.25 或 +200',
  cyl: '如 -0.50，无散光留空',
  axis: '如 180 / 5 / 175',
  add: '如 +2.00',
  pdMonocular: '如 32',
  pdBinocular: '如 62',
};

export function FieldEntry({ value, field, radioName, large, onChange }: FieldEntryProps) {
  return (
    <div className="status-pick">
      <input
        className={`field-input${large ? ' large' : ''}`}
        type="text"
        inputMode={field === 'axis' || field === 'pdMonocular' || field === 'pdBinocular' ? 'numeric' : 'text'}
        value={value.raw}
        disabled={value.status !== 'provided'}
        placeholder={value.status === 'provided' ? PLACEHOLDER[field] ?? '' : ''}
        aria-label={field}
        onChange={(e) => onChange({ ...value, raw: e.target.value })}
      />
      <div role="radiogroup" aria-label="字段状态">
        {STATUS_OPTIONS.map((opt) => (
          <label key={opt.value} className={value.status === opt.value ? 'sel' : ''}>
            <input
              type="radio"
              name={`${radioName}-${field}-status`}
              checked={value.status === opt.value}
              onChange={() => onChange({ ...value, status: opt.value })}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

interface SourceEntryProps {
  doc: SourceDocument;
  title: string;
  onChange: (doc: SourceDocument) => void;
  lensType: 'reading' | 'progressive';
}

export function SourceEntry({ doc, title, onChange, lensType }: SourceEntryProps) {
  const setEye = (eye: 'OD' | 'OS', field: EyeFieldKey, next: FieldValue) =>
    onChange({ ...doc, [eye]: { ...doc[eye], [field]: next } });

  const visibleFields =
    lensType === 'progressive' ? EYE_FIELDS : EYE_FIELDS.filter((f) => f.key !== 'add');

  return (
    <div>
      <h2>{title}</h2>
      <table className="entry">
        <thead>
          <tr>
            <th className="labelcol">项目</th>
            <th style={{ width: '38%' }}>右眼 OD（镜袋上常写作 R）</th>
            <th style={{ width: '38%' }}>左眼 OS（镜袋上常写作 L）</th>
          </tr>
        </thead>
        <tbody>
          {visibleFields.map((f) => (
            <tr key={f.key}>
              <td className="labelcol">
                {f.label}
                <span className="small muted">（{f.unit}）</span>
              </td>
              <td>
                <FieldEntry
                  field={f.key}
                  radioName={`${doc.id}-OD`}
                  value={doc.OD[f.key]}
                  large
                  onChange={(next) => setEye('OD', f.key, next)}
                />
              </td>
              <td>
                <FieldEntry
                  field={f.key}
                  radioName={`${doc.id}-OS`}
                  value={doc.OS[f.key]}
                  large
                  onChange={(next) => setEye('OS', f.key, next)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pd-row">
        <strong>双眼瞳距 PD（mm）</strong>
        <FieldEntry
          field="pdBinocular"
          radioName={`${doc.id}-BIN`}
          value={doc.pdBinocular}
          large
          onChange={(next) => onChange({ ...doc, pdBinocular: next })}
        />
        <span className="small muted">
          单眼瞳距（右 PD / 左 PD）与双眼瞳距填在同一张单据上时，应用会自行核对“右 PD + 左 PD = 双眼 PD”。
        </span>
      </div>

      <p className="small muted" style={{ marginTop: 10 }}>
        抄录提示：请照单据原样填写，
        <b>看不清</b>就选“看不清”，单据上没有就选“未提供”，不要猜。支持写法：
        -1.25、+2.00、+200（=+2.00D）、PL（平光）、180、005、62mm。
      </p>
    </div>
  );
}

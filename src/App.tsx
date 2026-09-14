import { useEffect, useMemo, useState } from 'react';
import type { PairConfirmStatus, SourceId } from './types';
import {
  buildHandoff,
  comparePair,
  derivePdChecks,
  fingerprint,
  SOURCE_LABELS,
} from './lib/compare';
import { clearImages, clearState, loadState } from './lib/db';
import { createInitialState, useAppState } from './lib/state';
import { SourceEntry } from './components/SourceEntry';
import { FrameCard } from './components/FrameCard';
import { ImagePanel } from './components/ImagePanel';

type Tab = 'entry' | 'check' | 'credentials';

const PAIRS: [SourceId, SourceId][] = [
  ['rx', 'job'],
  ['job', 'pack'],
  ['rx', 'pack'],
];

function pairKey(a: SourceId, b: SourceId) {
  return `${a}__${b}`;
}

const CONFIRM_LABELS: Record<PairConfirmStatus, string> = {
  unconfirmed: '未确认',
  consistent: '已确认一致',
  difference: '已确认存在差异（带去争议）',
  swap: '已确认左右互换',
};

export default function App() {
  const api = useAppState();
  const { state } = api;
  const [tab, setTab] = useState<Tab>('entry');
  const [activeSource, setActiveSource] = useState<SourceId>('rx');
  const [activePair, setActivePair] = useState<[SourceId, SourceId]>(['rx', 'job']);
  const [showCross, setShowCross] = useState(false);
  const [comment, setComment] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  // 启动时从 IndexedDB 恢复未完成核对
  useEffect(() => {
    let cancelled = false;
    void loadState().then((stored) => {
      if (cancelled || !stored) {
        api.markHydrated();
        return;
      }
      const initial = createInitialState();
      api.hydrate({
        ...initial,
        ...stored,
        lensType: stored.lensType ?? initial.lensType,
        tolerance: stored.tolerance ?? initial.tolerance,
        sources: { ...initial.sources, ...stored.sources },
        images: stored.images ?? [],
        confirmations: stored.confirmations ?? [],
        updatedAt: stored.updatedAt ?? Date.now(),
        history: [],
      });
      notify('已恢复上次未完成的核对');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fp = useMemo(
    () => fingerprint({ lensType: state.lensType, tolerance: state.tolerance, sources: state.sources }),
    [state.lensType, state.tolerance, state.sources],
  );

  const pairResults = useMemo(
    () =>
      PAIRS.map(([a, b]) => ({
        key: pairKey(a, b),
        result: comparePair(state.sources[a], state.sources[b], state.tolerance),
      })),
    [state.sources, state.tolerance],
  );

  const getResult = (a: SourceId, b: SourceId) =>
    pairResults.find((p) => p.key === pairKey(a, b))!.result;

  const current = getResult(activePair[0], activePair[1]);
  const confirmation = api.findConfirmation(activePair[0], activePair[1]);
  const stale = confirmation ? confirmation.fingerprint !== fp : false;

  // 切换核对对时恢复备注
  useEffect(() => {
    setComment(confirmation?.comment ?? '');
    setShowCross(false);
    setHandoffOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePair, state.confirmations.length]);

  const derivedPd = useMemo(
    () => ({
      A: derivePdChecks(state.sources[activePair[0]], state.tolerance),
      B: derivePdChecks(state.sources[activePair[1]], state.tolerance),
    }),
    [state.sources, activePair, state.tolerance],
  );

  const doConfirm = (status: PairConfirmStatus) => {
    api.confirm(activePair[0], activePair[1], status, comment.trim(), fp);
    notify(`已记录：${CONFIRM_LABELS[status]}；若再改动数据，该确认会立即作废`);
  };

  const resetAll = async () => {
    if (!window.confirm('确定清空本机保存的全部抄录、凭据图片和确认记录吗？此操作不可恢复。')) return;
    api.resetAll();
    await clearState();
    await clearImages();
    notify('已清空全部本地数据');
  };

  const handoff = useMemo(
    () =>
      buildHandoff(
        { a: activePair[0], b: activePair[1] },
        current,
        confirmation
          ? {
              status: confirmation.status,
              comment: confirmation.comment,
              confirmedAt: confirmation.confirmedAt,
              fingerprint: confirmation.fingerprint,
            }
          : undefined,
        fp,
      ),
    [activePair, current, confirmation, fp, state.lensType],
  );

  const downloadHandoff = () => {
    const blob = new Blob([JSON.stringify(handoff, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `取镜交接单_${activePair[0]}-${activePair[1]}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('交接单 JSON 已下载（仅含来源、争议字段、确认状态）');
  };

  const nameA = SOURCE_LABELS[activePair[0]];
  const nameB = SOURCE_LABELS[activePair[1]];

  return (
    <div>
      <header>
        <h1>取镜核对台 · 老花镜 / 渐进镜</h1>
        <p className="muted">
          逐字抄录三张单据，按镜框左右逐项对照。所有抄录和凭据图片<b>只保存在本机浏览器</b>，不联网、不评价处方是否适合佩戴。
        </p>
      </header>

      <div className="banner">
        <b>给取镜长辈的三句话：</b>
        ① 看不清就标“看不清”，不要猜；② 镜袋上的 R = 右眼 OD、L = 左眼 OS；
        ③ 系统提示“疑似左右互换”时，先别戴，找店员当面确认。
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist">
          <button className={tab === 'entry' ? 'active' : ''} onClick={() => setTab('entry')}>
            1 · 抄录单据
          </button>
          <button className={tab === 'check' ? 'active' : ''} onClick={() => setTab('check')}>
            2 · 镜框核对
          </button>
          <button className={tab === 'credentials' ? 'active' : ''} onClick={() => setTab('credentials')}>
            3 · 凭据图片
          </button>
        </div>
        <button onClick={api.undo} disabled={!api.canUndo}>
          ↩ 撤销误录（{state.history.length}）
        </button>
        <button className="danger" onClick={() => void resetAll()}>
          清空全部本地数据
        </button>
      </div>

      {/* ---------------- 标签页 1：抄录 ---------------- */}
      {tab === 'entry' && (
        <div className="panel">
          <div className="toolbar" style={{ margin: '0 0 8px' }}>
            <div className="seg">
              <button
                className={state.lensType === 'reading' ? 'active' : ''}
                onClick={() => api.setLensType('reading')}
              >
                老花镜（单光，看近）
              </button>
              <button
                className={state.lensType === 'progressive' ? 'active' : ''}
                onClick={() => api.setLensType('progressive')}
              >
                渐进镜（远 / 近两用）
              </button>
            </div>
          </div>

          <div className="src-tabs">
            {(['rx', 'job', 'pack'] as SourceId[]).map((id) => (
              <button
                key={id}
                className={`src-tab${activeSource === id ? ' active' : ''}`}
                onClick={() => setActiveSource(id)}
              >
                {SOURCE_LABELS[id]}
              </button>
            ))}
          </div>

          <SourceEntry
            doc={state.sources[activeSource]}
            title={SOURCE_LABELS[activeSource]}
            lensType={state.lensType}
            onChange={api.setSource}
          />
        </div>
      )}

      {/* ---------------- 标签页 3：凭据 ---------------- */}
      {tab === 'credentials' && (
        <div className="panel">
          <div className="src-tabs">
            {(['rx', 'job', 'pack'] as SourceId[]).map((id) => (
              <button
                key={id}
                className={`src-tab${activeSource === id ? ' active' : ''}`}
                onClick={() => setActiveSource(id)}
              >
                {SOURCE_LABELS[id]}
              </button>
            ))}
          </div>
          <ImagePanel
            source={activeSource}
            images={state.images}
            onAddMeta={api.addImageMeta}
            onRemoveMeta={api.removeImageMeta}
            notify={notify}
          />
        </div>
      )}

      {/* ---------------- 标签页 2：核对 ---------------- */}
      {tab === 'check' && (
        <>
          <div className="panel">
            <h2>选择要对照的两张单据</h2>
            <div className="pair-select" style={{ marginTop: 10 }}>
              {PAIRS.map(([a, b]) => {
                const r = getResult(a, b);
                const c = api.findConfirmation(a, b);
                const isStale = c ? c.fingerprint !== fp : false;
                return (
                  <button
                    key={pairKey(a, b)}
                    className={`src-tab${activePair[0] === a && activePair[1] === b ? ' active' : ''}`}
                    onClick={() => setActivePair([a, b])}
                  >
                    {SOURCE_LABELS[a]} ⇄ {SOURCE_LABELS[b]}
                    {c && !isStale && <span> · {CONFIRM_LABELS[c.status]}</span>}
                    {c && isStale && <span> · 旧确认已作废</span>}
                    {!c && r.swapSuspected && <span> · 疑似互换</span>}
                  </button>
                );
              })}
            </div>

            <div className="legend" style={{ marginTop: 12 }}>
              <span className="badge match">绿 = 一致</span>
              <span className="badge mismatch">红 = 不符</span>
              <span className="badge unknown">灰 = 资料不足，不判定</span>
              <span className="badge swap">橙 = 疑似左右互换</span>
            </div>

            <div className="tol-row small">
              <b>允许差值：</b>
              <label>
                球/柱/ADD
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={state.tolerance.power}
                  onChange={(e) =>
                    api.setTolerance({ ...state.tolerance, power: Number(e.target.value) || 0 })
                  }
                />
                D
              </label>
              <label>
                轴位
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={state.tolerance.axis}
                  onChange={(e) =>
                    api.setTolerance({ ...state.tolerance, axis: Number(e.target.value) || 0 })
                  }
                />
                °
              </label>
              <label>
                瞳距
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={state.tolerance.pd}
                  onChange={(e) =>
                    api.setTolerance({ ...state.tolerance, pd: Number(e.target.value) || 0 })
                  }
                />
                mm
              </label>
              <span className="muted">默认 0 = 必须严格一致；修改容差也会使旧确认作废。</span>
            </div>
          </div>

          {current.swapSuspected && (
            <div className="swap-box">
              <h3>⚠ 疑似左右互换（本侧不符，交叉后相符）</h3>
              <ol className="steps">
                <li>
                  <b>第 1 步 · 本侧核对（{nameA}的右眼对{nameB}的右眼）</b>
                  <div>
                    {(['OD', 'OS'] as const).map((eye) => {
                      const v = eye === 'OD' ? current.same.verdictOD : current.same.verdictOS;
                      const fields = eye === 'OD' ? current.same.OD : current.same.OS;
                      const bad = fields.filter((f) => f.verdict === 'mismatch');
                      return (
                        <div key={eye} className="small">
                          {eye === 'OD' ? '右眼' : '左眼'}：
                          {v === 'mismatch' ? (
                            <>
                              <b>不符</b>（
                              {bad.map((f) => `${f.rawA || '空'} ↔ ${f.rawB || '空'}`).join('，')}）
                            </>
                          ) : v === 'match' ? (
                            '相符'
                          ) : (
                            '资料不足无法判定'
                          )}
                        </div>
                      );
                    })}
                  </div>
                </li>
                <li>
                  <b>第 2 步 · 交叉核对（左右对调：A.右↔B.左，A.左↔B.右）</b>
                  <div>
                    {(['OD', 'OS'] as const).map((eye) => {
                      const v = eye === 'OD' ? current.cross.verdictOD : current.cross.verdictOS;
                      const fields = eye === 'OD' ? current.cross.OD : current.cross.OS;
                      const matched = fields.filter((f) => f.verdict === 'match' && f.rawA.trim() !== '');
                      return (
                        <div key={eye} className="small">
                          {eye === 'OD' ? 'A.右眼 ↔ B.左眼' : 'A.左眼 ↔ B.右眼'}：
                          {v === 'match' ? (
                            <>
                              <b>相符</b>（{matched.map((f) => `${f.rawA}=${f.rawB}`).join('，')}）
                            </>
                          ) : v === 'mismatch' ? (
                            '仍不符'
                          ) : (
                            '资料不足无法判定'
                          )}
                        </div>
                      );
                    })}
                  </div>
                </li>
                <li>
                  <b>第 3 步 · 结论（仅提示，不替您认定）</b>
                  <div>{current.swapDetail}</div>
                </li>
              </ol>
              <button className="big" onClick={() => setShowCross((v) => !v)}>
                {showCross ? '收起交叉镜框对照' : '查看交叉（左右对调）镜框对照'}
              </button>
              <p className="small muted" style={{ marginTop: 8 }}>
                请核对镜袋上的 R/L 标记，或请店员当面确认后，再按下方“确认左右互换”按钮。
              </p>
            </div>
          )}

          {stale && (
            <div className="stale-note">
              旧的确认结论已作废：数据在上次确认之后被修改过（含撤销恢复）。请重新核对后再确认。
            </div>
          )}

          <h2 style={{ margin: '16px 4px 0' }}>
            {nameA} → {nameB}：左右镜框逐项对照
          </h2>
          <div className="frames">
            <FrameCard
              eye="OD"
              fields={current.same.OD}
              verdict={current.same.verdictOD}
              comparableCount={current.same.comparableCountOD}
              nameA={nameA}
              nameB={nameB}
              transSteps={current.same.transOD}
              transNote={current.same.transNoteOD}
            />
            <FrameCard
              eye="OS"
              fields={current.same.OS}
              verdict={current.same.verdictOS}
              comparableCount={current.same.comparableCountOS}
              nameA={nameA}
              nameB={nameB}
              transSteps={current.same.transOS}
              transNote={current.same.transNoteOS}
            />
          </div>

          <div className="panel">
            <h3>双眼瞳距核对</h3>
            <div className="field-row" style={{ gridTemplateColumns: '130px 1fr 1fr' }}>
              <div className="fname">双眼瞳距 PD</div>
              <div className={`cell ${current.pdBinocular.verdict}`}>
                <span className="cap">原值：{current.pdBinocular.rawA || '（空）'}</span>
                <span className="val">{current.pdBinocular.canonA}</span>
              </div>
              <div className={`cell ${current.pdBinocular.verdict}`}>
                <span className="cap">原值：{current.pdBinocular.rawB || '（空）'}</span>
                <span className="val">{current.pdBinocular.canonB}</span>
                <div className="why">{current.pdBinocular.reason}</div>
              </div>
            </div>

            {[
              { tag: nameA, rows: derivedPd.A },
              { tag: nameB, rows: derivedPd.B },
            ].map((g) =>
              g.rows.map((r, i) => (
                <p key={`${g.tag}-${i}`}>
                  <span className={`badge ${r.verdict}`}>{g.tag}</span>{' '}
                  {r.reason}
                </p>
              )),
            )}
          </div>

          {showCross && (
            <div className="panel">
              <h3>交叉对照（A.右眼 对 B.左眼、A.左眼 对 B.右眼）</h3>
              <div className="frames">
                <FrameCard
                  eye="OD"
                  cross
                  fields={current.cross.OD}
                  verdict={current.cross.verdictOD}
                  comparableCount={current.cross.comparableCountOD}
                  nameA={`${nameA}·右`}
                  nameB={`${nameB}·左`}
                  transSteps={current.cross.transOD}
                  transNote={current.cross.transNoteOD}
                />
                <FrameCard
                  eye="OS"
                  cross
                  fields={current.cross.OS}
                  verdict={current.cross.verdictOS}
                  comparableCount={current.cross.comparableCountOS}
                  nameA={`${nameA}·左`}
                  nameB={`${nameB}·右`}
                  transSteps={current.cross.transOS}
                  transNote={current.cross.transNoteOS}
                />
              </div>
            </div>
          )}

          <div className="panel">
            <h3>人工确认（结论以您的确认为准）</h3>
            {confirmation && !stale && (
              <p>
                当前确认：<b>{CONFIRM_LABELS[confirmation.status]}</b>
                <span className="small muted">
                  {' '}
                  于 {new Date(confirmation.confirmedAt).toLocaleString()}
                </span>
              </p>
            )}
            <textarea
              className="comment"
              placeholder="可备注争议情况，如：右眼轴位差 5°，已请店员与加工房核对……"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="confirm-bar">
              <button className="primary big" onClick={() => doConfirm('consistent')}>
                确认一致，可交接
              </button>
              <button className="big" onClick={() => doConfirm('difference')}>
                确认存在差异
              </button>
              <button
                className="big"
                disabled={!current.swapSuspected}
                title={current.swapSuspected ? '' : '仅在系统提示疑似互换时使用'}
                onClick={() => doConfirm('swap')}
              >
                确认左右互换
              </button>
              <button className="big" onClick={() => setHandoffOpen((v) => !v)}>
                生成 / 预览交接单 JSON
              </button>
            </div>

            {handoffOpen && (
              <div style={{ marginTop: 12 }}>
                <textarea className="handoff-view" readOnly value={JSON.stringify(handoff, null, 2)} />
                <div className="toolbar" style={{ margin: '8px 0 0' }}>
                  <button className="primary" onClick={downloadHandoff}>
                    下载交接单 .json
                  </button>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(JSON.stringify(handoff, null, 2));
                      notify('已复制到剪贴板');
                    }}
                  >
                    复制全文
                  </button>
                </div>
                <p className="small muted">
                  交接单仅包含来源、争议字段（原值与差异说明）、确认状态及时间，不含完整处方、不含凭据图片，
                  也不包含任何“适不适合佩戴”的评价。
                </p>
              </div>
            )}
          </div>
        </>
      )}

      <footer className="small muted" style={{ marginTop: 24 }}>
        核对规则：球镜+柱镜+轴位作为球柱镜组联合判定，自动识别正/负柱镜等价记法（球柱相加、柱镜变号、轴位转
        90°）；轴位按 180° 周期比较（0° 与 180° 等价）；标记为看不清 / 未提供的字段不参与判定。
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

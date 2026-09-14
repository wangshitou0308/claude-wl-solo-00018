import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type {
  AppState,
  CredentialImage,
  Eye,
  LensType,
  PairConfirmStatus,
  SourceDocument,
  SourceId,
  Tolerance,
} from '../types';
import { emptySourceDocument } from './compare';
import { saveState } from './db';

export const DEFAULT_TOLERANCE: Tolerance = { power: 0, axis: 0, pd: 0 };

const HISTORY_LIMIT = 60;

export function createInitialState(): AppState {
  return {
    lensType: 'reading',
    tolerance: DEFAULT_TOLERANCE,
    sources: {
      rx: emptySourceDocument('rx'),
      job: emptySourceDocument('job'),
      pack: emptySourceDocument('pack'),
    },
    images: [],
    confirmations: [],
    updatedAt: Date.now(),
    history: [],
  };
}

type Action =
  | { type: 'setLensType'; lensType: LensType }
  | { type: 'setTolerance'; tolerance: Tolerance }
  | { type: 'addImageMeta'; image: CredentialImage }
  | { type: 'removeImageMeta'; id: string }
  | { type: 'confirm'; a: SourceId; b: SourceId; status: PairConfirmStatus; comment: string; fp: string }
  | { type: 'resetAll' }
  | { type: 'hydrate'; state: AppState }
  | { type: 'undo' };

function pushHistory(state: AppState): AppState[] {
  const snapshot: AppState = { ...state, history: [] };
  const next = [...state.history, snapshot];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
      return { ...action.state, history: [] };

    case 'undo': {
      if (state.history.length === 0) return state;
      const previous = state.history[state.history.length - 1];
      return {
        ...previous,
        history: state.history.slice(0, -1),
      };
    }

    case 'resetAll':
      return { ...createInitialState() };

    case 'setLensType':
      return {
        ...state,
        history: pushHistory(state),
        lensType: action.lensType,
        updatedAt: Date.now(),
      };

    case 'setTolerance':
      return {
        ...state,
        history: pushHistory(state),
        tolerance: action.tolerance,
        updatedAt: Date.now(),
      };

    case 'addImageMeta':
      return { ...state, images: [...state.images, action.image], updatedAt: Date.now() };

    case 'removeImageMeta':
      return {
        ...state,
        images: state.images.filter((i) => i.id !== action.id),
        updatedAt: Date.now(),
      };

    case 'confirm': {
      const others = state.confirmations.filter((c) => !(c.a === action.a && c.b === action.b));
      return {
        ...state,
        history: pushHistory(state),
        confirmations: [
          ...others,
          {
            a: action.a,
            b: action.b,
            status: action.status,
            comment: action.comment,
            fingerprint: action.fp,
            confirmedAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      };
    }

    default:
      return state;
  }
}

/** 带文档 id 的更新动作（在 reducer 中直接替换对应来源） */
type ActionExt = Action | { type: 'setSource'; doc: SourceDocument };

function reducerExt(state: AppState, action: ActionExt): AppState {
  if (action.type === 'setSource') {
    return {
      ...state,
      history: pushHistory(state),
      sources: { ...state.sources, [action.doc.id]: action.doc },
      updatedAt: Date.now(),
    };
  }
  return reducer(state, action);
}

export function useAppState() {
  const [state, dispatch] = useReducer(reducerExt, undefined, createInitialState);
  const hydrated = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // 变更后防抖写入 IndexedDB（hydrate 当次不回写）
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveState(state);
    }, 250);
  }, [state]);

  const hydrate = useCallback((s: AppState) => {
    hydrated.current = true;
    dispatch({ type: 'hydrate', state: s });
  }, []);

  const markHydrated = useCallback(() => {
    hydrated.current = true;
  }, []);

  const setLensType = useCallback((lensType: LensType) => dispatch({ type: 'setLensType', lensType }), []);
  const setTolerance = useCallback((tolerance: Tolerance) => dispatch({ type: 'setTolerance', tolerance }), []);
  const setSource = useCallback((doc: SourceDocument) => dispatch({ type: 'setSource', doc }), []);
  const addImageMeta = useCallback((image: CredentialImage) => dispatch({ type: 'addImageMeta', image }), []);
  const removeImageMeta = useCallback((id: string) => dispatch({ type: 'removeImageMeta', id }), []);
  const confirm = useCallback(
    (a: SourceId, b: SourceId, status: PairConfirmStatus, comment: string, fp: string) =>
      dispatch({ type: 'confirm', a, b, status, comment, fp }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const resetAll = useCallback(() => dispatch({ type: 'resetAll' }), []);

  const canUndo = state.history.length > 0;

  const findConfirmation = useCallback(
    (a: SourceId, b: SourceId) => state.confirmations.find((c) => c.a === a && c.b === b),
    [state.confirmations],
  );

  return useMemo(
    () => ({
      state,
      hydrate,
      markHydrated,
      setLensType,
      setTolerance,
      setSource,
      addImageMeta,
      removeImageMeta,
      confirm,
      undo,
      canUndo,
      resetAll,
      findConfirmation,
    }),
    [
      state,
      hydrate,
      markHydrated,
      setLensType,
      setTolerance,
      setSource,
      addImageMeta,
      removeImageMeta,
      confirm,
      undo,
      canUndo,
      resetAll,
      findConfirmation,
    ],
  );
}

export type AppStateApi = ReturnType<typeof useAppState>;

export const EYE_NAME: Record<Eye, string> = { OD: '右眼 OD', OS: '左眼 OS' };

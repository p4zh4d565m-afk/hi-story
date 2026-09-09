import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConfirmCreativeDecisionsInput,
  CreativeDecision,
  CreativeDecisionDraft,
  CreativeDecisionEffect,
  CreativeDecisionRelatedItems,
  IpcResult,
  UpdateCreativeDecisionProposalInput,
} from '../types';

interface CreativeDecisionPanelProps {
  projectId: string;
  decisions: CreativeDecision[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onCommitted: (effects: CreativeDecisionEffect[]) => void | Promise<void>;
}

const TYPE_LABELS: Record<CreativeDecision['type'], string> = {
  story_fact: '故事事实',
  character_knowledge: '人物知识',
  narrative_hook: '叙事钩子',
  narrative_debt: '叙事债务',
};

const STATUS_LABELS: Record<CreativeDecision['status'], string> = {
  proposed: '待确认',
  confirmed: '已确认',
  rejected: '已拒绝',
  superseded: '已被修订',
};

const TARGET_LABELS: Record<CreativeDecisionEffect['targetTable'], string> = {
  story_facts: '故事事实',
  character_knowledge: '人物知识',
  narrative_hooks: '叙事钩子',
  narrative_debts: '叙事债务',
};

const FACT_TYPE_OPTIONS = [
  ['location', '位置'], ['possession', '持有物'], ['relationship', '关系'],
  ['knowledge', '已知事实'], ['event', '事件'], ['emotional_state', '情绪状态'],
] as const;
const HOOK_TYPE_OPTIONS = [
  ['cliffhanger', '断章钩子'], ['foreshadowing', '伏笔'], ['promise', '读者承诺'],
  ['mystery', '悬念'], ['emotional_hook', '情感钩子'],
] as const;
const DEBT_TYPE_OPTIONS = [
  ['reveal', '真相揭示'], ['payoff', '伏笔回收'], ['character_return', '角色回归'],
  ['mystery_answer', '谜底揭晓'], ['power_up', '能力升级'],
] as const;

const CreativeDecisionPanel: React.FC<CreativeDecisionPanelProps> = ({
  projectId,
  decisions,
  onClose,
  onChanged,
  onCommitted,
}) => {
  const [drafts, setDrafts] = useState<Record<string, CreativeDecisionDraft>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committedEffects, setCommittedEffects] = useState<CreativeDecisionEffect[]>([]);
  // 用对象身份记录每次项目代次，防止 A→B→A 接受第一次 A 的回执。
  const activeProjectIdRef = useRef({ projectId });
  const lock = useRef(false);
  if (activeProjectIdRef.current.projectId !== projectId) {
    activeProjectIdRef.current = { projectId };
    lock.current = false;
  }
  const [related, setRelated] = useState<{ title: string; items: CreativeDecisionRelatedItems } | null>(null);
  const chooseRef = useRef<((choice: string | null) => void) | null>(null);
  const [revision, setRevision] = useState<{ parentId: string; draft: CreativeDecisionDraft } | null>(null);
  useEffect(() => () => {
    activeProjectIdRef.current = { projectId };
    chooseRef.current?.('cancel');
    chooseRef.current = null;
  }, [projectId]);

  useEffect(() => {
    setBusyId(null);
    setError(null);
    setCommittedEffects([]);
    setDirtyIds(new Set());
    setRelated(null);
    setRevision(null);
  }, [projectId]);

  useEffect(() => {
    setDrafts(current => Object.fromEntries(decisions.map(item => [
      item.id,
      item.status === 'proposed' && dirtyIds.has(item.id) && current[item.id]
        ? current[item.id]
        : toDraft(item),
    ])));
    setDirtyIds(current => new Set(
      [...current].filter(id => decisions.some(item => item.id === id && item.status === 'proposed')),
    ));
  }, [decisions]);

  const proposed = useMemo(
    () => decisions.filter(item => item.status === 'proposed'),
    [decisions],
  );
  const history = useMemo(
    () => decisions.filter(item => item.status !== 'proposed'),
    [decisions],
  );

  const changeDraft = (decisionId: string, updater: (draft: CreativeDecisionDraft) => CreativeDecisionDraft) => {
    setDrafts(current => ({ ...current, [decisionId]: updater(current[decisionId]) }));
    setDirtyIds(current => new Set(current).add(decisionId));
    setError(null);
  };

  const updateCommon = (
    decisionId: string,
    field: 'title' | 'rationale',
    value: string,
  ) => changeDraft(decisionId, draft => ({ ...draft, [field]: value }));

  const updatePayload = (
    decisionId: string,
    field: string,
    value: string | number | null,
  ) => changeDraft(decisionId, draft => ({
    ...draft,
    payload: { ...draft.payload, [field]: value },
  } as CreativeDecisionDraft));

  const save = async (decisionId: string): Promise<boolean> => {
    if (lock.current) return false;
    const draft = drafts[decisionId];
    if (!draft) return false;
    const operationProjectId = activeProjectIdRef.current;
    lock.current = true;
    setBusyId(decisionId);
    setError(null);
    try {
      const input: UpdateCreativeDecisionProposalInput = { projectId, decisionId, draft };
      const response = await window.electronAPI.invoke(
        'db:creativeDecisions:updateProposal', input,
      ) as IpcResult<CreativeDecision>;
      if (activeProjectIdRef.current !== operationProjectId) return false;
      if (!response.success || !response.data) throw new Error(response.error || '保存修改失败');
      setDrafts(current => ({ ...current, [decisionId]: toDraft(response.data!) }));
      setDirtyIds(current => {
        const next = new Set(current);
        next.delete(decisionId);
        return next;
      });
      await onChanged();
      return true;
    } catch (saveError) {
      if (activeProjectIdRef.current !== operationProjectId) return false;
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    } finally {
      if (activeProjectIdRef.current === operationProjectId) { lock.current = false; setBusyId(null); }
    }
  };

  const reject = async (decisionId: string) => {
    if (lock.current) return;
    const operationProjectId = activeProjectIdRef.current;
    lock.current = true;
    setBusyId(decisionId);
    setError(null);
    try {
      const response = await window.electronAPI.invoke(
        'db:creativeDecisions:reject', projectId, decisionId,
      ) as IpcResult<CreativeDecision>;
      if (activeProjectIdRef.current !== operationProjectId) return;
      if (!response.success) throw new Error(response.error || '拒绝决策失败');
      await onChanged();
    } catch (rejectError) {
      if (activeProjectIdRef.current !== operationProjectId) return;
      setError(rejectError instanceof Error ? rejectError.message : String(rejectError));
    } finally {
      if (activeProjectIdRef.current === operationProjectId) { lock.current = false; setBusyId(null); }
    }
  };

  const confirm = async (decisionIds: string[]) => {
    if (lock.current) return;
    if (decisionIds.some(id => dirtyIds.has(id))) {
      setError('请先保存修改，再确认写入');
      return;
    }
    const operationProjectId = activeProjectIdRef.current;
    lock.current = true;
    setBusyId(decisionIds.length === 1 ? decisionIds[0] : 'all');
    setError(null);
    try {
      const selected: string[] = [];
      for (const decisionId of decisionIds) {
        const savedDecision = decisions.find(item => item.id === decisionId);
        const draft = drafts[decisionId] ?? (savedDecision ? toDraft(savedDecision) : undefined);
        if (!draft) throw new Error('候选尚未加载');
        if ((draft.type === 'narrative_hook' || draft.type === 'narrative_debt') && !draft.payload.subject?.trim()) {
          throw new Error('请先补填主体并保存修改');
        }
        if (!draft.payload.targetId) {
          const result = await window.electronAPI.invoke('db:creativeDecisions:findRelatedItems', { projectId, decisionId }) as IpcResult<CreativeDecisionRelatedItems>;
          if (activeProjectIdRef.current !== operationProjectId) return;
          if (!result.success || !result.data) throw new Error(result.error || '疑似相关项查询失败');
          if (result.data.matches.length || result.data.knowledge.length || result.data.missingSubject.length) {
            const targetId = await new Promise<string | null>(resolve => {
              chooseRef.current = resolve;
              setRelated({ title: draft.title, items: result.data! });
            });
            if (activeProjectIdRef.current !== operationProjectId) return;
            if (targetId === 'cancel') continue;
            const chosen = { ...draft, payload: { ...draft.payload, targetId } } as CreativeDecisionDraft;
            setDrafts(current => ({ ...current, [decisionId]: chosen }));
            setDirtyIds(current => new Set(current).add(decisionId));
            const saved = await window.electronAPI.invoke('db:creativeDecisions:updateProposal', { projectId, decisionId, draft: chosen }) as IpcResult<CreativeDecision>;
            if (activeProjectIdRef.current !== operationProjectId) return;
            if (!saved.success || !saved.data) throw new Error(saved.error || '选择保存失败');
            setDirtyIds(current => { const next = new Set(current); next.delete(decisionId); return next; });
          }
        }
        selected.push(decisionId);
      }
      if (!selected.length) return;
      const input: ConfirmCreativeDecisionsInput = { projectId, decisionIds: selected };
      const response = await window.electronAPI.invoke(
        'db:creativeDecisions:confirmMany', input,
      ) as IpcResult<{ decisions: CreativeDecision[]; effects: CreativeDecisionEffect[] }>;
      if (activeProjectIdRef.current !== operationProjectId) return;
      if (!response.success || !response.data) {
        throw new Error(response.error || '确认写入失败');
      }
      await onCommitted(response.data.effects);
      if (activeProjectIdRef.current !== operationProjectId) return;
      setCommittedEffects(response.data.effects);
      await onChanged();
    } catch (confirmError) {
      if (activeProjectIdRef.current !== operationProjectId) return;
      const message = confirmError instanceof Error ? confirmError.message : String(confirmError);
      setError(`写入失败，可重试：${message}`);
    } finally {
      if (activeProjectIdRef.current === operationProjectId) { lock.current = false; setBusyId(null); }
    }
  };

  const choose = (choice: string | null) => {
    const resolve = chooseRef.current;
    chooseRef.current = null;
    setRelated(null);
    resolve?.(choice);
  };

  const prepareRevision = async (parentId: string) => {
    if (lock.current) return;
    const generation = activeProjectIdRef.current;
    lock.current = true; setBusyId(parentId); setError(null);
    try {
      const result = await window.electronAPI.invoke('db:creativeDecisions:prepareRevision', projectId, parentId) as IpcResult<CreativeDecisionDraft>;
      if (activeProjectIdRef.current !== generation) return;
      if (!result.success || !result.data) throw new Error(result.error || '修订预填失败');
      setRevision({ parentId, draft: result.data });
    } catch (error) {
      if (activeProjectIdRef.current === generation) setError(String(error));
    } finally {
      if (activeProjectIdRef.current === generation) { lock.current = false; setBusyId(null); }
    }
  };

  const createRevision = async () => {
    if (!revision || lock.current) return;
    const generation = activeProjectIdRef.current;
    lock.current = true; setBusyId(revision.parentId); setError(null);
    try {
      const result = await window.electronAPI.invoke('db:creativeDecisions:createRevision', {
        projectId, parentDecisionId: revision.parentId, draft: revision.draft,
      }) as IpcResult<CreativeDecision>;
      if (activeProjectIdRef.current !== generation) return;
      if (!result.success || !result.data) throw new Error(result.error || '创建修订失败');
      setRevision(null);
      await onChanged();
    } catch (error) {
      if (activeProjectIdRef.current === generation) setError(String(error));
    } finally {
      if (activeProjectIdRef.current === generation) { lock.current = false; setBusyId(null); }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl max-h-[90vh] bg-aichat-900 border border-aichat-700 rounded-xl shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-aichat-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">创作决策确认</h3>
            <p className="text-xs text-gray-500 mt-1">只有确认成功的项目才会写入小说运行时状态</p>
          </div>
          <button onClick={() => { if (!lock.current) onClose(); }} disabled={busyId !== null}
            className="text-gray-400 hover:text-white disabled:opacity-50" aria-label="关闭决策面板">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {related && <section role="dialog" aria-label="疑似相关项提示" className="border border-amber-700 rounded p-4 space-y-3">
            <h4>疑似相关项提示 · {related.title}</h4>
            {([
              ['疑似相关项', related.items.matches],
              ['相关已有条目', related.items.knowledge],
              ['同类活跃项（缺少主体，无法自动配对）', related.items.missingSubject],
            ] as const).map(([label, items]) => items.length > 0 && <div key={label}>
              <h5>{label}</h5>
              {items.map(item => <div key={`${item.targetTable}:${item.id}`} className="my-2 text-sm">
                {item.subject} · {item.description} <button onClick={() => choose(item.id)}>修订此项</button>
              </div>)}
            </div>)}
            <button onClick={() => choose(null)} className="mr-4">作为独立项确认</button>
            <button onClick={() => choose('cancel')}>取消确认</button>
          </section>}
          {revision && <section role="dialog" aria-label="修订草稿" className="border border-accent rounded p-4 space-y-3">
            <h4>修订草稿 · 将修订 {revision.draft.payload.targetId}</h4>
            <TextField label="修订标题" value={revision.draft.title} disabled={busyId !== null}
              onChange={title => setRevision(current => current && ({ ...current, draft: { ...current.draft, title } }))} />
            <TextField label="修订理由" value={revision.draft.rationale} disabled={busyId !== null}
              onChange={rationale => setRevision(current => current && ({ ...current, draft: { ...current.draft, rationale } }))} />
            <DecisionPayloadFields decisionId={revision.parentId} draft={revision.draft} disabled={busyId !== null}
              updatePayload={(_id, field, value) => setRevision(current => current && ({ ...current,
                draft: { ...current.draft, payload: { ...current.draft.payload, [field]: value } } as CreativeDecisionDraft,
              }))} />
            <button onClick={() => void createRevision()} disabled={busyId !== null || !revision.draft.title.trim() ||
              ((revision.draft.type === 'narrative_hook' || revision.draft.type === 'narrative_debt') && !revision.draft.payload.subject?.trim())}>保存修订提议</button>
            <button disabled={busyId !== null} onClick={() => setRevision(null)} className="ml-4">取消修订</button>
          </section>}
          {committedEffects.length > 0 && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-emerald-200">
              <div className="font-medium mb-2">写入成功</div>
              {committedEffects.map(effect => (
                <div key={effect.id}>
                  {TARGET_LABELS[effect.targetTable]} · {effect.operation === 'insert' ? '新增' : '更新'} · {effect.targetId}
                </div>
              ))}
            </div>
          )}
          {proposed.length === 0 && (
            <div className="text-center text-sm text-gray-500 py-12">当前没有待确认决策</div>
          )}
          {proposed.map(decision => {
            const draft = drafts[decision.id] ?? toDraft(decision);
            const isBusy = busyId !== null || revision !== null;
            return (
              <section key={decision.id} className="border border-aichat-700 rounded-lg p-4 space-y-3 bg-aichat-800/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs px-2 py-1 rounded bg-accent/20 text-accent">
                    {TYPE_LABELS[draft.type]}
                  </span>
                  {dirtyIds.has(decision.id) && <span className="text-xs text-amber-400">有未保存修改</span>}
                </div>

                <label className="block text-xs text-gray-400">
                  标题
                  <input
                    aria-label="决策标题"
                    value={draft.title}
                    onChange={event => updateCommon(decision.id, 'title', event.target.value)}
                    disabled={isBusy}
                    className="mt-1 w-full rounded bg-aichat-900 border border-aichat-700 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block text-xs text-gray-400">
                  确认理由
                  <textarea
                    aria-label="决策理由"
                    value={draft.rationale}
                    onChange={event => updateCommon(decision.id, 'rationale', event.target.value)}
                    disabled={isBusy}
                    rows={2}
                    className="mt-1 w-full rounded bg-aichat-900 border border-aichat-700 px-3 py-2 text-sm text-white resize-y"
                  />
                </label>

                <DecisionPayloadFields
                  decisionId={decision.id}
                  draft={draft}
                  updatePayload={updatePayload}
                  disabled={isBusy}
                />
                {draft.payload.targetId && <p className="text-xs text-amber-300">将修订 {TARGET_LABELS[decision.type === 'story_fact' ? 'story_facts' : decision.type === 'narrative_hook' ? 'narrative_hooks' : decision.type === 'narrative_debt' ? 'narrative_debts' : 'character_knowledge']} · {draft.payload.targetId}</p>}
                {!decision.parentDecisionId && draft.payload.targetId && dirtyIds.has(decision.id) &&
                  draft.payload.targetId !== decision.payload.targetId && <button
                    disabled={isBusy} className="text-xs text-amber-300"
                    onClick={() => updatePayload(decision.id, 'targetId', null)}>
                    清除未保存的修订目标
                  </button>}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => void reject(decision.id)}
                    disabled={isBusy}
                    className="px-3 py-1.5 text-xs text-red-300 border border-red-900 rounded disabled:opacity-50"
                  >
                    拒绝
                  </button>
                  <button
                    onClick={() => void save(decision.id)}
                    disabled={isBusy || !dirtyIds.has(decision.id)}
                    className="px-3 py-1.5 text-xs text-gray-200 border border-aichat-600 rounded disabled:opacity-50"
                  >
                    保存修改
                  </button>
                  <button
                    onClick={() => void confirm([decision.id])}
                    disabled={isBusy || dirtyIds.has(decision.id)}
                    className="px-3 py-1.5 text-xs text-white bg-accent rounded disabled:opacity-50"
                  >
                    确认此项
                  </button>
                </div>
              </section>
            );
          })}
          {history.length > 0 && (
            <section className="border-t border-aichat-700 pt-4 space-y-2">
              <h4 className="text-xs font-medium text-gray-400">账本历史</h4>
              {history.map(decision => (
                <div key={decision.id} className="rounded border border-aichat-700 bg-aichat-800/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-200">{decision.title}</span>
                    <span className="text-xs text-gray-500">{STATUS_LABELS[decision.status]}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{TYPE_LABELS[decision.type]} · {decision.rationale}</div>
                  {decision.status === 'confirmed' && <button disabled={busyId !== null || revision !== null}
                    onClick={() => void prepareRevision(decision.id)} className="text-xs text-accent mt-2">创建修订</button>}
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-aichat-700 flex items-center justify-between gap-4">
          <div className="text-xs text-red-400">{error}</div>
          <button
            onClick={() => void confirm(proposed.map(item => item.id))}
            disabled={proposed.length === 0 || busyId !== null || dirtyIds.size > 0 || revision !== null}
            className="px-4 py-2 text-xs bg-accent text-white rounded disabled:opacity-50"
          >
            全部确认
          </button>
        </div>
      </div>
    </div>
  );
};

interface DecisionPayloadFieldsProps {
  decisionId: string;
  draft: CreativeDecisionDraft;
  updatePayload: (decisionId: string, field: string, value: string | number | null) => void;
  disabled: boolean;
}

const DecisionPayloadFields: React.FC<DecisionPayloadFieldsProps> = ({
  decisionId,
  draft,
  updatePayload,
  disabled,
}) => {
  const inputClass = 'mt-1 w-full rounded bg-aichat-900 border border-aichat-700 px-3 py-2 text-sm text-white';
  if (draft.type === 'story_fact') {
    return <div className="grid grid-cols-2 gap-3">
      <SelectField label="事实类型" value={draft.payload.factType} options={FACT_TYPE_OPTIONS}
        onChange={value => updatePayload(decisionId, 'factType', value)} disabled={disabled} />
      <TextField label="主体" value={draft.payload.subject} onChange={value => updatePayload(decisionId, 'subject', value)} disabled={disabled} />
      <TextField label="关系/动作" value={draft.payload.predicate} onChange={value => updatePayload(decisionId, 'predicate', value)} disabled={disabled} />
      <TextField label="对象/结果" value={draft.payload.object} onChange={value => updatePayload(decisionId, 'object', value)} disabled={disabled} />
      <label className="col-span-2 text-xs text-gray-400">事实描述
        <textarea value={draft.payload.description} onChange={event => updatePayload(decisionId, 'description', event.target.value)} disabled={disabled} rows={2} className={`${inputClass} resize-y`} />
      </label>
    </div>;
  }
  if (draft.type === 'character_knowledge') {
    return <div className="grid grid-cols-2 gap-3">
      <TextField label="人物姓名" value={draft.payload.characterName} onChange={value => updatePayload(decisionId, 'characterName', value)} disabled={disabled} />
      <TextField label="知识来源" value={draft.payload.source} onChange={value => updatePayload(decisionId, 'source', value)} disabled={disabled} />
      <label className="col-span-2 text-xs text-gray-400">知道的事实
        <textarea value={draft.payload.factDescription} onChange={event => updatePayload(decisionId, 'factDescription', event.target.value)} disabled={disabled} rows={2} className={`${inputClass} resize-y`} />
      </label>
    </div>;
  }
  if (draft.type === 'narrative_hook') {
    return <div className="grid grid-cols-2 gap-3">
      <TextField label="主体" value={draft.payload.subject ?? ''} onChange={value => updatePayload(decisionId, 'subject', value)} disabled={disabled} />
      <SelectField label="钩子类型" value={draft.payload.hookType} options={HOOK_TYPE_OPTIONS}
        onChange={value => updatePayload(decisionId, 'hookType', value)} disabled={disabled} />
      <label className="text-xs text-gray-400">强度（1-5）
        <input type="number" min={1} max={5} value={draft.payload.intensity}
          onChange={event => updatePayload(decisionId, 'intensity', Number(event.target.value))}
          disabled={disabled}
          className={inputClass} />
      </label>
      <label className="col-span-2 text-xs text-gray-400">钩子描述
        <textarea value={draft.payload.description} onChange={event => updatePayload(decisionId, 'description', event.target.value)} disabled={disabled} rows={2} className={`${inputClass} resize-y`} />
      </label>
    </div>;
  }
  return <div className="grid grid-cols-2 gap-3">
    <TextField label="主体" value={draft.payload.subject ?? ''} onChange={value => updatePayload(decisionId, 'subject', value)} disabled={disabled} />
    <SelectField label="债务类型" value={draft.payload.debtType} options={DEBT_TYPE_OPTIONS}
      onChange={value => updatePayload(decisionId, 'debtType', value)} disabled={disabled} />
    <label className="text-xs text-gray-400">承诺章节
      <input type="number" min={1} value={draft.payload.promisedByChapter ?? ''}
        onChange={event => updatePayload(
          decisionId,
          'promisedByChapter',
          event.target.value ? Number(event.target.value) : null,
        )}
        disabled={disabled}
        className={inputClass} />
    </label>
    <label className="col-span-2 text-xs text-gray-400">债务描述
      <textarea value={draft.payload.description} onChange={event => updatePayload(decisionId, 'description', event.target.value)} disabled={disabled} rows={2} className={`${inputClass} resize-y`} />
    </label>
  </div>;
};

const TextField: React.FC<{ label: string; value: string; onChange: (value: string) => void; disabled: boolean }> = ({
  label, value, onChange, disabled,
}) => <label className="text-xs text-gray-400">{label}
  <input aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
    className="mt-1 w-full rounded bg-aichat-900 border border-aichat-700 px-3 py-2 text-sm text-white" />
</label>;

const SelectField: React.FC<{
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
  disabled: boolean;
}> = ({ label, value, options, onChange, disabled }) => <label className="text-xs text-gray-400">{label}
  <select value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
    className="mt-1 w-full rounded bg-aichat-900 border border-aichat-700 px-3 py-2 text-sm text-white">
    {options.map(([optionValue, optionLabel]) => (
      <option key={optionValue} value={optionValue}>{optionLabel}</option>
    ))}
  </select>
</label>;

function toDraft(decision: CreativeDecision): CreativeDecisionDraft {
  return {
    type: decision.type,
    title: decision.title,
    rationale: decision.rationale,
    payload: { ...decision.payload },
  } as CreativeDecisionDraft;
}

export default CreativeDecisionPanel;

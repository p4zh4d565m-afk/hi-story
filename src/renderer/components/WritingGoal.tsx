import React, { useState, useEffect, useCallback } from 'react';

interface WritingGoalProps {
  projectId?: string | null;
  totalWords: number;       // Current word count across all chapters
  chapterCount: number;     // Number of chapters
}

interface GoalData {
  wordTarget: number;
  chapterTarget: number;
  dailyTarget: number | null;  // Words per day
  startDate: string | null;
}

const GOAL_STORAGE_PREFIX = 'hi-story-goal-';

function loadGoal(projectId: string): GoalData | null {
  try {
    const raw = localStorage.getItem(GOAL_STORAGE_PREFIX + projectId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveGoal(projectId: string, data: GoalData): void {
  localStorage.setItem(GOAL_STORAGE_PREFIX + projectId, JSON.stringify(data));
}

const WritingGoal: React.FC<WritingGoalProps> = ({
  projectId,
  totalWords,
  chapterCount,
}) => {
  const [goal, setGoal] = useState<GoalData | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ wordTarget: 50000, chapterTarget: 30, dailyTarget: 1000 });

  useEffect(() => {
    if (projectId) {
      const g = loadGoal(projectId);
      setGoal(g);
      if (g) setForm({ wordTarget: g.wordTarget, chapterTarget: g.chapterTarget, dailyTarget: g.dailyTarget ?? 1000 });
    } else {
      setGoal(null);
    }
  }, [projectId]);

  const handleSave = useCallback(() => {
    if (!projectId) return;
    const data: GoalData = {
      wordTarget: form.wordTarget,
      chapterTarget: form.chapterTarget,
      dailyTarget: form.dailyTarget,
      startDate: goal?.startDate || new Date().toISOString().slice(0, 10),
    };
    saveGoal(projectId, data);
    setGoal(data);
    setEditing(false);
  }, [projectId, form, goal]);

  const wordPct = goal ? Math.min(100, Math.round((totalWords / goal.wordTarget) * 100)) : 0;
  const chPct = goal ? Math.min(100, Math.round((chapterCount / goal.chapterTarget) * 100)) : 0;

  if (!projectId) return null;

  if (editing) {
    return (
      <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-gray-400">🎯 目标</span>
          <label className="text-gray-500">
            字数
            <input
              type="number"
              value={form.wordTarget}
              onChange={e => setForm(f => ({ ...f, wordTarget: parseInt(e.target.value) || 0 }))}
              className="w-16 ml-1 px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-[10px] focus:outline-none focus:border-accent"
            />
          </label>
          <label className="text-gray-500">
            章节
            <input
              type="number"
              value={form.chapterTarget}
              onChange={e => setForm(f => ({ ...f, chapterTarget: parseInt(e.target.value) || 0 }))}
              className="w-16 ml-1 px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-[10px] focus:outline-none focus:border-accent"
            />
          </label>
          <label className="text-gray-500">
            每日
            <input
              type="number"
              value={form.dailyTarget}
              onChange={e => setForm(f => ({ ...f, dailyTarget: parseInt(e.target.value) || 0 }))}
              className="w-16 ml-1 px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-[10px] focus:outline-none focus:border-accent"
            />
          </label>
          <button onClick={handleSave} className="px-2 py-0.5 bg-accent text-white rounded text-[10px] hover:bg-accent-hover">
            保存
          </button>
          <button onClick={() => setEditing(false)} className="px-2 py-0.5 text-gray-400 hover:text-white text-[10px]">
            取消
          </button>
        </div>
      </div>
    );
  }

  if (goal) {
    return (
      <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-4 text-[10px]">
          {/* Word count progress */}
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-gray-500">📖 {totalWords.toLocaleString()}/{goal.wordTarget.toLocaleString()}</span>
            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden max-w-[120px]">
              <div
                className={`h-full rounded-full transition-all ${wordPct >= 100 ? 'bg-green-500' : 'bg-accent'}`}
                style={{ width: `${wordPct}%` }}
              />
            </div>
            <span className={`${wordPct >= 100 ? 'text-green-400' : 'text-gray-600'}`}>{wordPct}%</span>
          </div>

          {/* Chapter progress */}
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-gray-500">📑 {chapterCount}/{goal.chapterTarget}</span>
            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden max-w-[80px]">
              <div
                className={`h-full rounded-full transition-all ${chPct >= 100 ? 'bg-green-500' : 'bg-accent'}`}
                style={{ width: `${chPct}%` }}
              />
            </div>
            <span className={`${chPct >= 100 ? 'text-green-400' : 'text-gray-600'}`}>{chPct}%</span>
          </div>

          {goal.dailyTarget && (
            <span className="text-gray-500">
              🎯 每日 {goal.dailyTarget.toLocaleString()} 字
            </span>
          )}

          <button
            onClick={() => setEditing(true)}
            className="text-gray-500 hover:text-white transition-colors"
            title="编辑目标"
          >
            ✏️
          </button>
        </div>
      </div>
    );
  }

  // No goal set yet
  return (
    <div className="px-4 py-1.5 border-t border-gray-700 bg-gray-800/50">
      <button
        onClick={() => setEditing(true)}
        className="text-[10px] text-gray-500 hover:text-accent transition-colors"
      >
        🎯 设定写作目标...
      </button>
    </div>
  );
};

export default WritingGoal;

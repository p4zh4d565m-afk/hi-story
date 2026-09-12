import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DockLayout from './components/DockLayout';
import Sidebar from './components/Sidebar';
import WritingArea from './components/WritingArea';
import AIChatPanel from './components/AIChatPanel';
import InspirationPanel from './components/InspirationPanel';
import MindMap from './components/MindMap';
import MaterialPanel from './components/MaterialPanel';
import OutlinePanel from './components/OutlinePanel';
import ReferencePanel from './components/ReferencePanel';
import NameGenerator from './components/NameGenerator';
import AIWritePanel from './components/AIWritePanel';
import AIReviewPanel from './components/AIReviewPanel';
import AIPolishPanel from './components/AIPolishPanel';
import ForeshadowingPanel from './components/ForeshadowingPanel';
import PlanningWorkspace from './components/PlanningWorkspace';
import ObsidianPanel from './components/ObsidianPanel';
import type { RichEditorHandle, TextRange } from './components/editor/RichEditor';
import DatabaseBrowser from './components/DatabaseBrowser';
import CreateProjectDialog from './components/CreateProjectDialog';
import ImportDialog from './components/ImportDialog';
import CharacterEditDialog from './components/CharacterEditDialog';
import RelationEditDialog from './components/RelationEditDialog';
import { useProject } from './hooks/useProject';
import { ContextBuilder } from '../main/ai/context-builder';
import { decrypt } from './services/crypto';
import { aiService } from './services/ai.service';
import type { ProviderConfig } from '../main/ai/provider';
import { useUndo, type UndoCommand } from './hooks/useUndoManager';
import UndoToast from './components/UndoToast';
import type { ChapterOutline, CreateProjectInput, Chapter, OutlineNode, Character, WorldEntry, ObsidianScanResult, PlanningIdea } from './types';
import type { ImportResult } from '../main/importer';
import type { ImportToRefResult } from './components/ImportDialog';
import type { CharacterRelation } from './components/MindMap';
import type { SimilarityResult, SearchAllResult } from '../main/ai/similarity';
import { createProjectDataLoader } from './services/project-data-loader';
import { createImportedEntitiesRefresher } from './services/imported-entities-refresher';
import { createObsidianLoader } from './services/obsidian-loader';
import { createAiRuntimeContextLoader, type AiRuntimeContextSnapshot } from './services/ai-runtime-context-loader';
import { createPlanningLoader } from './services/planning-loader';
import { factsToHookDrafts, type ChapterExtractionFact } from './services/chapter-extraction-proposals';
import { formatPlanningAuthorityContext } from './services/ai-prompts/planning';
import { useWorkspaceLayout } from './workspace/useWorkspaceLayout';
import { panelSlot, DEFAULT_SLOT, type PanelId, type SlotId } from './workspace/layout-model';

// Simple error boundary to prevent white screen from uncaught render errors
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('🛑 ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-300">
          <div className="text-center max-w-md">
            <p className="text-lg mb-2">⚠️ 出现错误</p>
            <p className="text-xs text-gray-500 mb-4 font-mono">{this.state.error.message}</p>
            <button
              className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-accent-hover"
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => {
  const { projects, activeProject, loading: projectsLoading, creating: creatingProject,
    setActiveProjectId, isActiveProject, createProject, updateProject, deleteProject } = useProject();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showDatabaseBrowser, setShowDatabaseBrowser] = useState(false);
  const [showObsidianPanel, setShowObsidianPanel] = useState(false);
  const [obsidianSnapshot, setObsidianSnapshot] = useState<{ projectId: string; result: ObsidianScanResult } | null>(null);
  const [obsidianLoading, setObsidianLoading] = useState(false);
  const [obsidianError, setObsidianError] = useState<string | null>(null);
  const [aiRuntimeContext, setAiRuntimeContext] = useState<AiRuntimeContextSnapshot | null>(null);
  const [planningSnapshot, setPlanningSnapshot] = useState<{ projectId: string; planning: PlanningIdea | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<'planning' | 'writing'>('writing');

  // ===== Entity state =====
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const pendingAIOutlineRef = useRef<ChapterOutline | null>(null);
  const [pendingAIOutline, setPendingAIOutline] = useState<ChapterOutline | null>(null);

  // ===== AI 润色相关状态 =====
  const editorRef = useRef<RichEditorHandle | null>(null);
  // 选中文本润色的原文与选区（由右键菜单 onAIPolish 传入）
  const [polishSelection, setPolishSelection] = useState<{ text: string; range: TextRange | null } | null>(null);

  const [outlineNodes, setOutlineNodes] = useState<OutlineNode[]>([]);
  const [activeOutlineNodeId, setActiveOutlineNodeId] = useState<string | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);

  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [charactersLoading, setCharactersLoading] = useState(false);

  const [worldEntries, setWorldEntries] = useState<WorldEntry[]>([]);
  const [activeWorldEntryId, setActiveWorldEntryId] = useState<string | null>(null);
  const [worldEntriesLoading, setWorldEntriesLoading] = useState(false);

  // ===== Character editing — pop-up dialog =====
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const editingCharacter = editingCharacterId ? characters.find(c => c.id === editingCharacterId) ?? null : null;

  // ===== WorldEntry editing — context panel =====
  const editingWorldEntry = activeWorldEntryId ? worldEntries.find(e => e.id === activeWorldEntryId) ?? null : null;

  // ===== 撤销管理（Word/Excel 命令模式）=====
  const { pushUndo, undo, redo, toastLabel, dismissToast } = useUndo();

  // ===== Relations =====
  const [relations, setRelations] = useState<CharacterRelation[]>([]);
  const [relationDialog, setRelationDialog] = useState<{
    open: boolean;
    sourceId: string;
    targetId: string;
    existingRelation?: CharacterRelation;
  }>({ open: false, sourceId: '', targetId: '' });

  // ===== Panel state（P3 后只剩「不进 layout 归属」的显示态）=====
  // 大纲/素材/伏笔/灵感/参考/起名/写章/审稿/润色 都进 layout（useWorkspaceLayout）。
  // 保留：sidebarOpen（左栏折叠）、aiChatOpen/aiChatMinimized/aiLevel（AI 对话，center 内侧）、mindmapOpen（导图浮动例外）。
  const [panelState, setPanelState] = useState({
    sidebarOpen: true,
    aiChatOpen: false,       // 默认关闭，用户点击「✨ 辅助」或「💬 AI」时才打开
    aiChatMinimized: false,
    mindmapOpen: false,
    aiLevel: 'off' as 'off' | 'assist',  // 默认纯写模式，AI 模块不出现
  });

  // ===== P3 布局模型：管大纲/素材/伏笔 + 灵感/参考/起名 + 侧栏归属 =====
  // ===== P3 布局模型：管大纲/素材/伏笔/灵感/参考/起名/写章/审稿/润色 的归属 + 侧栏归属 =====
  // 写章/审稿/润色是「保活面板」：打开走 openKeepAlive（固定 bottom）、关闭走 closeKeepAlive（组件仍 display:none 挂载）。
  const workspaceLayout = useWorkspaceLayout();

  // ===== 字体大小设定 =====
  // 三个独立域: editor(编辑器字号) / panels(面板zoom) / ui(界面zoom)
  type FontSizePreset = 0 | 1 | 2 | 3; // 0=小 1=中 2=大 3=特大
  interface FontSizes { editor: FontSizePreset; panels: FontSizePreset; ui: FontSizePreset; }
  const FONT_SIZE_KEY = 'hi-story-font-sizes';
  const DEFAULT_FONT_SIZES: FontSizes = { editor: 1, panels: 1, ui: 1 };

  function loadFontSizes(): FontSizes {
    try {
      const raw = localStorage.getItem(FONT_SIZE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return DEFAULT_FONT_SIZES;
  }

  const [fontSizes, setFontSizes] = useState<FontSizes>(loadFontSizes);
  const setFontSize = useCallback((domain: keyof FontSizes, preset: FontSizePreset) => {
    setFontSizes(prev => {
      const next = { ...prev, [domain]: preset };
      localStorage.setItem(FONT_SIZE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const activeChapter = activeChapterId ? chapters.find(ch => ch.id === activeChapterId) ?? null : null;
  const activeOutlineNode = activeOutlineNodeId ? outlineNodes.find(n => n.id === activeOutlineNodeId) ?? null : null;
  const activeCharacter = activeCharacterId ? characters.find(c => c.id === activeCharacterId) ?? null : null;

  // ===== Character ↔ Chapter appearances =====
  const [characterAppearances, setCharacterAppearances] = useState<Record<string, string[]>>({});

  const loadCharacterAppearances = useCallback(async (characterId: string, projectId: string) => {
    try {
      const res = await window.electronAPI.invoke('db:referenceLink:findBySource', 'character', characterId) as any;
      if (isActiveProject(projectId) && res.success && res.data) {
        const chapterIds = res.data
          .filter((r: any) => r.targetType === 'chapter')
          .map((r: any) => r.targetId);
        setCharacterAppearances(prev => ({ ...prev, [characterId]: chapterIds }));
      }
    } catch {}
  }, [isActiveProject]);

  // ===== Character ↔ World Entry associations =====
  const [characterWorldAssoc, setCharacterWorldAssoc] = useState<Record<string, string[]>>({});

  const loadCharacterWorldAssoc = useCallback(async (characterId: string, projectId: string) => {
    try {
      const res = await window.electronAPI.invoke('db:referenceLink:findBySource', 'character', characterId) as any;
      if (isActiveProject(projectId) && res.success && res.data) {
        const worldIds = res.data
          .filter((r: any) => r.targetType === 'world_entry')
          .map((r: any) => r.targetId);
        setCharacterWorldAssoc(prev => ({ ...prev, [characterId]: worldIds }));
      }
    } catch {}
  }, [isActiveProject]);

  useEffect(() => {
    if (editingCharacterId && activeProject) {
      loadCharacterAppearances(editingCharacterId, activeProject.id);
      loadCharacterWorldAssoc(editingCharacterId, activeProject.id);
    }
  }, [activeProject, editingCharacterId, loadCharacterAppearances, loadCharacterWorldAssoc]);

  // ===== Handlers =====
  const handleToggleAppearance = useCallback(async (chapterId: string) => {
    if (!editingCharacterId) return;
    const current = characterAppearances[editingCharacterId] || [];
    const has = current.includes(chapterId);
    if (has) {
      // Remove: find and delete the reference link
      try {
        const res = await window.electronAPI.invoke('db:referenceLink:findBySource', 'character', editingCharacterId) as any;
        if (res.success && res.data) {
          const link = res.data.find((r: any) => r.targetType === 'chapter' && r.targetId === chapterId);
          if (link) {
            await window.electronAPI.invoke('db:referenceLink:remove', link.id);
          }
        }
        setCharacterAppearances(prev => ({
          ...prev,
          [editingCharacterId]: prev[editingCharacterId]?.filter(id => id !== chapterId) || [],
        }));
      } catch {}
    } else {
      // Add: create a reference link
      try {
        const res = await window.electronAPI.invoke('db:referenceLink:create', {
          sourceType: 'character',
          sourceId: editingCharacterId,
          targetType: 'chapter',
          targetId: chapterId,
          relationType: 'appears_in',
        }) as any;
        if (res.success && res.data) {
          setCharacterAppearances(prev => ({
            ...prev,
            [editingCharacterId]: [...(prev[editingCharacterId] || []), chapterId],
          }));
        }
      } catch {}
    }
  }, [editingCharacterId, characterAppearances]);

  // ===== Toggle world entry association =====
  const handleToggleWorldAssociation = useCallback(async (worldEntryId: string) => {
    if (!editingCharacterId) return;
    const current = characterWorldAssoc[editingCharacterId] || [];
    const has = current.includes(worldEntryId);
    if (has) {
      try {
        const res = await window.electronAPI.invoke('db:referenceLink:findBySource', 'character', editingCharacterId) as any;
        if (res.success && res.data) {
          const link = res.data.find((r: any) => r.targetType === 'world_entry' && r.targetId === worldEntryId);
          if (link) {
            await window.electronAPI.invoke('db:referenceLink:remove', link.id);
          }
        }
        setCharacterWorldAssoc(prev => ({
          ...prev,
          [editingCharacterId]: prev[editingCharacterId]?.filter(id => id !== worldEntryId) || [],
        }));
      } catch {}
    } else {
      try {
        const res = await window.electronAPI.invoke('db:referenceLink:create', {
          sourceType: 'character',
          sourceId: editingCharacterId,
          targetType: 'world_entry',
          targetId: worldEntryId,
          relationType: 'belongs_to',
        }) as any;
        if (res.success && res.data) {
          setCharacterWorldAssoc(prev => ({
            ...prev,
            [editingCharacterId]: [...(prev[editingCharacterId] || []), worldEntryId],
          }));
        }
      } catch {}
    }
  }, [editingCharacterId, characterWorldAssoc]);

  // ===== 项目数据加载 =====
  const loadedProjectIdRef = useRef<string | null>(null);
  const resetProjectData = useCallback(() => {
    setChapters([]); setActiveChapterId(null);
    setOutlineNodes([]); setActiveOutlineNodeId(null);
    setCharacters([]); setActiveCharacterId(null); setEditingCharacterId(null);
    setWorldEntries([]); setActiveWorldEntryId(null);
    setRelations([]); setCharacterAppearances({}); setCharacterWorldAssoc({});
    pendingAIOutlineRef.current = null; setPendingAIOutline(null);
  }, []);

  const projectDataLoader = useMemo(() => createProjectDataLoader({
    invoke: (channel, ...args) => window.electronAPI.invoke(channel, ...args),
    onApply: snapshot => {
      loadedProjectIdRef.current = snapshot.projectId;
      setChapters(snapshot.chapters);
      setActiveChapterId(snapshot.chapters[0]?.id ?? null);
      setOutlineNodes(snapshot.outlineNodes);
      setActiveOutlineNodeId(null);
      setCharacters(snapshot.characters);
      setActiveCharacterId(null);
      setWorldEntries(snapshot.worldEntries);
      setActiveWorldEntryId(null);
      setRelations(snapshot.relations as CharacterRelation[]);
    },
    onError: (projectId, error) => console.error(`项目 ${projectId} 数据加载失败：`, error),
    onLoadingChange: (_projectId, loading) => {
      setChaptersLoading(loading); setOutlineLoading(loading);
      setCharactersLoading(loading); setWorldEntriesLoading(loading);
    },
    isProjectCurrent: isActiveProject,
  }), [isActiveProject]);

  useEffect(() => {
    if (activeProject) {
      if (loadedProjectIdRef.current !== activeProject.id) {
        loadedProjectIdRef.current = null;
        resetProjectData();
      }
      void projectDataLoader.load(activeProject.id);
    } else {
      projectDataLoader.invalidate();
      loadedProjectIdRef.current = null;
      resetProjectData();
      setChaptersLoading(false); setOutlineLoading(false);
      setCharactersLoading(false); setWorldEntriesLoading(false);
    }
  }, [activeProject?.id, projectDataLoader, resetProjectData]);

  // ===== 切项目：作废旧项目的活跃 AI 流（迟到 token 不进入新项目 UI，一期） =====
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevProjectIdRef.current && prevProjectIdRef.current !== activeProject?.id) {
      aiService.ignoreProjectStreams(prevProjectIdRef.current);
    }
    prevProjectIdRef.current = activeProject?.id ?? null;
  }, [activeProject?.id]);

  // Obsidian 是独立的只读资料源：加载失败不能影响 SQLite 项目快照。
  const obsidianLoader = useMemo(() => createObsidianLoader({
    invoke: (channel, ...args) => window.electronAPI.invoke(channel, ...args),
    onApply: (projectId, result) => {
      setObsidianSnapshot({ projectId, result });
      setObsidianError(null);
    },
    onError: (_projectId, error) => {
      setObsidianError(error instanceof Error ? error.message : 'Obsidian 读取失败');
    },
    onLoadingChange: (_projectId, loading) => setObsidianLoading(loading),
    isProjectCurrent: isActiveProject,
  }), [isActiveProject]);

  useEffect(() => {
    setObsidianSnapshot(null);
    setObsidianError(null);
    if (activeProject) {
      void obsidianLoader.load(activeProject.id);
    } else {
      obsidianLoader.invalidate();
      setObsidianLoading(false);
    }
  }, [activeProject?.id, obsidianLoader]);

  // 策划数据独立加载（A4a）：失败不阻断项目，坏 JSON 保留上次快照。
  const planningLoader = useMemo(() => createPlanningLoader({
    invoke: (channel, ...args) => window.electronAPI.invoke(channel, ...args),
    onApply: (projectId, planning) => setPlanningSnapshot({ projectId, planning }),
    isProjectCurrent: isActiveProject,
  }), [isActiveProject]);

  useEffect(() => {
    setPlanningSnapshot(null);
    if (activeProject) void planningLoader.load(activeProject.id);
    else planningLoader.invalidate();
  }, [activeProject?.id, planningLoader]);

  // 确认后的四类运行时状态独立加载；项目和请求代次必须同时匹配才可提交。
  const aiRuntimeContextLoader = useMemo(() => createAiRuntimeContextLoader({
    invoke: (channel, ...args) => window.electronAPI.invoke(channel, ...args),
    onApply: setAiRuntimeContext,
    onError: (projectId, error) => console.error(`项目 ${projectId} AI 运行时上下文加载失败：`, error),
    isProjectCurrent: isActiveProject,
  }), [isActiveProject]);

  useEffect(() => {
    const projectId = activeProject?.id;
    setAiRuntimeContext(null);
    if (projectId) void aiRuntimeContextLoader.load(projectId);
    else aiRuntimeContextLoader.invalidate();
  }, [activeProject?.id, aiRuntimeContextLoader]);

  const refreshAiRuntimeContext = useCallback(async () => {
    if (!activeProject) return;
    const status = await aiRuntimeContextLoader.load(activeProject.id);
    if (status === 'failed') throw new Error('AI 运行时上下文刷新失败');
  }, [activeProject, aiRuntimeContextLoader]);

  const refreshObsidian = useCallback(() => {
    if (activeProject) void obsidianLoader.load(activeProject.id);
  }, [activeProject, obsidianLoader]);

  const saveObsidianPath = useCallback(async (obsidianPath: string) => {
    if (!activeProject) return false;
    const projectId = activeProject.id;
    const updated = await updateProject({ id: projectId, obsidianPath });
    if (!updated || !isActiveProject(projectId)) return false;
    await obsidianLoader.load(projectId);
    return true;
  }, [activeProject, isActiveProject, obsidianLoader, updateProject]);

  // ===== Handlers =====
  const handleCreateChapter = useCallback(async (title: string): Promise<Chapter | null> => {
    if (!activeProject) return null;
    const projectId = activeProject.id;
    const planningOutline = pendingAIOutlineRef.current;
    const res = await window.electronAPI.invoke('db:chapter:create', { projectId, title, planningOutline }) as any;
    if (!isActiveProject(projectId)) return null;
    if (planningOutline) { pendingAIOutlineRef.current = null; setPendingAIOutline(null); }
    if (res.success && res.data) { setChapters(prev => [...prev, res.data]); setActiveChapterId(res.data.id); return res.data as Chapter; }
    return null;
  }, [activeProject, isActiveProject]);

  const handleInsertChapterAfter = useCallback(async (afterChapterId: string, title: string) => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const res = await window.electronAPI.invoke('db:chapter:insertAfter', afterChapterId, title) as any;
    if (res.success && res.data && isActiveProject(projectId)) {
      // 重新加载全部章节以获取正确的排序顺序
      const allRes = await window.electronAPI.invoke('db:chapter:findByProject', projectId) as any;
      if (isActiveProject(projectId) && allRes.success && allRes.data) {
        setChapters(allRes.data);
        setActiveChapterId(res.data.id);
      }
    }
  }, [activeProject, isActiveProject]);

  const handleRenameChapter = useCallback(async (id: string, title: string) => {
    const ch = chapters.find(c => c.id === id);
    if (!ch) return;
    if (ch.title === title) return; // 标题无变化，跳过
    const oldTitle = ch.title;

    const res = await window.electronAPI.invoke('db:chapter:update', { id, title }) as any;
    if (!res || !res.success) {
      // 章节可能已被删除（id 在 DB 中不存在），静默失败会导致「改不动」——必须提示并中断
      alert('重命名失败：' + (res?.error || '章节可能已被删除'));
      return;
    }
    setChapters(prev => prev.map(ch => ch.id === id ? { ...ch, title } : ch));

    // 推入撤销栈（与删除/角色/世界观条目一致，让改名可回退）
    pushUndo({
      id: 'undo_' + Date.now(),
      label: `重命名章节「${oldTitle}」→「${title}」`,
      undo: async () => {
        const r = await window.electronAPI.invoke('db:chapter:update', { id, title: oldTitle }) as any;
        if (r?.success) setChapters(prev => prev.map(c => c.id === id ? { ...c, title: oldTitle } : c));
      },
      redo: async () => {
        const r = await window.electronAPI.invoke('db:chapter:update', { id, title }) as any;
        if (r?.success) setChapters(prev => prev.map(c => c.id === id ? { ...c, title } : c));
      },
    });
  }, [chapters, pushUndo]);

  const handleDeleteChapter = useCallback(async (id: string) => {
    const ch = chapters.find(c => c.id === id);
    if (!ch) return;

    // 执行删除
    const res = await window.electronAPI.invoke('db:chapter:remove', id) as any;
    if (!res || !res.success) {
      alert('删除失败：' + (res?.error || '未知错误'));
      return;
    }
    setChapters(prev => prev.filter(ch => ch.id !== id));
    if (activeChapterId === id) { const r = chapters.filter(ch => ch.id !== id); setActiveChapterId(r[0]?.id ?? null); }

    // 推入撤销栈（命令模式）
    pushUndo({
      id: 'undo_' + Date.now(),
      label: `删除章节「${ch.title}」`,
      undo: async () => {
        const res = await window.electronAPI.invoke('db:chapter:restore', ch) as any;
        if (res.success && res.data) {
          setChapters(prev => [...prev, res.data].sort((a, b) => a.sortOrder - b.sortOrder));
        }
      },
      redo: async () => {
        await window.electronAPI.invoke('db:chapter:remove', ch.id);
        setChapters(prev => prev.filter(c => c.id !== ch.id));
      },
    });
  }, [activeChapterId, chapters, pushUndo]);

  const handleSaveChapter = useCallback(async (id: string, content: string) => {
    setSaving(true);
    try {
      // 统计所有字符（含标点符号），去掉 HTML 标签和空白字符
      const wordCount = content.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
      const res = await window.electronAPI.invoke('db:chapter:update', { id, content, wordCount }) as any;
      if (!res || !res.success) {
        console.error('Chapter save failed:', res?.error || 'unknown error');
        return false; // 保存失败时由编辑器保留待保存正文并提供重试
      }
      setChapters(prev => prev.map(ch => ch.id === id ? { ...ch, content, wordCount } : ch));
      return true;
    } catch (error) {
      console.error('Chapter save failed:', error);
      return false;
    } finally { setSaving(false); }
  }, []);

  // ===== 整章润色写回 =====
  const handleApplyPolishChapter = useCallback(async (chapterId: string, content: string) => {
    await handleSaveChapter(chapterId, content);
    // 刷新编辑器显示（同章节 key 不变，TipTap 不会自动同步，需主动 setContent）
    editorRef.current?.setContent(content);
  }, [handleSaveChapter]);

  // ===== 选中文本润色写回 =====
  const handleApplyPolishSelection = useCallback((range: TextRange, html: string) => {
    editorRef.current?.replaceSelection(range, html);
  }, []);

  const handleCreateOutlineNode = useCallback(async (parentId: string | null, title: string) => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:outline:create', { projectId: activeProject.id, parentId, title }) as any;
    if (res.success && res.data) { setOutlineNodes(prev => [...prev, res.data]); setActiveOutlineNodeId(res.data.id); }
  }, [activeProject]);

  const handleStartPlannedChapter = useCallback(async (outline: ChapterOutline, mode: 'self' | 'ai') => {
    if (!activeProject) return;
    setWorkspaceMode('writing');
    if (mode === 'self') {
      const existing = chapters.find(chapter => chapter.planningOutline?.volumeIndex === outline.volumeIndex && chapter.planningOutline?.chapterNumber === outline.chapterNumber);
      if (existing) { setActiveChapterId(existing.id); return; }
      const res = await window.electronAPI.invoke('db:chapter:create', {
        projectId: activeProject.id,
        title: `第${outline.chapterNumber}章 ${outline.title}`,
        planningOutline: outline,
      }) as any;
      if (res?.success && res.data) { setChapters(previous => [...previous, res.data]); setActiveChapterId(res.data.id); }
      return;
    }

    // AI 代写：A4b 不再把章纲复制成 outline_nodes 节点（消除双份），
    // 只把章纲交给代写面板，面板用章纲字段拼上下文。
    pendingAIOutlineRef.current = outline;
    setPendingAIOutline(outline);
    workspaceLayout.openKeepAlive('aiWrite');
  }, [activeProject, chapters, workspaceLayout]);

  // Obsidian 导入后，只刷新人物与世界观（不重载章节/大纲，避免覆盖未保存正文）。
  // 与 UI 集成测试共用 createImportedEntitiesRefresher，保证测试证明的是与生产一致的 IPC 失败链路。
  const refreshImportedEntities = useMemo(
    () => createImportedEntitiesRefresher({
      invoke: (channel, ...args) => window.electronAPI.invoke(channel, ...args),
      isProjectCurrent: isActiveProject,
      onApply: (characters, worldEntries) => { setCharacters(characters); setWorldEntries(worldEntries); },
    }),
    [isActiveProject],
  );

  const handleDeleteOutlineNode = useCallback(async (id: string) => {
    const node = outlineNodes.find(n => n.id === id);
    if (!node) return;

    await window.electronAPI.invoke('db:outline:remove', id);
    setOutlineNodes(prev => prev.filter(n => n.id !== id));
    if (activeOutlineNodeId === id) setActiveOutlineNodeId(null);

    if (node) pushUndo({
      id: 'undo_' + Date.now(),
      label: `删除大纲节点「${node.title}」`,
      undo: async () => {
        const res = await window.electronAPI.invoke('db:outline:restore', node) as any;
        if (res.success && res.data) setOutlineNodes(prev => [...prev, res.data].sort((a, b) => a.sortOrder - b.sortOrder));
      },
      redo: async () => {
        await window.electronAPI.invoke('db:outline:remove', node.id);
        setOutlineNodes(prev => prev.filter(n => n.id !== node.id));
      },
    });
  }, [activeOutlineNodeId, outlineNodes, pushUndo]);

  const handleUpdateOutlineNode = useCallback(async (id: string, title: string, summary: string) => {
    const res = await window.electronAPI.invoke('db:outline:update', { id, title, summary }) as any;
    if (!res || !res.success) {
      console.error('大纲节点更新失败:', res?.error || '未知错误');
      return; // 保存失败不回写本地状态，避免「界面改了但没落库」
    }
    setOutlineNodes(prev => prev.map(n => n.id === id ? { ...n, title, summary } : n));
  }, []);

  // ===== Character — create & auto-open edit dialog =====
  const handleCreateCharacter = useCallback(async () => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:character:create', { projectId: activeProject.id, name: '新角色' }) as any;
    if (res.success && res.data) {
      setCharacters(prev => [...prev, res.data]);
      setEditingCharacterId(res.data.id); // auto-open edit dialog
    }
  }, [activeProject]);

  const handleSaveCharacter = useCallback(async (data: Partial<Character>) => {
    if (!data.id) return;
    const res = await window.electronAPI.invoke('db:character:update', data) as any;
    if (res.success && res.data) {
      setCharacters(prev => prev.map(c => c.id === res.data.id ? res.data : c));
      setEditingCharacterId(null);
    }
  }, []);

  const handleDeleteCharacter = useCallback(async (id: string) => {
    const ch = characters.find(c => c.id === id);
    if (!ch) return;

    await window.electronAPI.invoke('db:character:remove', id);
    setCharacters(prev => prev.filter(c => c.id !== id));
    if (activeCharacterId === id) setActiveCharacterId(null);
    if (editingCharacterId === id) setEditingCharacterId(null);

    pushUndo({
      id: 'undo_' + Date.now(),
      label: `删除角色「${ch.name}」`,
      undo: async () => {
        const res = await window.electronAPI.invoke('db:character:restore', ch) as any;
        if (res.success && res.data) setCharacters(prev => [...prev, res.data].sort((a, b) => a.sortOrder - b.sortOrder));
      },
      redo: async () => {
        await window.electronAPI.invoke('db:character:remove', ch.id);
        setCharacters(prev => prev.filter(c => c.id !== ch.id));
      },
    });
  }, [activeCharacterId, editingCharacterId, characters, pushUndo]);

  const handleRenameCharacter = useCallback(async (id: string, name: string) => {
    await window.electronAPI.invoke('db:character:update', { id, name });
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, name } : c));
  }, []);

  // ===== Relationship handlers =====
  const handleCreateRelation = useCallback((sourceId: string, targetId: string) => {
    setRelationDialog({ open: true, sourceId, targetId });
  }, []);

  const handleEditRelation = useCallback((relation: CharacterRelation) => {
    setRelationDialog({
      open: true,
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      existingRelation: relation,
    });
  }, []);

  const handleSaveRelation = useCallback(async (sourceId: string, targetId: string, relationType: string, arrowDirection: string, existingId?: string) => {
    if (!activeProject) return;
    try {
      if (existingId) {
        // Update existing — remove and recreate (simplest approach)
        await window.electronAPI.invoke('db:referenceLink:remove', existingId);
      }
      // Check if opposite direction exists
      const opposite = relations.find(r =>
        r.sourceId === targetId && r.targetId === sourceId
      );
      if (opposite) {
        await window.electronAPI.invoke('db:referenceLink:remove', opposite.id);
        setRelations(prev => prev.filter(r => r.id !== opposite.id));
      }
      // Create new
      const res = await window.electronAPI.invoke('db:referenceLink:create', {
        sourceType: 'character',
        sourceId,
        targetType: 'character',
        targetId,
        relationType,
        arrowDirection,
      }) as any;
      if (res.success && res.data) {
        setRelations(prev => {
          const filtered = prev.filter(r => r.id !== existingId && r.id !== opposite?.id);
          return [...filtered, {
            id: res.data.id,
            sourceId: res.data.sourceId,
            targetId: res.data.targetId,
            relationType: res.data.relationType,
            arrowDirection: res.data.arrowDirection || 'none',
          }];
        });
      }
    } catch (err) { console.error('Failed to save relation:', err); }
  }, [activeProject, relations]);

  const handleDeleteRelation = useCallback(async (relationId: string) => {
    const rel = relations.find(r => r.id === relationId);
    if (!rel) return;

    await window.electronAPI.invoke('db:referenceLink:remove', relationId);
    setRelations(prev => prev.filter(r => r.id !== relationId));

    pushUndo({
      id: 'undo_' + Date.now(),
      label: `删除角色关系`,
      undo: async () => {
        const res = await window.electronAPI.invoke('db:referenceLink:restore', {
          id: rel.id,
          sourceType: 'character',
          sourceId: rel.sourceId,
          targetType: 'character',
          targetId: rel.targetId,
          relationType: rel.relationType,
          arrowDirection: rel.arrowDirection,
          createdAt: new Date().toISOString(),
        }) as any;
        if (res.success && res.data) setRelations(prev => [...prev, res.data]);
      },
      redo: async () => {
        await window.electronAPI.invoke('db:referenceLink:remove', rel.id);
        setRelations(prev => prev.filter(r => r.id !== rel.id));
      },
    });
  }, [relations, pushUndo]);

  const handleCreateWorldEntry = useCallback(async (category: WorldEntry['category']) => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:worldEntry:create', { projectId: activeProject.id, category, name: '新条目' }) as any;
    if (res.success && res.data) { setWorldEntries(prev => [...prev, res.data]); setActiveWorldEntryId(res.data.id); }
  }, [activeProject]);

  const handleSaveWorldEntry = useCallback(async (data: Partial<WorldEntry>) => {
    if (!data.id) return;
    const res = await window.electronAPI.invoke('db:worldEntry:update', data) as any;
    if (res.success && res.data) {
      setWorldEntries(prev => prev.map(e => e.id === res.data.id ? res.data : e));
    }
  }, []);

  const handleRenameWorldEntry = useCallback(async (id: string, name: string) => {
    await window.electronAPI.invoke('db:worldEntry:update', { id, name });
    setWorldEntries(prev => prev.map(e => e.id === id ? { ...e, name } : e));
  }, []);

  const handleDeleteWorldEntry = useCallback(async (id: string) => {
    const we = worldEntries.find(e => e.id === id);
    if (!we) return;

    await window.electronAPI.invoke('db:worldEntry:remove', id);
    setWorldEntries(prev => prev.filter(e => e.id !== id));
    if (activeWorldEntryId === id) setActiveWorldEntryId(null);

    pushUndo({
      id: 'undo_' + Date.now(),
      label: `删除世界观条目「${we.name}」`,
      undo: async () => {
        const res = await window.electronAPI.invoke('db:worldEntry:restore', we) as any;
        if (res.success && res.data) setWorldEntries(prev => [...prev, res.data].sort((a, b) => a.sortOrder - b.sortOrder));
      },
      redo: async () => {
        await window.electronAPI.invoke('db:worldEntry:remove', we.id);
        setWorldEntries(prev => prev.filter(e => e.id !== we.id));
      },
    });
  }, [activeWorldEntryId, worldEntries, pushUndo]);

  const handleCreateProject = async (input: CreateProjectInput) => {
    const project = await createProject(input);
    setShowCreateDialog(false);
    if (project) {
      try {
        await window.electronAPI.invoke('db:chapter:create', { projectId: project.id, title: '第一章' });
      } catch {}
      if (isActiveProject(project.id)) await projectDataLoader.load(project.id);
    }
  };

  const handleImportNovel = useCallback(async (result: ImportResult) => {
    // 旧的导入到章节流程（保留兼容）
    if (!activeProject) {
      const project = await createProject({
        name: result.title,
        typeTags: [],
        style: '',
        summary: result.author ? `作者：${result.author}` : '',
      });
      if (!project) return;
      setImporting(true);
      try {
        for (const ch of result.chapters) {
          await window.electronAPI.invoke('db:chapter:create', {
            projectId: project.id,
            title: ch.title,
            content: ch.content,
          }) as any;
        }
        if (isActiveProject(project.id)) await projectDataLoader.load(project.id);
      } finally { setImporting(false); }
    } else {
      const projectId = activeProject.id;
      setImporting(true);
      try {
        for (const ch of result.chapters) {
          await window.electronAPI.invoke('db:chapter:create', {
            projectId,
            title: ch.title,
            content: ch.content,
          }) as any;
        }
        if (isActiveProject(projectId)) await projectDataLoader.load(projectId);
      } finally { setImporting(false); }
    }
  }, [activeProject, createProject, isActiveProject, projectDataLoader]);

  // 新的导入到参考库的处理
  const handleImportToReference = useCallback(async (result: ImportToRefResult) => {
    console.log('📚 已导入参考库:', result.doc.title,
      `(${result.chapterCount} 章, ${result.chunkCount} 块)`);
    // 后续可以显示导入成功提示
  }, []);

  // 相似度匹配状态 — 分组返回
  const [userMatches, setUserMatches] = useState<SimilarityResult[]>([]);
  const [openMatches, setOpenMatches] = useState<SimilarityResult[]>([]);
  const [refAutoSearch, setRefAutoSearch] = useState(false); // 自动检测默认关闭
  const [refSearching, setRefSearching] = useState(false); // 搜索进行中（防闪烁）

  // 使用 ref 保存最新内容引用，避免自动检测因为 content 变化频繁重设定时器
  const activeChapterContentRef = useRef(activeChapter?.content ?? '');
  useEffect(() => {
    activeChapterContentRef.current = activeChapter?.content ?? '';
  }, [activeChapter?.content]);

  // 获取 Embedding 专用 provider（优先通义千问/OpenAI，排除 DeepSeek/Claude）
  // 如果当前 AI chat provider 不支持 Embedding，查所有已保存的配置找第一个支持的
  async function getEmbeddingConfigAsync(): Promise<ProviderConfig | null> {
    try {
      const raw = localStorage.getItem('hi-story-ai-configs');
      if (!raw) return null;
      const configs: Array<{ id: string; providerId: string; apiKey: string; model: string }> = JSON.parse(raw);
      if (configs.length === 0) return null;

      const PRESETS_BASE_URL: Record<string, string> = {
        qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        openai: 'https://api.openai.com/v1',
        doubao: 'https://ark.cn-beijing.volces.com/api/v3',
        volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
        moonshot: 'https://api.moonshot.cn/v1',
        zhipu: 'https://open.bigmodel.cn/api/paas/v4',
      };

      const EMBEDDING_MODELS: Record<string, string> = {
        qwen: 'text-embedding-v3',
        openai: 'text-embedding-3-small',
        doubao: 'doubao-embedding',
        volcengine: 'doubao-embedding',
      };

      // 优先找支持 Embedding 的 provider
      for (const c of configs) {
        if (PRESETS_BASE_URL[c.providerId] && c.apiKey) {
          const decryptedKey = await decrypt(c.apiKey);
          if (decryptedKey) {
            console.log('[App] Embedding provider:', c.providerId);
            return {
              name: c.providerId,
              apiKey: decryptedKey,
              model: EMBEDDING_MODELS[c.providerId] || 'text-embedding-v3',
              baseUrl: PRESETS_BASE_URL[c.providerId],
            };
          }
        }
      }
      return null;
    } catch { return null; }
  }

  /** AI provider 优先级：通义千问 > 豆包 > DeepSeek > 其他 */
  const AI_PRIORITY: Record<string, number> = {
    qwen: 10,
    doubao: 9,
    volcengine: 8,
    deepseek: 7,
  };

  /** 从 localStorage 获取所有已配置、可用的 AI 配置（按优先级排序，解密） */
  async function getAllAiConfigsAsync(): Promise<ProviderConfig[]> {
    try {
      const raw = localStorage.getItem('hi-story-ai-configs');
      if (!raw) { console.log('[App] 无 AI 配置'); return []; }
      const configs: Array<{ id: string; providerId: string; apiKey: string; model: string; baseUrl?: string }> = JSON.parse(raw);
      console.log('[App] 共 ' + configs.length + ' 个 AI 配置');

      const PRESETS_BASE_URL: Record<string, string> = {
        claude: 'https://api.anthropic.com',
        openai: 'https://api.openai.com/v1',
        deepseek: 'https://api.deepseek.com/v1',
        doubao: 'https://ark.cn-beijing.volces.com/api/v3',
        volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
        qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        zhipu: 'https://open.bigmodel.cn/api/paas/v4',
        moonshot: 'https://api.moonshot.cn/v1',
      };

      const result: ProviderConfig[] = [];
      for (const c of configs) {
        if (!c.apiKey) continue;
        const decryptedKey = await decrypt(c.apiKey);
        if (!decryptedKey) { console.log('[App] 解密失败: ' + c.providerId); continue; }
        result.push({
          name: c.providerId,
          apiKey: decryptedKey,
          model: c.model,
          baseUrl: c.baseUrl || PRESETS_BASE_URL[c.providerId] || '',
        });
      }

      // 按优先级排序：通义千问 > 豆包 > DeepSeek > 其他
      result.sort((a, b) => (AI_PRIORITY[b.name] || 0) - (AI_PRIORITY[a.name] || 0));
      console.log('[App] 可用 AI 配置（按优先级）: ' + result.map(r => r.name).join(' → '));
      return result;
    } catch { return []; }
  }

  // 手动搜索参考库 — 简化流程：
  //   LIKE 搜索 → 候选池 → AI 精排（多 provider 降级）→ 返回结果
  const handleManualReferenceSearch = useCallback(async (query: string) => {
    setRefSearching(true);
    try {
      const allConfigs = await getAllAiConfigsAsync();
      const firstConfig = allConfigs.length > 0 ? allConfigs[0] : null;
      console.log('[App] 直接使用 LIKE + AI 精排搜索, 可用 provider 数=' + allConfigs.length);

      // 传所有配置给主进程，主进程按优先级逐个尝试
      const res = await window.electronAPI.invoke('db:reference:fallbackSearch', query, 20, allConfigs) as any;
      console.log('[App] 搜索结果: success=' + (res?.success) + ', user=' + (res?.data?.userResults?.length || 0) + ', open=' + (res?.data?.openResults?.length || 0));
      // 打印主进程返回的诊断日志
      if (res?.data?.debugLog && res.data.debugLog.length > 0) {
        console.log('[App] === 主进程 AI 精排诊断日志 ===');
        (res.data.debugLog as string[]).forEach(line => console.log('[App] ' + line));
        console.log('[App] === 诊断日志结束 ===');
      }
      if (res.success && res.data) {
        const data = res.data as SearchAllResult;
        const aiUser = data.userResults.filter(r => r.matchSource === 'ai_ranked').length;
        const aiOpen = data.openResults.filter(r => r.matchSource === 'ai_ranked').length;
        console.log('[App] 结果: user=' + data.userResults.length + '(AI精排' + aiUser + '条), open=' + data.openResults.length + '(AI精排' + aiOpen + '条)');
        setUserMatches(data.userResults);
        setOpenMatches(data.openResults);
      } else {
        setUserMatches([]);
        setOpenMatches([]);
      }
    } catch (err) {
      console.error('Reference search error:', err);
    } finally {
      setRefSearching(false);
    }
  }, []);

  const refThresholdRef = useRef(0.65);

  // 自动检测：每 3 秒检测一次，使用 ref 避免因 content 变化频繁重建定时器
  useEffect(() => {
    const referenceVisible = panelSlot(workspaceLayout.layout, 'reference') !== null;
    if (!refAutoSearch || !referenceVisible) return;

    const interval = setInterval(async () => {
      const plainText = activeChapterContentRef.current
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, '');
      if (plainText.length < 50) return; // 内容太少不匹配

      try {
        const res = await window.electronAPI.invoke('db:reference:findSimilar', {
          queryText: plainText,
          threshold: refThresholdRef.current,
          maxResults: 5,
        }) as any;
        if (res.success && res.data) {
          setUserMatches(res.data);
          setOpenMatches([]);
        }
      } catch {}
    }, 3000);

    return () => { clearInterval(interval); setUserMatches([]); setOpenMatches([]); };
  }, [refAutoSearch, workspaceLayout.layout]);

  // === Menu events ===
  useEffect(() => {
    const h = () => setShowCreateDialog(true);
    return window.electronAPI.on('menu:create-project', h);
  }, []);

  useEffect(() => {
    const h = () => setShowImportDialog(true);
    return window.electronAPI.on('menu:import-novel', h);
  }, []);

  // === Export/Backup menu events ===
  useEffect(() => {
    const h = async () => {
      try {
        if (!activeProject) return;
        const res = await window.electronAPI.invoke('export:project-json', activeProject.id) as any;
        if (res.success) {
          console.log('Project exported to:', res.data);
        }
      } catch (err) { console.error('Export failed:', err); }
    };
    return window.electronAPI.on('menu:export-project-json', h);
  }, [activeProject]);

  useEffect(() => {
    const h = async () => {
      try {
        const res = await window.electronAPI.invoke('export:all-projects-json') as any;
        if (res.success) {
          console.log('All projects exported to:', res.data);
        }
      } catch (err) { console.error('Export all failed:', err); }
    };
    return window.electronAPI.on('menu:export-all-json', h);
  }, []);

  useEffect(() => {
    const h = async () => {
      try {
        const res = await window.electronAPI.invoke('export:backup-db') as any;
        if (res.success) {
          console.log('Database backed up to:', res.data);
        }
      } catch (err) { console.error('Backup failed:', err); }
    };
    return window.electronAPI.on('menu:backup-db', h);
  }, []);

  // 数据库浏览器菜单事件
  useEffect(() => {
    const h = () => setShowDatabaseBrowser(true);
    return window.electronAPI.on('menu:browse-database', h);
  }, []);

  // === Keyboard shortcuts ===
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Ctrl+Z: 通用撤销（命令模式，与 Word/Excel 一致）
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        // 检查焦点是否在 TipTap 编辑器中（让编辑器自己处理文本撤销）
        const target = e.target as HTMLElement;
        if (target.closest('.ProseMirror') || target.isContentEditable) return;
        // 检查是否在 input/textarea 中
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        if (isInput) return;

        e.preventDefault();
        undo();
        return;
      }
      // Ctrl+Y: 重做
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'y') {
        const target = e.target as HTMLElement;
        if (target.closest('.ProseMirror') || target.isContentEditable) return;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        if (isInput) return;
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (e.key === 'I') { e.preventDefault(); workspaceLayout.movePanel('inspiration', 'right'); }
        if (e.key === 'N') { e.preventDefault(); workspaceLayout.movePanel('namegen', 'right'); }
        if (e.key === 'A') { e.preventDefault(); setPanelState(p => ({ ...p, aiChatOpen: !p.aiChatOpen, aiChatMinimized: false })); }
        if (e.key === 'S') { e.preventDefault(); setPanelState(p => ({ ...p, sidebarOpen: !p.sidebarOpen })); }
        if (e.key === 'W') { e.preventDefault(); workspaceLayout.openKeepAlive('aiWrite'); }
        if (e.key === 'R') { e.preventDefault(); workspaceLayout.openKeepAlive('aiReview'); }
        if (e.key === 'F') { e.preventDefault(); workspaceLayout.movePanel('foreshadowing', DEFAULT_SLOT.foreshadowing!); }
      }
      if (e.key === 'Escape') {
        setPanelState(p => ({ ...p, aiChatMinimized: false, mindmapOpen: false }));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo]);

  // === AI context ===
  const obsidianResult = obsidianSnapshot && activeProject && obsidianSnapshot.projectId === activeProject.id
    ? obsidianSnapshot.result
    : null;
  const obsidianDocuments = obsidianResult?.status === 'ready' ? obsidianResult.documents : [];
  const obsidianContext = useMemo(
    () => ContextBuilder.getObsidianContext(obsidianDocuments) || undefined,
    [obsidianDocuments],
  );

  const contextMessages = useMemo(() => {
    if (!activeProject) return [];
    const planning = planningSnapshot && planningSnapshot.projectId === activeProject.id
      ? planningSnapshot.planning
      : null;
    const planningContext = formatPlanningAuthorityContext(planning, activeChapter);
    const messages = ContextBuilder.build({
      project: activeProject,
      currentChapter: activeChapter ?? undefined,
      characters: characters.length > 0 ? characters : undefined,
      worldEntries: worldEntries.length > 0 ? worldEntries : undefined,
      outlineNodes: outlineNodes.length > 0 ? outlineNodes : undefined,
      obsidianDocuments: obsidianDocuments.length > 0 ? obsidianDocuments : undefined,
      storyFacts: aiRuntimeContext?.projectId === activeProject.id
        ? aiRuntimeContext.storyFacts : undefined,
      characterKnowledge: aiRuntimeContext?.projectId === activeProject.id
        ? aiRuntimeContext.characterKnowledge : undefined,
      planningContext,
    });
    const narrativeContext = aiRuntimeContext?.projectId === activeProject.id
      ? aiRuntimeContext.narrativeContext
      : '';
    return narrativeContext
      ? [...messages, { role: 'system' as const, content: narrativeContext }]
      : messages;
  }, [activeProject, activeChapter, characters, worldEntries, outlineNodes, obsidianDocuments, aiRuntimeContext, planningSnapshot]);

  return (
    <ErrorBoundary>
      <DockLayout
        workspaceMode={workspaceMode}
        onSetWorkspaceMode={setWorkspaceMode}
        panelState={panelState}
        onToggleSidebar={() => setPanelState(p => ({ ...p, sidebarOpen: !p.sidebarOpen }))}
        onToggleAiChat={() => setPanelState(p => ({ ...p, aiChatOpen: !p.aiChatOpen, aiChatMinimized: false }))}
        onMinimizeAiChat={() => setPanelState(p => ({ ...p, aiChatMinimized: !p.aiChatMinimized }))}
        onToggleContext={() => { /* deprecated — no longer used */ }}
        onToggleInspiration={() => workspaceLayout.movePanel('inspiration', 'right')}
        onToggleMindmap={() => setPanelState(p => ({ ...p, mindmapOpen: !p.mindmapOpen }))}
        onToggleMaterial={() => workspaceLayout.movePanel('material', DEFAULT_SLOT.material!)}
        onToggleOutline={() => workspaceLayout.movePanel('outline', DEFAULT_SLOT.outline!)}
        onToggleReference={() => workspaceLayout.movePanel('reference', 'right')}
        onToggleNamegen={() => workspaceLayout.movePanel('namegen', 'right')}
        onToggleAiWrite={() => workspaceLayout.openKeepAlive('aiWrite')}
        onToggleAiReview={() => workspaceLayout.openKeepAlive('aiReview')}
        onToggleAiPolish={() => { setPolishSelection(null); workspaceLayout.openKeepAlive('aiPolish'); }}
        onToggleForeshadowing={() => workspaceLayout.movePanel('foreshadowing', DEFAULT_SLOT.foreshadowing!)}
        onSetAiLevel={(level) => setPanelState(p => ({
          ...p,
          aiLevel: level,
          aiChatOpen: level !== 'off',
          aiChatMinimized: false,
        }))}
        fontSizes={fontSizes}
        onSetFontSize={setFontSize}
        layout={workspaceLayout.layout}
        onMovePanel={workspaceLayout.movePanel}
        onClosePanel={(pid) => workspaceLayout.closePanel(pid)}
        onSetActive={workspaceLayout.setActive}
        sidebar={
          <Sidebar
            projects={projects}
            activeProjectId={activeProject?.id ?? null}
            onSelectProject={setActiveProjectId}
            onCreateProject={() => setShowCreateDialog(true)}
            onImportNovel={() => setShowImportDialog(true)}
            onOpenObsidian={() => setShowObsidianPanel(true)}
            onDeleteProject={deleteProject}
            loading={projectsLoading}
            chapters={chapters}
            activeChapterId={activeChapterId}
            onSelectChapter={setActiveChapterId}
            onCreateChapter={handleCreateChapter}
            onInsertChapterAfter={handleInsertChapterAfter}
            onDeleteChapter={handleDeleteChapter}
            onRenameChapter={handleRenameChapter}
            chaptersLoading={chaptersLoading}
            characters={characters}
            worldEntries={worldEntries}
            activeCharacterId={activeCharacterId}
            onSelectCharacter={(id) => { setActiveCharacterId(id); setEditingCharacterId(id); }}
            onCreateCharacter={handleCreateCharacter}
            onDeleteCharacter={handleDeleteCharacter}
            onRenameCharacter={handleRenameCharacter}
            charactersLoading={charactersLoading}
            activeWorldEntryId={activeWorldEntryId}
            onSelectWorldEntry={(id) => { setActiveWorldEntryId(id); /* context panel deprecated */ }}
            onCreateWorldEntry={handleCreateWorldEntry}
            onDeleteWorldEntry={handleDeleteWorldEntry}
            onRenameWorldEntry={handleRenameWorldEntry}
            worldEntriesLoading={worldEntriesLoading}
            projectId={activeProject?.id ?? null}
          />
        }
        writingArea={
          <WritingArea
            isActive={workspaceMode === 'writing'}
            activeProject={activeProject}
            chapters={chapters}
            activeChapter={activeChapter}
            onSelectChapter={setActiveChapterId}
            onCreateChapter={handleCreateChapter}
            onDeleteChapter={handleDeleteChapter}
            onRenameChapter={handleRenameChapter}
            onSaveChapter={handleSaveChapter}
            onCreateProject={() => setShowCreateDialog(true)}
            onImportNovel={() => setShowImportDialog(true)}
            saving={saving}
            editorFontSize={fontSizes.editor}
            onSetEditorFontSize={(p: FontSizePreset) => setFontSize('editor', p)}
            editorRef={editorRef}
            onSearchInInspiration={(text) => {
              workspaceLayout.movePanel('inspiration', 'right');
              localStorage.setItem('hi-story-pending-inspiration-search', text);
            }}
            onSearchInReference={(text) => {
              workspaceLayout.movePanel('reference', 'right');
              localStorage.setItem('hi-story-pending-reference-search', text);
            }}
            onAIPolish={(text, range) => {
              // 打开润色面板，传入选中文本与选区范围
              setPolishSelection({ text, range: range ?? null });
              workspaceLayout.openKeepAlive('aiPolish');
            }}
            onAIContinue={() => {
              // Ensure AI chat is open
              setPanelState(p => ({ ...p, aiChatOpen: true, aiChatMinimized: false, aiLevel: 'assist' }));
              localStorage.setItem('hi-story-pending-ai-continue', 'true');
            }}
          />
        }
        planningArea={<PlanningWorkspace project={activeProject} onStartChapter={handleStartPlannedChapter} onRefreshImportedEntities={refreshImportedEntities} />}
        aiChat={
          <AIChatPanel
            contextMessages={contextMessages}
            projectId={activeProject?.id ?? null}
            onSaveMessage={() => {}}
            onCreativeDecisionsCommitted={refreshAiRuntimeContext}
          />
        }
        inspirationPanel={
          <InspirationPanel
            open={true}
            onClose={() => workspaceLayout.closePanel('inspiration')}
            onSendToChat={(r) => console.log('Send to chat:', r.title)}
            onSaveAsMaterial={(r) => console.log('Save:', r.title)}
            pendingSearchText={
              (() => {
                const t = localStorage.getItem('hi-story-pending-inspiration-search');
                if (t) { localStorage.removeItem('hi-story-pending-inspiration-search'); return t; }
                return undefined;
              })()
            }
          />
        }
        mindmapPanel={
          <MindMap
            characters={characters}
            relations={relations}
            onSelectCharacter={setActiveCharacterId}
            onEditCharacter={(id) => setEditingCharacterId(id)}
            onCreateRelation={handleCreateRelation}
            onEditRelation={handleEditRelation}
          />
        }
        materialPanel={
          <MaterialPanel
            open={true}
            projectId={activeProject?.id ?? null}
            onClose={() => workspaceLayout.closePanel('material')}
          />
        }
        outlinePanel={
          <OutlinePanel
            nodes={outlineNodes}
            activeNodeId={activeOutlineNodeId}
            onSelect={setActiveOutlineNodeId}
            onCreate={handleCreateOutlineNode}
            onDelete={handleDeleteOutlineNode}
            onUpdate={handleUpdateOutlineNode}
            loading={outlineLoading}
          />
        }
        referencePanel={
          <ReferencePanel
            open={true}
            userMatches={userMatches}
            openMatches={openMatches}
            autoSearch={refAutoSearch}
            onToggleAutoSearch={() => setRefAutoSearch(v => !v)}
            onManualSearch={handleManualReferenceSearch}
            onClose={() => workspaceLayout.closePanel('reference')}
            searching={refSearching}
            pendingSearchText={
              (() => {
                const t = localStorage.getItem('hi-story-pending-reference-search');
                if (t) { localStorage.removeItem('hi-story-pending-reference-search'); return t; }
                return undefined;
              })()
            }
          />
        }
        namegenPanel={
          <NameGenerator
            open={true}
            onClose={() => workspaceLayout.closePanel('namegen')}
          />
        }
        aiWritePanel={
          <AIWritePanel
            open={true}
            onClose={() => { pendingAIOutlineRef.current = null; setPendingAIOutline(null); workspaceLayout.closeKeepAlive('aiWrite'); }}
            outlineNodes={outlineNodes}
            activeOutlineNodeId={activeOutlineNodeId}
            chapterOutlines={planningSnapshot && planningSnapshot.projectId === activeProject?.id ? planningSnapshot.planning?.chapterOutlines ?? [] : []}
            pendingChapterOutline={pendingAIOutline}
            characters={characters}
            worldEntries={worldEntries}
            chapters={chapters}
            projectName={activeProject?.name || ''}
            projectId={activeProject?.id || ''}
            typeTags={activeProject?.typeTags || []}
            style={activeProject?.style || ''}
            obsidianContext={obsidianContext}
            preferredTitle={pendingAIOutline ? `第${pendingAIOutline.chapterNumber}章 ${pendingAIOutline.title}` : undefined}
            onSaveAsChapter={async (title: string, content: string): Promise<string | null> => {
              const projectId = activeProject?.id;
              if (!projectId) return null;
              const planningOutline = pendingAIOutlineRef.current;
              // 同步链路：create 直接带上 content（word_count 由 repo 计算），返回章节 id，不靠 setTimeout + sortOrder 猜章
              const res = await window.electronAPI.invoke('db:chapter:create', {
                projectId, title, content, planningOutline,
              }) as any;
              if (!isActiveProject(projectId)) return null;
              if (planningOutline) { pendingAIOutlineRef.current = null; setPendingAIOutline(null); }
              if (res.success && res.data) {
                setChapters(prev => [...prev, res.data]);
                setActiveChapterId(res.data.id);
                return res.data.id as string;
              }
              return null;
            }}
            onPersistExtraction={async (projectId: string, chapterId: string, extraction: { summary?: string; facts?: unknown[]; knowledge?: unknown[] }) => {
              // 抽取结果异步落库：正文已保存，摘要/事实稍后到；失败不阻断正文
              try {
                if (extraction.summary) {
                  const r = await window.electronAPI.invoke('db:chapter:update', { id: chapterId, summary: extraction.summary }) as any;
                  if (!r?.success) console.error('摘要写库失败', r?.error);
                }
                const facts = extraction.facts ?? [];
                // A5 钩子单轨：hook 类型进决策提议（待确认），非 hook 仍自动落库
                const hookDrafts = factsToHookDrafts(facts as ChapterExtractionFact[], chapterId);
                if (hookDrafts.length > 0) {
                  const r = await window.electronAPI.invoke('db:creativeDecisions:createChapterExtractionProposals', {
                    projectId, drafts: hookDrafts,
                  }) as any;
                  if (!r?.success) console.error('钩子提议写库失败', r?.error);
                }
                const nonHookFacts = facts.filter((f: any) => f.factType !== 'hook');
                if (nonHookFacts.length > 0) {
                  const r = await window.electronAPI.invoke('db:storyFacts:batchUpsert', {
                    projectId, chapterId, facts: nonHookFacts,
                  }) as any;
                  if (!r?.success) console.error('事实写库失败', r?.error);
                }
                if (extraction.knowledge && extraction.knowledge.length > 0) {
                  const r = await window.electronAPI.invoke('db:storyFacts:batchUpsertKnowledge', {
                    projectId, chapterId, knowledge: extraction.knowledge,
                  }) as any;
                  if (!r?.success) console.error('角色知识写库失败', r?.error);
                }
              } catch (e) { console.error('抽取结果落库失败', e); }
            }}
          />
        }
        aiReviewPanel={
          <AIReviewPanel
            open={true}
            onClose={() => workspaceLayout.closeKeepAlive('aiReview')}
            chapters={chapters}
            activeChapterId={activeChapterId}
            characters={characters}
            worldEntries={worldEntries}
            outlineNodes={outlineNodes}
            chapterOutlines={planningSnapshot && planningSnapshot.projectId === activeProject?.id ? planningSnapshot.planning?.chapterOutlines ?? [] : []}
            projectName={activeProject?.name || ''}
            projectId={activeProject?.id || ''}
            typeTags={activeProject?.typeTags || []}
            obsidianContext={obsidianContext}
            onNavigateToParagraph={(searchText) => {
              // 通过 localStorage 通知 WritingArea 跳转到段落
              localStorage.setItem('hi-story-jump-to-paragraph', searchText);
              // 触发 WritingArea 响应
              window.dispatchEvent(new CustomEvent('hi-story:jump-paragraph', { detail: searchText }));
            }}
            onChapterAccepted={(chapterId, content) => {
              // 接受修订后回写 App 的 chapters（与 handleSaveChapter 成功后的更新一致）。
              // 项目守卫：切走项目后的迟到修订不应改当前 chapters（与 setContent 的守卫一致）。
              const chapter = chapters.find(c => c.id === chapterId);
              if (chapter && isActiveProject(chapter.projectId)) {
                setChapters(prev => prev.map(ch => ch.id === chapterId ? { ...ch, content } : ch));
                // 同章节 key 不变，TipTap 不会自动同步；若修订的是当前打开章节，须主动刷新编辑器
                if (activeChapter?.id === chapterId) {
                  editorRef.current?.setContent(content);
                }
              }
            }}
          />
        }
        aiPolishPanel={
          <AIPolishPanel
            open={true}
            onClose={() => { setPolishSelection(null); workspaceLayout.closeKeepAlive('aiPolish'); }}
            chapters={chapters}
            activeChapterId={activeChapterId}
            characters={characters}
            worldEntries={worldEntries}
            projectName={activeProject?.name || ''}
            projectId={activeProject?.id || ''}
            typeTags={activeProject?.typeTags || []}
            initialTargetText={polishSelection?.text ?? null}
            initialRange={polishSelection?.range ?? null}
            onApplyChapter={handleApplyPolishChapter}
            onApplySelection={handleApplyPolishSelection}
          />
        }
        foreshadowingPanel={
          <ForeshadowingPanel
            open={true}
            projectId={activeProject?.id ?? null}
            chapters={chapters.map(c => ({ id: c.id, title: c.title }))}
            characters={characters.map(c => ({ id: c.id, name: c.name }))}
            outlineNodes={outlineNodes.map(n => ({ id: n.id, title: n.title }))}
          />
        }
      />

      <ObsidianPanel
        open={showObsidianPanel}
        project={activeProject}
        result={obsidianResult}
        loading={obsidianLoading}
        error={obsidianError}
        onClose={() => setShowObsidianPanel(false)}
        onSavePath={saveObsidianPath}
        onRefresh={refreshObsidian}
      />

      <CreateProjectDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateProject}
        creating={creatingProject}
      />

      <ImportDialog
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onImport={handleImportNovel}
        onImportToReference={handleImportToReference}
      />

      <DatabaseBrowser
        open={showDatabaseBrowser}
        onClose={() => setShowDatabaseBrowser(false)}
      />

      <CharacterEditDialog
        open={!!editingCharacter}
        character={editingCharacter}
        chapters={chapters}
        worldEntries={worldEntries}
        appearances={characterAppearances[editingCharacterId ?? ''] || []}
        worldAssociations={characterWorldAssoc[editingCharacterId ?? ''] || []}
        onSave={handleSaveCharacter}
        onDelete={handleDeleteCharacter}
        onToggleAppearance={handleToggleAppearance}
        onToggleWorldAssociation={handleToggleWorldAssociation}
        onClose={() => setEditingCharacterId(null)}
      />

      <RelationEditDialog
        open={relationDialog.open}
        sourceId={relationDialog.sourceId}
        targetId={relationDialog.targetId}
        existingRelation={relationDialog.existingRelation}
        characters={characters}
        onSave={handleSaveRelation}
        onDelete={handleDeleteRelation}
        onClose={() => setRelationDialog({ open: false, sourceId: '', targetId: '' })}
      />
      {/* 撤销提示条 */}
      <UndoToast
        label={toastLabel}
        onUndo={undo}
        onDismiss={dismissToast}
      />
      </ErrorBoundary>
  );
};

export default App;

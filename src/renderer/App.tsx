import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DockLayout from './components/DockLayout';
import Sidebar from './components/Sidebar';
import WritingArea from './components/WritingArea';
import AIChatPanel from './components/AIChatPanel';
import ContextPanel from './components/ContextPanel';
import InspirationPanel from './components/InspirationPanel';
import MindMap from './components/MindMap';
import MaterialPanel from './components/MaterialPanel';
import RelationMatrix from './components/RelationMatrix';
import CreateProjectDialog from './components/CreateProjectDialog';
import ImportDialog from './components/ImportDialog';
import CharacterEditDialog from './components/CharacterEditDialog';
import RelationEditDialog from './components/RelationEditDialog';
import { useProject } from './hooks/useProject';
import { ContextBuilder } from '../main/ai/context-builder';
import type { CreateProjectInput, Chapter, OutlineNode, Character, WorldEntry } from './types';
import type { ImportResult } from '../main/importer';
import type { CharacterRelation } from './components/MindMap';

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
        <div className="h-screen flex items-center justify-center bg-gray-900 text-gray-300">
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
    setActiveProjectId, createProject, deleteProject } = useProject();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importing, setImporting] = useState(false);

  // ===== Entity state =====
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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

  // ===== Relations =====
  const [relations, setRelations] = useState<CharacterRelation[]>([]);
  const [relationDialog, setRelationDialog] = useState<{
    open: boolean;
    sourceId: string;
    targetId: string;
    existingRelation?: CharacterRelation;
  }>({ open: false, sourceId: '', targetId: '' });

  // ===== Panel state =====
  const [panelState, setPanelState] = useState({
    sidebarOpen: true,
    aiChatOpen: true,
    aiChatMinimized: false,
    contextOpen: false,
    inspirationOpen: false,
    mindmapOpen: false,
    materialOpen: false,
    relationMatrixOpen: false,
    aiLevel: 'assist' as 'off' | 'assist' | 'deep',
  });

  const activeChapter = activeChapterId ? chapters.find(ch => ch.id === activeChapterId) ?? null : null;
  const activeOutlineNode = activeOutlineNodeId ? outlineNodes.find(n => n.id === activeOutlineNodeId) ?? null : null;
  const activeCharacter = activeCharacterId ? characters.find(c => c.id === activeCharacterId) ?? null : null;

  // ===== Character ↔ Chapter appearances =====
  const [characterAppearances, setCharacterAppearances] = useState<Record<string, string[]>>({});

  const loadCharacterAppearances = useCallback(async (characterId: string) => {
    try {
      const res = await window.electronAPI.invoke('db:referenceLink:findBySource', 'character', characterId) as any;
      if (res.success && res.data) {
        const chapterIds = res.data
          .filter((r: any) => r.targetType === 'chapter')
          .map((r: any) => r.targetId);
        setCharacterAppearances(prev => ({ ...prev, [characterId]: chapterIds }));
      }
    } catch {}
  }, []);

  // ===== Character ↔ World Entry associations =====
  const [characterWorldAssoc, setCharacterWorldAssoc] = useState<Record<string, string[]>>({});

  const loadCharacterWorldAssoc = useCallback(async (characterId: string) => {
    try {
      const res = await window.electronAPI.invoke('db:referenceLink:findBySource', 'character', characterId) as any;
      if (res.success && res.data) {
        const worldIds = res.data
          .filter((r: any) => r.targetType === 'world_entry')
          .map((r: any) => r.targetId);
        setCharacterWorldAssoc(prev => ({ ...prev, [characterId]: worldIds }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (editingCharacterId) {
      loadCharacterAppearances(editingCharacterId);
      loadCharacterWorldAssoc(editingCharacterId);
    }
  }, [editingCharacterId, loadCharacterAppearances, loadCharacterWorldAssoc]);

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

  // ===== Loaders =====
  const loadRelations = useCallback(async (projectId: string) => {
    try {
      const res = await window.electronAPI.invoke('db:referenceLink:findAllCharacterRelations', projectId) as any;
      if (res.success && res.data) {
        setRelations(res.data.map((r: any) => ({
          id: r.id,
          sourceId: r.sourceId,
          targetId: r.targetId,
          relationType: r.relationType,
        })));
      }
    } catch {}
  }, []);

  const loadEntities = useCallback(async (projectId: string) => {
    setChaptersLoading(true); setOutlineLoading(true);
    setCharactersLoading(true); setWorldEntriesLoading(true);
    try {
      const [chRes, olRes, ch2Res, weRes] = await Promise.all([
        window.electronAPI.invoke('db:chapter:findByProject', projectId) as any,
        window.electronAPI.invoke('db:outline:findByProject', projectId) as any,
        window.electronAPI.invoke('db:character:findByProject', projectId) as any,
        window.electronAPI.invoke('db:worldEntry:findByProject', projectId) as any,
      ]);
      if (chRes.success && chRes.data) { setChapters(chRes.data); if (chRes.data.length > 0) setActiveChapterId(chRes.data[0].id); }
      if (olRes.success && olRes.data) setOutlineNodes(olRes.data);
      if (ch2Res.success && ch2Res.data) setCharacters(ch2Res.data);
      if (weRes.success && weRes.data) setWorldEntries(weRes.data);
    } catch (err) { console.error(err); }
    finally { setChaptersLoading(false); setOutlineLoading(false); setCharactersLoading(false); setWorldEntriesLoading(false); }
  }, []);

  useEffect(() => {
    if (activeProject) {
      loadEntities(activeProject.id);
      loadRelations(activeProject.id);
    } else {
      setChapters([]); setActiveChapterId(null); setOutlineNodes([]); setActiveOutlineNodeId(null);
      setCharacters([]); setActiveCharacterId(null); setWorldEntries([]); setActiveWorldEntryId(null);
      setRelations([]);
    }
  }, [activeProject?.id, loadEntities, loadRelations]);

  // ===== Handlers =====
  const handleCreateChapter = useCallback(async (title: string) => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:chapter:create', { projectId: activeProject.id, title }) as any;
    if (res.success && res.data) { setChapters(prev => [...prev, res.data]); setActiveChapterId(res.data.id); }
  }, [activeProject]);

  const handleRenameChapter = useCallback(async (id: string, title: string) => {
    await window.electronAPI.invoke('db:chapter:update', { id, title });
    setChapters(prev => prev.map(ch => ch.id === id ? { ...ch, title } : ch));
  }, []);

  const handleDeleteChapter = useCallback(async (id: string) => {
    await window.electronAPI.invoke('db:chapter:remove', id);
    setChapters(prev => prev.filter(ch => ch.id !== id));
    if (activeChapterId === id) { const r = chapters.filter(ch => ch.id !== id); setActiveChapterId(r[0]?.id ?? null); }
  }, [activeChapterId, chapters]);

  const handleSaveChapter = useCallback(async (id: string, content: string) => {
    setSaving(true);
    try {
      const cjk = (content.match(/[一-鿿㐀-䶿]/g) || []).length;
      const wordCount = cjk || content.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
      const res = await window.electronAPI.invoke('db:chapter:update', { id, content, wordCount }) as any;
      if (!res || !res.success) {
        console.error('Chapter save failed:', res?.error || 'unknown error');
        return; // Don't update local state if save failed
      }
      setChapters(prev => prev.map(ch => ch.id === id ? { ...ch, content, wordCount } : ch));
    } finally { setSaving(false); }
  }, []);

  const handleCreateOutlineNode = useCallback(async (parentId: string | null, title: string) => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:outline:create', { projectId: activeProject.id, parentId, title }) as any;
    if (res.success && res.data) { setOutlineNodes(prev => [...prev, res.data]); setActiveOutlineNodeId(res.data.id); }
  }, [activeProject]);

  const handleDeleteOutlineNode = useCallback(async (id: string) => {
    await window.electronAPI.invoke('db:outline:remove', id);
    setOutlineNodes(prev => prev.filter(n => n.id !== id));
    if (activeOutlineNodeId === id) setActiveOutlineNodeId(null);
  }, [activeOutlineNodeId]);

  const handleUpdateOutlineNode = useCallback(async (id: string, title: string, summary: string) => {
    await window.electronAPI.invoke('db:outline:update', { id, title, summary });
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
    await window.electronAPI.invoke('db:character:remove', id);
    setCharacters(prev => prev.filter(c => c.id !== id));
    if (activeCharacterId === id) setActiveCharacterId(null);
    if (editingCharacterId === id) setEditingCharacterId(null);
  }, [activeCharacterId, editingCharacterId]);

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

  const handleSaveRelation = useCallback(async (sourceId: string, targetId: string, relationType: string, existingId?: string) => {
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
      }) as any;
      if (res.success && res.data) {
        setRelations(prev => {
          const filtered = prev.filter(r => r.id !== existingId && r.id !== opposite?.id);
          return [...filtered, {
            id: res.data.id,
            sourceId: res.data.sourceId,
            targetId: res.data.targetId,
            relationType: res.data.relationType,
          }];
        });
      }
    } catch (err) { console.error('Failed to save relation:', err); }
  }, [activeProject, relations]);

  const handleDeleteRelation = useCallback(async (relationId: string) => {
    await window.electronAPI.invoke('db:referenceLink:remove', relationId);
    setRelations(prev => prev.filter(r => r.id !== relationId));
  }, []);

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
    await window.electronAPI.invoke('db:worldEntry:remove', id);
    setWorldEntries(prev => prev.filter(e => e.id !== id));
    if (activeWorldEntryId === id) setActiveWorldEntryId(null);
  }, [activeWorldEntryId]);

  const handleCreateProject = async (input: CreateProjectInput) => {
    const project = await createProject(input);
    setShowCreateDialog(false);
    if (project) {
      try {
        const res = await window.electronAPI.invoke('db:chapter:create', { projectId: project.id, title: '第一章' }) as any;
        if (res.success && res.data) { setChapters([res.data]); setActiveChapterId(res.data.id); }
      } catch {}
    }
  };

  const handleImportNovel = useCallback(async (result: ImportResult) => {
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
        setActiveProjectId(project.id);
        await loadEntities(project.id);
        await loadRelations(project.id);
      } finally { setImporting(false); }
    } else {
      setImporting(true);
      try {
        for (const ch of result.chapters) {
          await window.electronAPI.invoke('db:chapter:create', {
            projectId: activeProject.id,
            title: ch.title,
            content: ch.content,
          }) as any;
        }
        await loadEntities(activeProject.id);
      } finally { setImporting(false); }
    }
  }, [activeProject, createProject, setActiveProjectId, loadEntities, loadRelations]);

  // === Menu events ===
  useEffect(() => {
    const h = () => setShowCreateDialog(true);
    window.electronAPI.on('menu:create-project', h);
    return () => { window.electronAPI.removeListener('menu:create-project', h); };
  }, []);

  useEffect(() => {
    const h = () => setShowImportDialog(true);
    window.electronAPI.on('menu:import-novel', h);
    return () => { window.electronAPI.removeListener('menu:import-novel', h); };
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
    window.electronAPI.on('menu:export-project-json', h);
    return () => { window.electronAPI.removeListener('menu:export-project-json', h); };
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
    window.electronAPI.on('menu:export-all-json', h);
    return () => { window.electronAPI.removeListener('menu:export-all-json', h); };
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
    window.electronAPI.on('menu:backup-db', h);
    return () => { window.electronAPI.removeListener('menu:backup-db', h); };
  }, []);

  // === Keyboard shortcuts ===
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (e.key === 'I') { e.preventDefault(); setPanelState(p => ({ ...p, inspirationOpen: !p.inspirationOpen })); }
        if (e.key === 'A') { e.preventDefault(); setPanelState(p => ({ ...p, aiChatOpen: !p.aiChatOpen, aiChatMinimized: false })); }
        if (e.key === 'S') { e.preventDefault(); setPanelState(p => ({ ...p, sidebarOpen: !p.sidebarOpen })); }
      }
      if (e.key === 'Escape') {
        setPanelState(p => ({ ...p, aiChatMinimized: false, mindmapOpen: false, inspirationOpen: false, contextOpen: false }));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // === AI context ===
  const contextMessages = useMemo(() => {
    if (!activeProject) return [];
    return ContextBuilder.build({
      project: activeProject,
      currentChapter: activeChapter ?? undefined,
      characters: characters.length > 0 ? characters : undefined,
      worldEntries: worldEntries.length > 0 ? worldEntries : undefined,
      outlineNodes: outlineNodes.length > 0 ? outlineNodes : undefined,
    });
  }, [activeProject?.id, activeChapter?.id, characters.length, worldEntries.length, outlineNodes.length]);

  return (
    <ErrorBoundary>
      <DockLayout
        panelState={panelState}
        onToggleSidebar={() => setPanelState(p => ({ ...p, sidebarOpen: !p.sidebarOpen }))}
        onToggleAiChat={() => setPanelState(p => ({ ...p, aiChatOpen: !p.aiChatOpen, aiChatMinimized: false }))}
        onMinimizeAiChat={() => setPanelState(p => ({ ...p, aiChatMinimized: !p.aiChatMinimized }))}
        onToggleContext={() => setPanelState(p => ({ ...p, contextOpen: !p.contextOpen }))}
        onToggleInspiration={() => setPanelState(p => ({ ...p, inspirationOpen: !p.inspirationOpen }))}
        onToggleMindmap={() => setPanelState(p => ({ ...p, mindmapOpen: !p.mindmapOpen }))}
        onToggleMaterial={() => setPanelState(p => ({ ...p, materialOpen: !p.materialOpen }))}
        onToggleRelationMatrix={() => setPanelState(p => ({ ...p, relationMatrixOpen: !p.relationMatrixOpen }))}
        onSetAiLevel={(level) => setPanelState(p => ({
          ...p,
          aiLevel: level,
          aiChatOpen: level !== 'off',
          aiChatMinimized: false,
        }))}
        sidebar={
          <Sidebar
            projects={projects}
            activeProjectId={activeProject?.id ?? null}
            onSelectProject={setActiveProjectId}
            onCreateProject={() => setShowCreateDialog(true)}
            onImportNovel={() => setShowImportDialog(true)}
            onDeleteProject={deleteProject}
            loading={projectsLoading}
            chapters={chapters}
            activeChapterId={activeChapterId}
            onSelectChapter={setActiveChapterId}
            onCreateChapter={handleCreateChapter}
            onDeleteChapter={handleDeleteChapter}
            onRenameChapter={handleRenameChapter}
            chaptersLoading={chaptersLoading}
            outlineNodes={outlineNodes}
            activeOutlineNodeId={activeOutlineNodeId}
            onSelectOutlineNode={setActiveOutlineNodeId}
            onCreateOutlineNode={handleCreateOutlineNode}
            onDeleteOutlineNode={handleDeleteOutlineNode}
            onUpdateOutlineNode={handleUpdateOutlineNode}
            outlineLoading={outlineLoading}
            characters={characters}
            worldEntries={worldEntries}
            activeCharacterId={activeCharacterId}
            onSelectCharacter={(id) => { setActiveCharacterId(id); setEditingCharacterId(id); }}
            onCreateCharacter={handleCreateCharacter}
            onDeleteCharacter={handleDeleteCharacter}
            onRenameCharacter={handleRenameCharacter}
            charactersLoading={charactersLoading}
            activeWorldEntryId={activeWorldEntryId}
            onSelectWorldEntry={(id) => { setActiveWorldEntryId(id); setPanelState(p => ({ ...p, contextOpen: true })); }}
            onCreateWorldEntry={handleCreateWorldEntry}
            onDeleteWorldEntry={handleDeleteWorldEntry}
            onRenameWorldEntry={handleRenameWorldEntry}
            worldEntriesLoading={worldEntriesLoading}
          />
        }
        writingArea={
          <WritingArea
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
            onSearchInInspiration={(text) => {
              setPanelState(p => ({ ...p, inspirationOpen: true }));
              // The inspiration panel will receive the search query via a ref or global state
              // For now we can store it in localStorage for the panel to pick up
              localStorage.setItem('hi-story-pending-inspiration-search', text);
            }}
            onAIPolish={(text) => {
              // Ensure AI chat is open and not minimized
              setPanelState(p => ({ ...p, aiChatOpen: true, aiChatMinimized: false, aiLevel: 'assist' }));
              // Store the polish request for the AI panel to pick up
              localStorage.setItem('hi-story-pending-ai-polish', text);
            }}
            onAIContinue={() => {
              // Ensure AI chat is open
              setPanelState(p => ({ ...p, aiChatOpen: true, aiChatMinimized: false, aiLevel: 'deep' }));
              localStorage.setItem('hi-story-pending-ai-continue', 'true');
            }}
          />
        }
        aiChat={
          <AIChatPanel
            contextMessages={contextMessages}
            projectId={activeProject?.id ?? null}
            onSaveMessage={() => {}}
          />
        }
        contextPanel={
          <ContextPanel
            activeProject={activeProject}
            activeChapter={activeChapter}
            activeOutlineNode={activeOutlineNode}
            characters={characters}
            worldEntries={worldEntries}
            relationships={relations.map(r => ({ source: r.sourceId, target: r.targetId, type: r.relationType }))}
            selectedCharacter={null}
            selectedWorldEntry={editingWorldEntry}
            onSelectCharacter={(ch) => { if (ch) { setEditingCharacterId(ch.id); } }}
            onSaveCharacter={handleSaveCharacter}
            onCloseCharacter={() => setActiveCharacterId(null)}
            onSaveWorldEntry={handleSaveWorldEntry}
            onDeleteWorldEntry={handleDeleteWorldEntry}
            onCloseWorldEntry={() => setActiveWorldEntryId(null)}
          />
        }
        inspirationPanel={
          <InspirationPanel
            open={true}
            onClose={() => setPanelState(p => ({ ...p, inspirationOpen: false }))}
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
            open={panelState.materialOpen}
            projectId={activeProject?.id ?? null}
            onClose={() => setPanelState(p => ({ ...p, materialOpen: false }))}
          />
        }
        relationMatrixPanel={
          <RelationMatrix
            open={panelState.relationMatrixOpen}
            projectId={activeProject?.id ?? null}
            characters={characters}
            chapters={chapters}
            worldEntries={worldEntries}
            outlineNodes={outlineNodes}
            onClose={() => setPanelState(p => ({ ...p, relationMatrixOpen: false }))}
          />
        }
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
      </ErrorBoundary>
  );
};

export default App;

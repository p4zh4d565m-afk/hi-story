import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout';
import Sidebar from './components/Sidebar';
import MainArea from './components/MainArea';
import ContextPanel from './components/ContextPanel';
import CreateProjectDialog from './components/CreateProjectDialog';
import { useProject } from './hooks/useProject';
import type { CreateProjectInput, Chapter, OutlineNode, Character, WorldEntry } from './types';

const App: React.FC = () => {
  const {
    projects,
    activeProject,
    loading: projectsLoading,
    creating: creatingProject,
    setActiveProjectId,
    createProject,
    deleteProject,
  } = useProject();

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // ========== Chapter state ==========
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // ========== Outline state ==========
  const [outlineNodes, setOutlineNodes] = useState<OutlineNode[]>([]);
  const [activeOutlineNodeId, setActiveOutlineNodeId] = useState<string | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);

  // ========== Character state ==========
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [charactersLoading, setCharactersLoading] = useState(false);

  // ========== World Entry state ==========
  const [worldEntries, setWorldEntries] = useState<WorldEntry[]>([]);
  const [activeWorldEntryId, setActiveWorldEntryId] = useState<string | null>(null);
  const [worldEntriesLoading, setWorldEntriesLoading] = useState(false);

  // ========== UI state ==========
  const [showInspiration, setShowInspiration] = useState(false);

  const activeChapter = activeChapterId ? chapters.find(ch => ch.id === activeChapterId) ?? null : null;
  const activeOutlineNode = activeOutlineNodeId ? outlineNodes.find(n => n.id === activeOutlineNodeId) ?? null : null;
  const activeCharacter = activeCharacterId ? characters.find(c => c.id === activeCharacterId) ?? null : null;

  // ========== Loaders ==========
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
    } catch (err) { console.error('Failed to load entities:', err); }
    finally { setChaptersLoading(false); setOutlineLoading(false); setCharactersLoading(false); setWorldEntriesLoading(false); }
  }, []);

  useEffect(() => {
    if (activeProject) { loadEntities(activeProject.id); }
    else {
      setChapters([]); setActiveChapterId(null); setOutlineNodes([]); setActiveOutlineNodeId(null);
      setCharacters([]); setActiveCharacterId(null); setWorldEntries([]); setActiveWorldEntryId(null);
    }
  }, [activeProject?.id, loadEntities]);

  // ========== Chapter handlers ==========
  const handleCreateChapter = useCallback(async (title: string) => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:chapter:create', { projectId: activeProject.id, title }) as any;
    if (res.success && res.data) { setChapters(prev => [...prev, res.data]); setActiveChapterId(res.data.id); }
  }, [activeProject]);

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
      await window.electronAPI.invoke('db:chapter:update', { id, content, wordCount });
      setChapters(prev => prev.map(ch => ch.id === id ? { ...ch, content, wordCount } : ch));
    } finally { setSaving(false); }
  }, []);

  // ========== Outline handlers ==========
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

  // ========== Character handlers ==========
  const handleCreateCharacter = useCallback(async () => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:character:create', { projectId: activeProject.id, name: '新角色' }) as any;
    if (res.success && res.data) { setCharacters(prev => [...prev, res.data]); setActiveCharacterId(res.data.id); }
  }, [activeProject]);

  const handleSelectCharacter = useCallback((id: string) => {
    setActiveCharacterId(id);
  }, []);

  const handleSaveCharacter = useCallback(async (data: Partial<Character>) => {
    if (!activeCharacterId) return;
    const res = await window.electronAPI.invoke('db:character:update', { id: activeCharacterId, ...data }) as any;
    if (res.success && res.data) {
      setCharacters(prev => prev.map(c => c.id === res.data.id ? res.data : c));
    }
  }, [activeCharacterId]);

  // ========== World Entry handlers ==========
  const handleCreateWorldEntry = useCallback(async (category: WorldEntry['category']) => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:worldEntry:create', { projectId: activeProject.id, category, name: '新条目' }) as any;
    if (res.success && res.data) { setWorldEntries(prev => [...prev, res.data]); setActiveWorldEntryId(res.data.id); }
  }, [activeProject]);

  // ========== Menu events ==========
  useEffect(() => {
    const handleMenuCreate = () => setShowCreateDialog(true);
    window.electronAPI.on('menu:create-project', handleMenuCreate);
    return () => { window.electronAPI.removeListener('menu:create-project', handleMenuCreate); };
  }, []);

  // Keyboard shortcut: Ctrl+Shift+I for inspiration panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        setShowInspiration(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateProject = async (input: CreateProjectInput) => {
    await createProject(input);
    setShowCreateDialog(false);
  };

  return (
    <>
      <Layout
        sidebar={
          <Sidebar
            projects={projects}
            activeProjectId={activeProject?.id ?? null}
            onSelectProject={setActiveProjectId}
            onCreateProject={() => setShowCreateDialog(true)}
            onDeleteProject={deleteProject}
            loading={projectsLoading}
            chapters={chapters}
            activeChapterId={activeChapterId}
            onSelectChapter={setActiveChapterId}
            onCreateChapter={handleCreateChapter}
            onDeleteChapter={handleDeleteChapter}
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
            onSelectCharacter={handleSelectCharacter}
            onCreateCharacter={handleCreateCharacter}
            charactersLoading={charactersLoading}
            activeWorldEntryId={activeWorldEntryId}
            onSelectWorldEntry={setActiveWorldEntryId}
            onCreateWorldEntry={handleCreateWorldEntry}
            worldEntriesLoading={worldEntriesLoading}
          />
        }
        main={
          <MainArea
            activeProject={activeProject}
            chapters={chapters}
            activeChapter={activeChapter}
            onSelectChapter={setActiveChapterId}
            onCreateChapter={handleCreateChapter}
            onDeleteChapter={handleDeleteChapter}
            onSaveChapter={handleSaveChapter}
            saving={saving}
            showInspiration={showInspiration}
            onCloseInspiration={() => setShowInspiration(false)}
          />
        }
        contextPanel={
          <ContextPanel
            activeProject={activeProject}
            activeChapter={activeChapter}
            activeOutlineNode={activeOutlineNode}
            characters={characters}
            worldEntries={worldEntries}
            relationships={[]}
            selectedCharacter={activeCharacter}
            onSelectCharacter={(ch) => ch && setActiveCharacterId(ch.id)}
            onSaveCharacter={handleSaveCharacter}
            onCloseCharacter={() => setActiveCharacterId(null)}
          />
        }
      />

      <CreateProjectDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateProject}
        creating={creatingProject}
      />
    </>
  );
};

export default App;

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DockLayout from './components/DockLayout';
import Sidebar from './components/Sidebar';
import WritingArea from './components/WritingArea';
import AIChatPanel from './components/AIChatPanel';
import ContextPanel from './components/ContextPanel';
import InspirationPanel from './components/InspirationPanel';
import MindMap from './components/MindMap';
import CreateProjectDialog from './components/CreateProjectDialog';
import { useProject } from './hooks/useProject';
import { ContextBuilder } from '../main/ai/context-builder';
import type { CreateProjectInput, Chapter, OutlineNode, Character, WorldEntry } from './types';

const App: React.FC = () => {
  const { projects, activeProject, loading: projectsLoading, creating: creatingProject,
    setActiveProjectId, createProject, deleteProject } = useProject();

  const [showCreateDialog, setShowCreateDialog] = useState(false);

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

  // ===== Panel state =====
  const [panelState, setPanelState] = useState({
    sidebarOpen: true,
    aiChatOpen: true,
    aiChatMinimized: false,
    contextOpen: false,
    inspirationOpen: false,
    mindmapOpen: false,
  });

  const activeChapter = activeChapterId ? chapters.find(ch => ch.id === activeChapterId) ?? null : null;
  const activeOutlineNode = activeOutlineNodeId ? outlineNodes.find(n => n.id === activeOutlineNodeId) ?? null : null;
  const activeCharacter = activeCharacterId ? characters.find(c => c.id === activeCharacterId) ?? null : null;

  // ===== Loaders =====
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
    if (activeProject) loadEntities(activeProject.id);
    else { setChapters([]); setActiveChapterId(null); setOutlineNodes([]); setActiveOutlineNodeId(null);
      setCharacters([]); setActiveCharacterId(null); setWorldEntries([]); setActiveWorldEntryId(null); }
  }, [activeProject?.id, loadEntities]);

  // ===== Handlers (abbreviated) =====
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

  const handleCreateCharacter = useCallback(async () => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:character:create', { projectId: activeProject.id, name: '新角色' }) as any;
    if (res.success && res.data) { setCharacters(prev => [...prev, res.data]); setActiveCharacterId(res.data.id); }
  }, [activeProject]);

  const handleSaveCharacter = useCallback(async (data: Partial<Character>) => {
    if (!activeCharacterId) return;
    const res = await window.electronAPI.invoke('db:character:update', { id: activeCharacterId, ...data }) as any;
    if (res.success && res.data) setCharacters(prev => prev.map(c => c.id === res.data.id ? res.data : c));
  }, [activeCharacterId]);

  const handleCreateWorldEntry = useCallback(async (category: WorldEntry['category']) => {
    if (!activeProject) return;
    const res = await window.electronAPI.invoke('db:worldEntry:create', { projectId: activeProject.id, category, name: '新条目' }) as any;
    if (res.success && res.data) { setWorldEntries(prev => [...prev, res.data]); setActiveWorldEntryId(res.data.id); }
  }, [activeProject]);

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

  // === Menu events ===
  useEffect(() => {
    const h = () => setShowCreateDialog(true);
    window.electronAPI.on('menu:create-project', h);
    return () => { window.electronAPI.removeListener('menu:create-project', h); };
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
    <>
      <DockLayout
        panelState={panelState}
        onToggleSidebar={() => setPanelState(p => ({ ...p, sidebarOpen: !p.sidebarOpen }))}
        onToggleAiChat={() => setPanelState(p => ({ ...p, aiChatOpen: !p.aiChatOpen, aiChatMinimized: false }))}
        onMinimizeAiChat={() => setPanelState(p => ({ ...p, aiChatMinimized: !p.aiChatMinimized }))}
        onToggleContext={() => setPanelState(p => ({ ...p, contextOpen: !p.contextOpen }))}
        onToggleInspiration={() => setPanelState(p => ({ ...p, inspirationOpen: !p.inspirationOpen }))}
        onToggleMindmap={() => setPanelState(p => ({ ...p, mindmapOpen: !p.mindmapOpen }))}
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
            onSelectCharacter={setActiveCharacterId}
            onCreateCharacter={handleCreateCharacter}
            charactersLoading={charactersLoading}
            activeWorldEntryId={activeWorldEntryId}
            onSelectWorldEntry={setActiveWorldEntryId}
            onCreateWorldEntry={handleCreateWorldEntry}
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
            onSaveChapter={handleSaveChapter}
            saving={saving}
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
            relationships={[]}
            selectedCharacter={null}
            onSelectCharacter={() => {}}
            onSaveCharacter={handleSaveCharacter}
            onCloseCharacter={() => setActiveCharacterId(null)}
          />
        }
        inspirationPanel={
          <InspirationPanel
            open={true}
            onClose={() => setPanelState(p => ({ ...p, inspirationOpen: false }))}
            onSendToChat={(r) => console.log('Send to chat:', r.title)}
            onSaveAsMaterial={(r) => console.log('Save:', r.title)}
          />
        }
        mindmapPanel={
          <MindMap
            characters={characters}
            onSelectCharacter={setActiveCharacterId}
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

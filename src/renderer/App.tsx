import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout';
import Sidebar from './components/Sidebar';
import WritingArea from './components/WritingArea';
import ContextPanel from './components/ContextPanel';
import CreateProjectDialog from './components/CreateProjectDialog';
import { useProject } from './hooks/useProject';
import type { CreateProjectInput, Chapter, OutlineNode } from './types';

const App: React.FC = () => {
  const {
    projects,
    activeProject,
    loading: projectsLoading,
    creating,
    setActiveProjectId,
    createProject,
    deleteProject,
  } = useProject();

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Chapter state
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Outline state
  const [outlineNodes, setOutlineNodes] = useState<OutlineNode[]>([]);
  const [activeOutlineNodeId, setActiveOutlineNodeId] = useState<string | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);

  const activeChapter = activeChapterId
    ? chapters.find(ch => ch.id === activeChapterId) ?? null
    : null;

  // ===== Chapters =====
  const loadChapters = useCallback(async (projectId: string) => {
    setChaptersLoading(true);
    try {
      const result = await window.electronAPI.invoke('db:chapter:findByProject', projectId) as any;
      if (result.success && result.data) {
        setChapters(result.data);
        if (result.data.length > 0 && !activeChapterId) {
          setActiveChapterId(result.data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load chapters:', err);
    } finally {
      setChaptersLoading(false);
    }
  }, []);

  const handleCreateChapter = useCallback(async (title: string) => {
    if (!activeProject) return;
    try {
      const result = await window.electronAPI.invoke('db:chapter:create', {
        projectId: activeProject.id,
        title,
      }) as any;
      if (result.success && result.data) {
        await loadChapters(activeProject.id);
        setActiveChapterId(result.data.id);
      }
    } catch (err) {
      console.error('Failed to create chapter:', err);
    }
  }, [activeProject, loadChapters]);

  const handleDeleteChapter = useCallback(async (id: string) => {
    try {
      await window.electronAPI.invoke('db:chapter:remove', id);
      setChapters(prev => prev.filter(ch => ch.id !== id));
      if (activeChapterId === id) {
        const remaining = chapters.filter(ch => ch.id !== id);
        setActiveChapterId(remaining.length > 0 ? remaining[0]?.id : null);
      }
    } catch (err) {
      console.error('Failed to delete chapter:', err);
    }
  }, [activeChapterId, chapters]);

  const handleSaveChapter = useCallback(async (id: string, content: string) => {
    setSaving(true);
    try {
      const chineseChars = (content.match(/[一-鿿㐀-䶿]/g) || []).length;
      const plainText = content.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
      const wordCount = chineseChars || plainText.length;
      await window.electronAPI.invoke('db:chapter:update', { id, content, wordCount });
      setChapters(prev => prev.map(ch =>
        ch.id === id ? { ...ch, content, wordCount } : ch
      ));
    } catch (err) {
      console.error('Failed to save chapter:', err);
    } finally {
      setSaving(false);
    }
  }, []);

  // ===== Outline =====
  const loadOutline = useCallback(async (projectId: string) => {
    setOutlineLoading(true);
    try {
      const result = await window.electronAPI.invoke('db:outline:findByProject', projectId) as any;
      if (result.success && result.data) {
        setOutlineNodes(result.data);
      }
    } catch (err) {
      console.error('Failed to load outline:', err);
    } finally {
      setOutlineLoading(false);
    }
  }, []);

  const handleCreateOutlineNode = useCallback(async (parentId: string | null, title: string) => {
    if (!activeProject) return;
    try {
      const result = await window.electronAPI.invoke('db:outline:create', {
        projectId: activeProject.id,
        parentId,
        title,
      }) as any;
      if (result.success && result.data) {
        await loadOutline(activeProject.id);
        setActiveOutlineNodeId(result.data.id);
      }
    } catch (err) {
      console.error('Failed to create outline node:', err);
    }
  }, [activeProject, loadOutline]);

  const handleDeleteOutlineNode = useCallback(async (id: string) => {
    try {
      await window.electronAPI.invoke('db:outline:remove', id);
      setOutlineNodes(prev => prev.filter(n => n.id !== id));
      if (activeOutlineNodeId === id) {
        setActiveOutlineNodeId(null);
      }
    } catch (err) {
      console.error('Failed to delete outline node:', err);
    }
  }, [activeOutlineNodeId]);

  const handleUpdateOutlineNode = useCallback(async (id: string, title: string, summary: string) => {
    try {
      await window.electronAPI.invoke('db:outline:update', { id, title, summary });
      setOutlineNodes(prev => prev.map(n =>
        n.id === id ? { ...n, title, summary } : n
      ));
    } catch (err) {
      console.error('Failed to update outline node:', err);
    }
  }, []);

  // ===== Effects =====
  useEffect(() => {
    if (activeProject) {
      loadChapters(activeProject.id);
      loadOutline(activeProject.id);
    } else {
      setChapters([]);
      setActiveChapterId(null);
      setOutlineNodes([]);
      setActiveOutlineNodeId(null);
    }
  }, [activeProject?.id, loadChapters, loadOutline]);

  useEffect(() => {
    const handleMenuCreate = () => setShowCreateDialog(true);
    window.electronAPI.on('menu:create-project', handleMenuCreate);
    return () => {
      window.electronAPI.removeListener('menu:create-project', handleMenuCreate);
    };
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
          />
        }
        main={
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
        contextPanel={<ContextPanel activeProject={activeProject} />}
      />

      <CreateProjectDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateProject}
        creating={creating}
      />
    </>
  );
};

export default App;

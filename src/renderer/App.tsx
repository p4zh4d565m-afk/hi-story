import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout';
import Sidebar from './components/Sidebar';
import WritingArea from './components/WritingArea';
import ContextPanel from './components/ContextPanel';
import CreateProjectDialog from './components/CreateProjectDialog';
import { useProject } from './hooks/useProject';
import type { CreateProjectInput } from './types';
import type { Chapter } from './types';

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

  const activeChapter = activeChapterId
    ? chapters.find(ch => ch.id === activeChapterId) ?? null
    : null;

  // Load chapters when project changes
  const loadChapters = useCallback(async (projectId: string) => {
    setChaptersLoading(true);
    try {
      const result = await window.electronAPI.invoke('db:chapter:findByProject', projectId) as any;
      if (result.success && result.data) {
        setChapters(result.data);
        if (result.data.length > 0) {
          setActiveChapterId(result.data[0].id);
        } else {
          setActiveChapterId(null);
        }
      }
    } catch (err) {
      console.error('Failed to load chapters:', err);
    } finally {
      setChaptersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeProject) {
      loadChapters(activeProject.id);
    } else {
      setChapters([]);
      setActiveChapterId(null);
    }
  }, [activeProject?.id, loadChapters]);

  // Chapter CRUD handlers
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
      // Calculate word count (Chinese characters)
      const chineseChars = (content.match(/[一-鿿㐀-䶿]/g) || []).length;
      const plainText = content.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
      const wordCount = chineseChars || plainText.length;

      await window.electronAPI.invoke('db:chapter:update', {
        id,
        content,
        wordCount,
      });

      setChapters(prev => prev.map(ch =>
        ch.id === id ? { ...ch, content, wordCount } : ch
      ));
    } catch (err) {
      console.error('Failed to save chapter:', err);
    } finally {
      setSaving(false);
    }
  }, []);

  // Listen for menu events
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

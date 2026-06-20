import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Sidebar from './components/Sidebar';
import MainArea from './components/MainArea';
import ContextPanel from './components/ContextPanel';
import CreateProjectDialog from './components/CreateProjectDialog';
import { useProject } from './hooks/useProject';
import type { CreateProjectInput } from './types';

const App: React.FC = () => {
  const {
    projects,
    activeProject,
    loading,
    creating,
    setActiveProjectId,
    createProject,
    deleteProject,
  } = useProject();

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Listen for menu events
  useEffect(() => {
    const handleMenuCreate = () => {
      setShowCreateDialog(true);
    };

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
            loading={loading}
          />
        }
        main={<MainArea activeProject={activeProject} />}
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

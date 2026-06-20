import { useState, useEffect, useCallback } from 'react';
import type { Project, CreateProjectInput } from '../types';

interface UseProjectReturn {
  projects: Project[];
  activeProject: Project | null;
  loading: boolean;
  creating: boolean;
  setActiveProjectId: (id: string | null) => void;
  createProject: (input: CreateProjectInput) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
}

export function useProject(): UseProjectReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.invoke('db:project:findAll', 50, 0) as any;
      if (result.success && result.data) {
        setProjects(result.data.items);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!activeProjectId) {
      setActiveProject(null);
      return;
    }
    const found = projects.find((p) => p.id === activeProjectId);
    if (found) {
      setActiveProject(found);
    } else {
      window.electronAPI.invoke('db:project:findById', activeProjectId)
        .then((result: any) => {
          if (result.success && result.data) {
            setActiveProject(result.data);
          }
        });
    }
  }, [activeProjectId, projects]);

  const createProject = useCallback(async (input: CreateProjectInput): Promise<Project | null> => {
    setCreating(true);
    try {
      const result = await window.electronAPI.invoke('db:project:create', input) as any;
      if (result.success && result.data) {
        await refreshProjects();
        setActiveProjectId(result.data.id);
        return result.data as Project;
      } else {
        console.error('Failed to create project:', result.error);
        return null;
      }
    } finally {
      setCreating(false);
    }
  }, [refreshProjects]);

  const deleteProject = useCallback(async (id: string) => {
    try {
      await window.electronAPI.invoke('db:project:remove', id);
      if (activeProjectId === id) {
        setActiveProjectId(null);
      }
      await refreshProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }, [activeProjectId, refreshProjects]);

  return {
    projects,
    activeProject,
    loading,
    creating,
    setActiveProjectId,
    createProject,
    deleteProject,
    refreshProjects,
  };
}

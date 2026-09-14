import { useState, useEffect, useCallback, useRef } from 'react';
import type { Project, CreateProjectInput, UpdateProjectInput } from '../types';
import { createProjectSelectionGuard, type ProjectSelectionTicket } from '../services/project-data-loader';

interface UseProjectReturn {
  projects: Project[];
  activeProject: Project | null;
  loading: boolean;
  creating: boolean;
  setActiveProjectId: (id: string | null) => void;
  isActiveProject: (id: string) => boolean;
  /** 捕获当前项目选择 ticket（含 generation），供异步回执做真选择守卫 */
  snapshotProjectSelection: () => ProjectSelectionTicket;
  /** 校验 ticket 是否仍是最新选择（项目 id + generation 都匹配） */
  isProjectSelectionCurrent: (ticket: ProjectSelectionTicket) => boolean;
  createProject: (input: CreateProjectInput) => Promise<Project | null>;
  updateProject: (input: UpdateProjectInput) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
}

export function useProject(): UseProjectReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const selectionGuardRef = useRef(createProjectSelectionGuard());
  const projectListRequestRef = useRef(0);

  const selectProject = useCallback((id: string | null) => {
    selectionGuardRef.current.select(id);
    setActiveProjectId(id);
  }, []);

  const isActiveProject = useCallback((id: string) => (
    selectionGuardRef.current.currentProjectId() === id
  ), []);

  const snapshotProjectSelection = useCallback((): ProjectSelectionTicket => (
    selectionGuardRef.current.snapshot()
  ), []);

  const isProjectSelectionCurrent = useCallback((ticket: ProjectSelectionTicket) => (
    selectionGuardRef.current.isCurrent(ticket)
  ), []);

  const refreshProjects = useCallback(async () => {
    const requestId = ++projectListRequestRef.current;
    setLoading(true);
    try {
      const result = await window.electronAPI.invoke('db:project:findAll', 50, 0) as any;
      if (requestId === projectListRequestRef.current && result.success && result.data) {
        setProjects(result.data.items);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      if (requestId === projectListRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    const ticket = selectionGuardRef.current.snapshot();
    if (!activeProjectId) {
      setActiveProject(null);
      return;
    }
    const found = projects.find((p) => p.id === activeProjectId);
    if (found) {
      if (selectionGuardRef.current.isCurrent(ticket)) setActiveProject(found);
    } else {
      setActiveProject(null);
      let disposed = false;
      window.electronAPI.invoke('db:project:findById', activeProjectId)
        .then((result: any) => {
          if (!disposed && selectionGuardRef.current.isCurrent(ticket) && result.success && result.data) {
            setActiveProject(result.data);
          }
        })
        .catch((error: unknown) => {
          if (!disposed && selectionGuardRef.current.isCurrent(ticket)) {
            console.error('项目加载失败：', error);
          }
        });
      return () => { disposed = true; };
    }
  }, [activeProjectId, projects]);

  const createProject = useCallback(async (input: CreateProjectInput): Promise<Project | null> => {
    const selectionAtStart = selectionGuardRef.current.snapshot();
    setCreating(true);
    try {
      const result = await window.electronAPI.invoke('db:project:create', input) as any;
      if (result.success && result.data) {
        await refreshProjects();
        if (selectionGuardRef.current.isCurrent(selectionAtStart)) {
          selectProject(result.data.id);
        }
        return result.data as Project;
      } else {
        console.error('Failed to create project:', result.error);
        return null;
      }
    } finally {
      setCreating(false);
    }
  }, [refreshProjects, selectProject]);

  const deleteProject = useCallback(async (id: string) => {
    try {
      await window.electronAPI.invoke('db:project:remove', id);
      if (selectionGuardRef.current.currentProjectId() === id) {
        selectProject(null);
      }
      await refreshProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }, [refreshProjects, selectProject]);

  const updateProject = useCallback(async (input: UpdateProjectInput): Promise<Project | null> => {
    try {
      const result = await window.electronAPI.invoke('db:project:update', input) as any;
      if (!result.success || !result.data) {
        console.error('Failed to update project:', result.error);
        return null;
      }
      const updated = result.data as Project;
      setProjects(previous => previous.map(project => project.id === updated.id ? updated : project));
      if (selectionGuardRef.current.currentProjectId() === updated.id) setActiveProject(updated);
      return updated;
    } catch (error) {
      console.error('Failed to update project:', error);
      return null;
    }
  }, []);

  return {
    projects,
    activeProject,
    loading,
    creating,
    setActiveProjectId: selectProject,
    isActiveProject,
    snapshotProjectSelection,
    isProjectSelectionCurrent,
    createProject,
    updateProject,
    deleteProject,
    refreshProjects,
  };
}

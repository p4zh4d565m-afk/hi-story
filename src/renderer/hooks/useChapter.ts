import { useState, useCallback } from 'react';
import type { Chapter } from '../types';
import type { CreateChapterInput } from '../../main/db/repositories/chapter.repo';

interface UseChapterReturn {
  chapters: Chapter[];
  activeChapter: Chapter | null;
  loading: boolean;
  saving: boolean;
  setActiveChapterId: (id: string | null) => void;
  createChapter: (input: CreateChapterInput) => Promise<Chapter | null>;
  saveChapter: (id: string, content: string) => Promise<void>;
  deleteChapter: (id: string) => Promise<void>;
  loadChapters: (projectId: string) => Promise<void>;
}

export function useChapter(): UseChapterReturn {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadChapters = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const result = await window.electronAPI.invoke('db:chapter:findByProject', projectId) as any;
      if (result.success && result.data) {
        setChapters(result.data);
        // Auto-select first chapter if none selected
        if (!activeChapterId && result.data.length > 0) {
          setActiveChapterId(result.data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load chapters:', err);
    } finally {
      setLoading(false);
    }
  }, [activeChapterId]);

  const createChapter = useCallback(async (input: CreateChapterInput): Promise<Chapter | null> => {
    try {
      const result = await window.electronAPI.invoke('db:chapter:create', input) as any;
      if (result.success && result.data) {
        await loadChapters(input.projectId);
        setActiveChapterId(result.data.id);
        return result.data;
      }
    } catch (err) {
      console.error('Failed to create chapter:', err);
    }
    return null;
  }, [loadChapters]);

  const saveChapter = useCallback(async (id: string, content: string) => {
    setSaving(true);
    try {
      const chineseChars = (content.match(/[一-鿿]/g) || []).length;
      const words = content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
      const wordCount = chineseChars + words;

      await window.electronAPI.invoke('db:chapter:update', {
        id,
        content,
        wordCount,
      });

      setChapters(prev => prev.map(ch =>
        ch.id === id ? { ...ch, content, wordCount } : ch
      ));
      setActiveChapter(prev => prev?.id === id ? { ...prev, content, wordCount } : prev);
    } catch (err) {
      console.error('Failed to save chapter:', err);
    } finally {
      setSaving(false);
    }
  }, []);

  const deleteChapter = useCallback(async (id: string) => {
    try {
      await window.electronAPI.invoke('db:chapter:remove', id);
      setChapters(prev => prev.filter(ch => ch.id !== id));
      if (activeChapterId === id) {
        setChapters(prev => {
          const remaining = prev.filter(ch => ch.id !== id);
          setActiveChapterId(remaining.length > 0 ? remaining[0].id : null);
          setActiveChapter(remaining.length > 0 ? remaining[0] : null);
          return remaining;
        });
      }
    } catch (err) {
      console.error('Failed to delete chapter:', err);
    }
  }, [activeChapterId]);

  // Resolve active chapter from chapters list
  const resolvedActive = activeChapterId
    ? chapters.find(ch => ch.id === activeChapterId) ?? null
    : null;

  return {
    chapters,
    activeChapter: activeChapter || resolvedActive,
    loading,
    saving,
    setActiveChapterId: (id) => {
      setActiveChapterId(id);
      setActiveChapter(chapters.find(ch => ch.id === id) ?? null);
    },
    createChapter,
    saveChapter,
    deleteChapter,
    loadChapters,
  };
}

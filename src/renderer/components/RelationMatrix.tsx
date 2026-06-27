import React, { useState, useCallback } from 'react';
import type { Character, Chapter, WorldEntry, OutlineNode } from '../types';

// Cross-reference row data
interface CrossRefRow {
  entity: { id: string; name: string; type: string };
  chars: { srcId: string; tgtId: string; links: any[] }[];
}

interface RelationMatrixProps {
  open: boolean;
  projectId: string | null;
  characters: Character[];
  chapters: Chapter[];
  worldEntries: WorldEntry[];
  outlineNodes: OutlineNode[];
  onClose: () => void;
}

type MatrixMode = 'character-world' | 'character-chapter' | 'world-chapter' | 'character-outline';

const MODES: { key: MatrixMode; label: string; cols: string; rows: string; rowEntities: string; colEntities: string }[] = [
  { key: 'character-world', label: '👤↔🌍 角色-世界', cols: 'worldEntries', rows: 'characters', rowEntities: '角色', colEntities: '世界' },
  { key: 'character-chapter', label: '👤↔📖 角色-章节', cols: 'chapters', rows: 'characters', rowEntities: '角色', colEntities: '章节' },
  { key: 'world-chapter', label: '🌍↔📖 世界-章节', cols: 'chapters', rows: 'worldEntries', rowEntities: '世界', colEntities: '章节' },
  { key: 'character-outline', label: '👤↔📋 角色-大纲', cols: 'outlineNodes', rows: 'characters', rowEntities: '角色', colEntities: '大纲' },
];

const RelationMatrix: React.FC<RelationMatrixProps> = ({
  open,
  projectId,
  characters,
  chapters,
  worldEntries,
  outlineNodes,
  onClose,
}) => {
  const [mode, setMode] = useState<MatrixMode>('character-world');
  const [cellData, setCellData] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  const modeConfig = MODES.find(m => m.key === mode)!;

  // Helper: some entity types use .name, others use .title
  const getName = (entity: any): string => entity.name || entity.title || '';

  // Determine row and column entities (stable identity via useMemo)
  const { rowEntities, colEntities, rowType, colType } = React.useMemo(() => ({
    rowEntities: mode === 'character-world' || mode === 'character-chapter' || mode === 'character-outline' ? characters : worldEntries,
    colEntities: mode === 'character-world' ? worldEntries
      : (mode === 'character-chapter' || mode === 'world-chapter') ? chapters
      : outlineNodes,
    rowType: mode === 'world-chapter' ? 'world_entry' : 'character',
    colType: mode === 'character-world' ? 'world_entry'
      : (mode === 'character-chapter' || mode === 'world-chapter') ? 'chapter'
      : 'outline_node',
  }), [mode, characters, chapters, worldEntries, outlineNodes]);

  // Load cross-reference data
  const loadCellData = useCallback(async () => {
    if (!projectId || !rowEntities.length) return;
    setLoading(true);
    const data: Record<string, string[]> = {};

    try {
      // For each row entity, find what column entities it links to
      for (const row of rowEntities) {
        const res = await window.electronAPI.invoke('db:referenceLink:findBySource', rowType, row.id) as any;
        if (res.success && res.data) {
          const colIds = res.data
            .filter((r: any) => r.targetType === colType)
            .map((r: any) => r.targetId);
          data[row.id] = colIds;
        } else {
          data[row.id] = [];
        }
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }

    setCellData(data);
  }, [projectId, rowEntities, rowType, colType]);

  React.useEffect(() => {
    if (open) loadCellData();
  }, [open, mode, loadCellData]);

  const toggleCell = useCallback(async (rowId: string, colId: string) => {
    const current = cellData[rowId] || [];
    const has = current.includes(colId);

    if (has) {
      // Remove link
      try {
        const res = await window.electronAPI.invoke('db:referenceLink:findBySource', rowType, rowId) as any;
        if (res.success && res.data) {
          const link = res.data.find((r: any) => r.targetType === colType && r.targetId === colId);
          if (link) {
            await window.electronAPI.invoke('db:referenceLink:remove', link.id);
          }
        }
        setCellData(prev => ({
          ...prev,
          [rowId]: (prev[rowId] || []).filter(id => id !== colId),
        }));
      } catch {}
    } else {
      // Add link
      try {
        const linkRes = await window.electronAPI.invoke('db:referenceLink:create', {
          sourceType: rowType,
          sourceId: rowId,
          targetType: colType,
          targetId: colId,
          relationType: 'related_to',
        }) as any;
        if (linkRes.success) {
          setCellData(prev => ({
            ...prev,
            [rowId]: [...(prev[rowId] || []), colId],
          }));
        }
      } catch {}
    }
  }, [cellData, rowType, colType]);

  if (!open || !projectId) return null;

  const maxRows = 15; // clamp for display
  const maxCols = 10;

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">🔗 关联关系矩阵</h3>
          <p className="text-[10px] text-gray-600 mt-0.5">可视化交叉引用，点击格子关联/取消</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">✕</button>
      </div>

      {/* Mode selector */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-gray-700 bg-gray-800/50 overflow-x-auto">
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
              mode === m.key
                ? 'bg-accent text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" />
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}

      {/* Matrix table */}
      {!loading && (
        <div className="flex-1 overflow-auto">
          <table className="text-[9px] border-collapse">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 bg-gray-800 px-2 py-1 border border-gray-700 z-20 text-left text-gray-400">
                  {modeConfig.rowEntities} \ {modeConfig.colEntities}
                </th>
                {colEntities.slice(0, maxCols).map(col => (
                  <th
                    key={col.id}
                    className="sticky top-0 bg-gray-800 px-1.5 py-1 border border-gray-700 text-gray-400 vertical-text max-w-[60px] z-10"
                    title={getName(col)}
                  >
                    <div className="rotate-[-45deg] origin-left whitespace-nowrap" style={{ writingMode: 'vertical-rl' }}>
                      {getName(col).slice(0, 8)}{getName(col).length > 8 ? '…' : ''}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowEntities.slice(0, maxRows).map(row => (
                <tr key={row.id}>
                  <td className="sticky left-0 bg-gray-800 px-2 py-1 border border-gray-700 font-medium text-gray-300 max-w-[80px] truncate z-10"
                    title={getName(row)}>
                    {getName(row).slice(0, 10)}{getName(row).length > 10 ? '…' : ''}
                  </td>
                  {colEntities.slice(0, maxCols).map(col => {
                    const linked = (cellData[row.id] || []).includes(col.id);
                    return (
                      <td
                        key={`${row.id}-${col.id}`}
                        className={`border border-gray-700/50 text-center cursor-pointer transition-colors
                          ${linked
                            ? 'bg-accent/40 hover:bg-accent/60'
                            : 'hover:bg-gray-800'}`}
                        onClick={() => toggleCell(row.id, col.id)}
                        title={`${getName(row)} ↔ ${getName(col)}`}
                      >
                        <span className={`text-[8px] ${linked ? 'text-white' : 'text-gray-700'}`}>
                          {linked ? '✅' : '·'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {(rowEntities.length > maxRows || colEntities.length > maxCols) && (
            <div className="text-[9px] text-gray-600 text-center py-2">
              显示 {Math.min(rowEntities.length, maxRows)}/{rowEntities.length} 行 × {Math.min(colEntities.length, maxCols)}/{colEntities.length} 列
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="px-3 py-1.5 border-t border-gray-700 bg-gray-800 flex items-center gap-4 text-[9px] text-gray-500">
        <span>✅ 已关联</span>
        <span>· 未关联（点击关联）</span>
      </div>
    </div>
  );
};

export default RelationMatrix;

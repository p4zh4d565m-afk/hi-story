import React, { useEffect, useRef, useState } from 'react';
import type { Character } from '../types';

interface MindMapProps {
  characters: Character[];
  onSelectCharacter: (id: string) => void;
}

interface NodePos {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
}

const MindMap: React.FC<MindMapProps> = ({ characters, onSelectCharacter }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<NodePos[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Build tree layout
  useEffect(() => {
    if (characters.length === 0) return;

    const cx = 250;
    const cy = 200;

    if (characters.length === 1) {
      setNodes([{ id: characters[0].id, name: characters[0].name, x: cx, y: cy, radius: 50 }]);
      return;
    }

    // Circle layout
    const r = Math.min(180, characters.length * 40);
    const positions: NodePos[] = characters.map((ch, i) => {
      const angle = (2 * Math.PI * i) / characters.length - Math.PI / 2;
      return {
        id: ch.id,
        name: ch.name,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        radius: Math.max(40, Math.min(65, 120 / Math.sqrt(characters.length))),
      };
    });
    setNodes(positions);
  }, [characters]);

  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setDragging(nodeId);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - offset.x;
    const y = e.clientY - rect.top - offset.y;

    setNodes(prev => prev.map(n =>
      n.id === dragging ? { ...n, x, y } : n
    ));
  };

  const handleMouseUp = () => setDragging(null);

  if (characters.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-xs">
        <p>还没有角色，请先在侧栏创建角色</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-[10px] text-gray-500 px-2 py-1">拖拽节点调整位置 · 双击编辑 · 点击连线建立关系</div>
      <svg
        ref={svgRef}
        className="flex-1 w-full"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Connections */}
        {nodes.map((n1, i) =>
          nodes.slice(i + 1).map(n2 => (
            <line key={`${n1.id}-${n2.id}`}
              x1={n1.x} y1={n1.y} x2={n2.x} y2={n2.y}
              stroke="rgba(124,92,252,0.2)" strokeWidth={1} strokeDasharray="4,3" />
          ))
        )}

        {/* Nodes */}
        {nodes.map(node => (
          <g key={node.id} style={{ cursor: dragging === node.id ? 'grabbing' : 'grab' }}
            onMouseDown={(e) => handleMouseDown(e, node.id)}
            onDoubleClick={() => onSelectCharacter(node.id)}>
            <circle cx={node.x} cy={node.y} r={node.radius}
              fill={dragging === node.id ? '#7c5cfc' : '#363650'}
              stroke="#7c5cfc" strokeWidth={1.5} />
            <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="central"
              fill="#e5e7eb" fontSize={Math.max(10, node.radius / 4)} fontFamily="Microsoft YaHei, sans-serif">
              {node.name.length > 6 ? node.name.slice(0, 6) + '..' : node.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

export default MindMap;

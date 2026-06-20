import React, { useEffect, useRef, useState } from 'react';

interface CharacterNode {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface RelationshipEdge {
  source: string;
  target: string;
  type: string;
}

interface RelationshipGraphProps {
  characters: { id: string; name: string }[];
  relationships: RelationshipEdge[];
  width?: number;
  height?: number;
}

const RELATION_COLORS: Record<string, string> = {
  '父母': '#f43f5e',
  '子女': '#f43f5e',
  '恋人': '#ec4899',
  '配偶': '#ec4899',
  '仇敌': '#ef4444',
  '师徒': '#8b5cf6',
  '朋友': '#3b82f6',
  '盟友': '#3b82f6',
  '上下级': '#eab308',
  '其他': '#6b7280',
};

const RelationshipGraph: React.FC<RelationshipGraphProps> = ({
  characters,
  relationships,
  width = 320,
  height = 400,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<CharacterNode[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Initialize node positions
  useEffect(() => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;

    const initialNodes: CharacterNode[] = characters.map((ch, i) => {
      const angle = (2 * Math.PI * i) / characters.length - Math.PI / 2;
      const r = characters.length === 1 ? 0 : radius;
      return {
        id: ch.id,
        name: ch.name,
        x: centerX + r * Math.cos(angle),
        y: centerY + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    setNodes(initialNodes);
  }, [characters.length, width, height]);

  // Force-directed simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const simNodes = nodes.map(n => ({ ...n }));
    const REPULSION = 5000;
    const ATTRACTION = 0.01;
    const DAMPING = 0.9;
    const MIN_DIST = 50;

    const animate = () => {
      // Reset forces
      for (const node of simNodes) {
        node.vx = 0;
        node.vy = 0;
      }

      // Repulsion between all pairs
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const dx = simNodes[j].x - simNodes[i].x;
          const dy = simNodes[j].y - simNodes[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = REPULSION / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          simNodes[i].vx -= fx;
          simNodes[i].vy -= fy;
          simNodes[j].vx += fx;
          simNodes[j].vy += fy;
        }
      }

      // Attraction along edges
      for (const rel of relationships) {
        const source = simNodes.find(n => n.id === rel.source);
        const target = simNodes.find(n => n.id === rel.target);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = ATTRACTION * (dist - MIN_DIST);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      // Center gravity
      const cx = width / 2;
      const cy = height / 2;
      for (const node of simNodes) {
        node.vx += (cx - node.x) * 0.001;
        node.vy += (cy - node.y) * 0.001;
      }

      // Apply velocity with damping
      for (const node of simNodes) {
        node.x += node.vx * DAMPING;
        node.y += node.vy * DAMPING;
        // Clamp to bounds
        node.x = Math.max(30, Math.min(width - 30, node.x));
        node.y = Math.max(20, Math.min(height - 20, node.y));
      }

      setNodes([...simNodes]);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [relationships, width, height]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Draw edges
    for (const rel of relationships) {
      const source = nodes.find(n => n.id === rel.source);
      const target = nodes.find(n => n.id === rel.target);
      if (!source || !target) continue;

      const color = RELATION_COLORS[rel.type] || RELATION_COLORS['其他'];
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.stroke();

      // Label at midpoint
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = color;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(rel.type, mx, my - 4);
      ctx.globalAlpha = 1;
    }

    // Draw nodes
    for (const node of nodes) {
      const isHovered = node.id === hoveredNode;
      const r = isHovered ? 22 : 18;

      // Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? '#7c5cfc' : '#363650';
      ctx.fill();
      ctx.strokeStyle = isHovered ? '#a78bfa' : '#6b7280';
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.stroke();

      // Name
      ctx.fillStyle = '#e5e7eb';
      ctx.font = `${isHovered ? 'bold ' : ''}11px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(node.name.length > 4 ? node.name.slice(0, 4) + '..' : node.name, node.x, node.y - r - 6);
    }
  }, [nodes, relationships, hoveredNode, width, height]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = nodes.find(n => {
      const dx = n.x - mx;
      const dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) < 20;
    });
    setHoveredNode(hit?.id ?? null);
  };

  if (characters.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-600 text-xs py-8">
        <p>还没有角色，无法显示关系图</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="bg-gray-900 rounded border border-gray-700 cursor-pointer"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredNode(null)}
      />
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-2 px-1">
        {Object.entries(RELATION_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
};

export default RelationshipGraph;

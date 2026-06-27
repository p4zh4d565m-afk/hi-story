import React, { useEffect, useRef, useState } from 'react';
import type { Character } from '../types';

// ── Types ──────────────────────────────────────────────

export interface CharacterRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
}

interface NodePos {
  id: string;
  name: string;
  aliases: string;
  personality: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const CARD_W = 130;
const CARD_H = 56;
const CARD_R = 10;

const RELATION_COLORS: Record<string, string> = {
  '父母': '#f43f5e', '子女': '#f43f5e', '配偶': '#ec4899', '恋人': '#ec4899',
  '仇敌': '#ef4444', '师徒': '#8b5cf6', '朋友': '#3b82f6', '盟友': '#3b82f6',
  '上下级': '#eab308', '兄弟姐妹': '#10b981', '情敌': '#f97316', '其他': '#6b7280',
};

const RELATION_TYPES = ['父母', '子女', '配偶', '恋人', '兄弟姐妹', '师徒', '朋友', '盟友', '仇敌', '情敌', '上下级', '其他'];

function getRelationColor(type: string): string {
  return RELATION_COLORS[type] || RELATION_COLORS['其他'];
}

// ── Component ──────────────────────────────────────────

interface MindMapProps {
  characters: Character[];
  relations: CharacterRelation[];
  onSelectCharacter: (id: string) => void;
  onEditCharacter: (id: string) => void;
  onCreateRelation: (sourceId: string, targetId: string) => void;
  onEditRelation: (relation: CharacterRelation) => void;
}

const MindMap: React.FC<MindMapProps> = ({
  characters,
  relations,
  onSelectCharacter,
  onEditCharacter,
  onCreateRelation,
  onEditRelation,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number | null>(null);

  // ── Refs for mutable state (avoid effect re-triggers) ──
  const nodesRef = useRef<NodePos[]>([]);
  const relationsRef = useRef<CharacterRelation[]>(relations);
  const draggingRef = useRef<string | null>(null);
  const viewOffsetRef = useRef({ x: 0, y: 0 });
  const simRunningRef = useRef(false);

  // Keep relationsRef in sync
  relationsRef.current = relations;

  // ── React state for UI binds ──
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredRelation, setHoveredRelation] = useState<CharacterRelation | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [dirty, setDirty] = useState(0); // bump to trigger redraw

  // Sync dragging ref
  useEffect(() => { draggingRef.current = dragging; }, [dragging]);
  useEffect(() => { viewOffsetRef.current = viewOffset; }, [viewOffset]);

  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  // ── Observe container size ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = containerSize.w;
  const H = containerSize.h;

  // ── Sync characters → nodes (only when character list changes) ──
  // Use a stable key: array of ids + metadata
  const charKey = characters.map(c => `${c.id}|${c.name}|${c.aliases || ''}|${(c.personality || '').slice(0, 20)}`).join(',');

  useEffect(() => {
    const cx = W / 2;
    const cy = H / 2;
    const prev = nodesRef.current;
    const prevMap = new Map(prev.map(n => [n.id, n]));

    let changed = false;
    const updated = characters.map((ch, i) => {
      const existing = prevMap.get(ch.id);
      if (existing) {
        // Only update if metadata changed
        if (existing.name !== ch.name || existing.aliases !== (ch.aliases || '') || existing.personality !== (ch.personality || '')) {
          changed = true;
          return { ...existing, name: ch.name, aliases: ch.aliases || '', personality: ch.personality || '' };
        }
        return existing;
      }
      changed = true;
      const angle = (2 * Math.PI * i) / Math.max(characters.length, 1) - Math.PI / 2;
      const r = Math.min(250, characters.length * 55);
      return {
        id: ch.id,
        name: ch.name,
        aliases: ch.aliases || '',
        personality: ch.personality || '',
        x: cx + r * Math.cos(angle) + (Math.random() - 0.5) * 40,
        y: cy + r * Math.sin(angle) + (Math.random() - 0.5) * 40,
        vx: 0, vy: 0,
      };
    });

    // Remove nodes for deleted characters
    if (updated.length !== prev.length) changed = true;

    if (changed) {
      nodesRef.current = updated;
      setDirty(n => n + 1);
    }
  }, [charKey, W, H]);

  // ── Force simulation (runs once, self-sustaining via rAF) ──
  useEffect(() => {
    if (nodesRef.current.length === 0) return;
    if (simRunningRef.current) return; // already running
    simRunningRef.current = true;

    const REPULSION = 8000;
    const ATTRACTION = 0.015;
    const DAMPING = 0.85;

    let lastDraw = 0;

    const animate = () => {
      const simNodes = nodesRef.current;
      const rels = relationsRef.current;

      if (!draggingRef.current) {
        const cx = W / 2 + viewOffsetRef.current.x;
        const cy = H / 2 + viewOffsetRef.current.y;

        for (const n of simNodes) { n.vx = 0; n.vy = 0; }

        // Repulsion
        for (let i = 0; i < simNodes.length; i++) {
          for (let j = i + 1; j < simNodes.length; j++) {
            const dx = simNodes[j].x - simNodes[i].x;
            const dy = simNodes[j].y - simNodes[i].y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 10);
            const force = REPULSION / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            simNodes[i].vx -= fx; simNodes[i].vy -= fy;
            simNodes[j].vx += fx; simNodes[j].vy += fy;
          }
        }

        // Attraction along relations
        for (const rel of rels) {
          const s = simNodes.find(n => n.id === rel.sourceId);
          const t = simNodes.find(n => n.id === rel.targetId);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 10);
          const force = ATTRACTION * (dist - 180);
          s.vx += (dx / dist) * force;
          s.vy += (dy / dist) * force;
          t.vx -= (dx / dist) * force;
          t.vy -= (dy / dist) * force;
        }

        // Center gravity
        for (const n of simNodes) {
          n.vx += (cx - n.x) * 0.0005;
          n.vy += (cy - n.y) * 0.0005;
        }

        for (const n of simNodes) {
          n.x += n.vx * DAMPING;
          n.y += n.vy * DAMPING;
          n.x = Math.max(CARD_W / 2, Math.min(W * 3 - CARD_W / 2, n.x));
          n.y = Math.max(CARD_H / 2, Math.min(H * 3 - CARD_H / 2, n.y));
        }
      }

      // Throttle redraws to ~30fps
      const now = performance.now();
      if (now - lastDraw > 33) {
        setDirty(n => n + 1);
        lastDraw = now;
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => {
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
      simRunningRef.current = false;
    };
  }, [W, H]); // only restart if container size changes

  // ── Draw (triggered by `dirty`) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, W, H);

    const simNodes = nodesRef.current;
    const rels = relationsRef.current;
    const vo = viewOffsetRef.current;

    ctx.save();
    ctx.translate(vo.x, vo.y);
    ctx.scale(scale, scale);

    // ── Draw connections ──
    const drawnPairs = new Set<string>();

    for (const rel of rels) {
      const s = simNodes.find(n => n.id === rel.sourceId);
      const t = simNodes.find(n => n.id === rel.targetId);
      if (!s || !t) continue;

      const pairKey = [rel.sourceId, rel.targetId].sort().join('-');
      drawnPairs.add(pairKey);

      const isHovered = hoveredRelation?.id === rel.id;
      const color = getRelationColor(rel.relationType);

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isHovered ? color : color + '99';
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.stroke();

      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2;
      drawRelationLabel(ctx, rel.relationType, mx, my, color, isHovered);
    }

    // Dashed lines for non-related pairs within range
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const pairKey = [simNodes[i].id, simNodes[j].id].sort().join('-');
        if (drawnPairs.has(pairKey)) continue;

        const dx = simNodes[j].x - simNodes[i].x;
        const dy = simNodes[j].y - simNodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 350) continue;

        ctx.beginPath();
        ctx.moveTo(simNodes[i].x, simNodes[i].y);
        ctx.lineTo(simNodes[j].x, simNodes[j].y);
        ctx.strokeStyle = 'rgba(100,100,120,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        const mx = (simNodes[i].x + simNodes[j].x) / 2;
        const my = (simNodes[i].y + simNodes[j].y) / 2;
        const isHoveredPlus = hoveredRelation &&
          (hoveredRelation.sourceId === simNodes[i].id && hoveredRelation.targetId === simNodes[j].id ||
           hoveredRelation.sourceId === simNodes[j].id && hoveredRelation.targetId === simNodes[i].id);

        ctx.beginPath();
        ctx.arc(mx, my, isHoveredPlus ? 10 : 7, 0, Math.PI * 2);
        ctx.fillStyle = isHoveredPlus ? '#7fb380' : 'rgba(60,80,56,0.6)';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `${isHoveredPlus ? 'bold ' : ''}10px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', mx, my);
      }
    }

    // Linking line
    if (linkingFrom) {
      const src = simNodes.find(n => n.id === linkingFrom);
      if (src) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(
          (mousePos.x - vo.x) / scale,
          (mousePos.y - vo.y) / scale
        );
        ctx.strokeStyle = '#7fb380';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── Draw nodes ──
    for (const node of simNodes) {
      const isHovered = hoveredNode === node.id;
      const isDraggingNode = dragging === node.id;
      const isLinkSrc = linkingFrom === node.id;

      const x = node.x - CARD_W / 2;
      const y = node.y - CARD_H / 2;

      ctx.shadowColor = isHovered || isDraggingNode || isLinkSrc ? 'rgba(127,179,128,0.5)' : 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = isHovered || isLinkSrc ? 16 : 6;
      ctx.shadowOffsetY = 2;

      ctx.beginPath();
      roundRect(ctx, x, y, CARD_W, CARD_H, CARD_R);
      ctx.fillStyle = isHovered || isLinkSrc ? '#3c5636' : isDraggingNode ? '#4a6b44' : '#2a2a3e';
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = isHovered || isLinkSrc ? '#a5c9a5' : isDraggingNode ? '#8bb88b' : 'rgba(127,179,128,0.35)';
      ctx.lineWidth = isHovered || isLinkSrc ? 2.5 : isDraggingNode ? 2 : 1.5;
      ctx.stroke();

      ctx.fillStyle = '#e5e7eb';
      ctx.font = `${isHovered ? 'bold ' : ''}13px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const displayName = node.name.length > 6 ? node.name.slice(0, 6) + '…' : node.name;
      ctx.fillText(displayName, node.x, node.y - 10);

      const subtitle = node.aliases || (node.personality || '').slice(0, 10);
      if (subtitle) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px "Microsoft YaHei", sans-serif';
        const displaySub = subtitle.length > 10 ? subtitle.slice(0, 10) + '…' : subtitle;
        ctx.fillText(displaySub, node.x, node.y + 11);
      }

      if (isLinkSrc) {
        ctx.fillStyle = '#7fb380';
        ctx.font = '9px "Microsoft YaHei", sans-serif';
        ctx.fillText('拖到目标角色', node.x, node.y - CARD_H / 2 - 12);
      }
    }

    ctx.restore();

    // Relation tooltip (screen-space)
    if (hoveredRelation && hoveredRelation.id) {
      const rel = rels.find(r => r.id === hoveredRelation.id);
      if (rel) {
        const s = simNodes.find(n => n.id === rel.sourceId);
        const t = simNodes.find(n => n.id === rel.targetId);
        if (s && t) {
          const mx = (s.x + t.x) / 2 * scale + vo.x;
          const my = (s.y + t.y) / 2 * scale + vo.y;
          ctx.fillStyle = 'rgba(0,0,0,0.85)';
          ctx.font = '11px "Microsoft YaHei", sans-serif';
          const text = `点击编辑关系: ${rel.relationType}`;
          const tw = ctx.measureText(text).width;
          ctx.fillRect(mx - tw / 2 - 8, my - 22, tw + 16, 22);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, mx, my - 11);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, hoveredNode, hoveredRelation, dragging, linkingFrom, mousePos, scale]);

  // ── Helpers ──

  function screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const vo = viewOffsetRef.current;
    return {
      x: (sx - vo.x) / scale,
      y: (sy - vo.y) / scale,
    };
  }

  function hitTestNode(wx: number, wy: number): NodePos | null {
    for (const n of nodesRef.current) {
      if (Math.abs(wx - n.x) < CARD_W / 2 + 4 && Math.abs(wy - n.y) < CARD_H / 2 + 4) {
        return n;
      }
    }
    return null;
  }

  function hitTestRelation(wx: number, wy: number): CharacterRelation | null {
    const rels = relationsRef.current;
    const simNodes = nodesRef.current;

    for (const rel of rels) {
      const s = simNodes.find(n => n.id === rel.sourceId);
      const t = simNodes.find(n => n.id === rel.targetId);
      if (!s || !t) continue;
      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2;
      if (Math.hypot(wx - mx, wy - my) < 20) return rel;
    }

    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const dx = simNodes[j].x - simNodes[i].x;
        const dy = simNodes[j].y - simNodes[i].y;
        if (Math.sqrt(dx * dx + dy * dy) >= 350) continue;

        const pairKey = [simNodes[i].id, simNodes[j].id].sort().join('-');
        const exists = rels.some(r => [r.sourceId, r.targetId].sort().join('-') === pairKey);
        if (exists) continue;

        const mx = (simNodes[i].x + simNodes[j].x) / 2;
        const my = (simNodes[i].y + simNodes[j].y) / 2;
        if (Math.hypot(wx - mx, wy - my) < 12) {
          return { id: '', sourceId: simNodes[i].id, targetId: simNodes[j].id, relationType: '' };
        }
      }
    }
    return null;
  }

  function handleMouseDown(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      setPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button !== 0) return;

    const hitRel = hitTestRelation(world.x, world.y);
    if (hitRel) {
      if (hitRel.id) { onEditRelation(hitRel); }
      else { onCreateRelation(hitRel.sourceId, hitRel.targetId); }
      return;
    }

    const hit = hitTestNode(world.x, world.y);
    if (hit) {
      if (e.shiftKey) {
        setLinkingFrom(hit.id);
        return;
      }
      setDragging(hit.id);
      setDragStart({ x: world.x - hit.x, y: world.y - hit.y });
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setMousePos({ x: sx, y: sy });

    if (panning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setViewOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const world = screenToWorld(sx, sy);

    if (dragging) {
      nodesRef.current = nodesRef.current.map(n =>
        n.id === dragging
          ? { ...n, x: world.x - dragStart.x, y: world.y - dragStart.y, vx: 0, vy: 0 }
          : n
      );
      setDirty(n => n + 1);
      return;
    }

    setHoveredNode(hitTestNode(world.x, world.y)?.id ?? null);
    setHoveredRelation(hitTestRelation(world.x, world.y));
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (panning) { setPanning(false); return; }
    if (dragging) { setDragging(null); return; }

    if (linkingFrom) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) { setLinkingFrom(null); return; }
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const target = hitTestNode(world.x, world.y);
      if (target && target.id !== linkingFrom) {
        const pairKey = [linkingFrom, target.id].sort().join('-');
        const exists = relationsRef.current.some(r => [r.sourceId, r.targetId].sort().join('-') === pairKey);
        if (!exists) { onCreateRelation(linkingFrom, target.id); }
      }
      setLinkingFrom(null);
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTestNode(world.x, world.y);
    if (hit) { onEditCharacter(hit.id); }
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale(prev => Math.max(0.3, Math.min(2.5, prev + delta)));
  }

  // ── Render ──
  if (characters.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        <div className="text-center">
          <p className="text-3xl mb-2">🧠</p>
          <p>还没有角色</p>
          <p className="text-xs mt-1 text-gray-600">先创建角色，再在这里查看关系图</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-gray-950">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800 text-[10px] text-gray-500 shrink-0">
        <span>🖱 拖拽移动</span>
        <span className="text-gray-700">|</span>
        <span>🔗 Shift+拖拽 连关系</span>
        <span className="text-gray-700">|</span>
        <span>🔄 滚轮缩放</span>
        <span className="text-gray-700">|</span>
        <span>✋ Ctrl+拖拽 平移</span>
        <span className="text-gray-700">|</span>
        <span>双击编辑角色</span>
        <span className="flex-1" />
        <span className="text-gray-600">{(scale * 100).toFixed(0)}%</span>
        <button
          onClick={() => { setViewOffset({ x: 0, y: 0 }); setScale(1); }}
          className="text-accent hover:text-accent-hover transition-colors"
        >
          重置视图
        </button>
      </div>

      <canvas
        ref={canvasRef}
        style={{ width: '100%', flex: 1 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setDragging(null); setPanning(false); setLinkingFrom(null);
          setHoveredNode(null); setHoveredRelation(null);
        }}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onContextMenu={e => e.preventDefault()}
        className="cursor-grab"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-t border-gray-800 shrink-0">
        {RELATION_TYPES.map(type => (
          <span key={type} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getRelationColor(type) }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
};

// ── Canvas helpers ──

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawRelationLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, color: string, hovered: boolean) {
  ctx.font = `${hovered ? 'bold ' : ''}10px "Microsoft YaHei", sans-serif`;
  const tw = ctx.measureText(label).width;
  const padding = 4;
  const lw = tw + padding * 2;
  const lh = 16;

  ctx.beginPath();
  roundRect(ctx, x - lw / 2, y - lh / 2, lw, lh, 8);
  ctx.fillStyle = hovered ? color : 'rgba(0,0,0,0.75)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = hovered ? 1.5 : 1;
  ctx.stroke();

  ctx.fillStyle = hovered ? '#fff' : color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

export default MindMap;

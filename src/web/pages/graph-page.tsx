import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";

import { fetchJson, getErrorMessage } from "../lib/http-client.js";

interface GraphNode {
  lineage_id: string;
  entry_id?: string;
  title: string;
  type: string;
  depth: number;
  degree?: number;
}

interface GraphEdge {
  source_lineage_id: string;
  target_lineage_id: string;
  relation_type: string;
  signal: string;
  score: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

type AppTab = "entries" | "new" | "agents" | "proposals" | "dashboard" | "keys" | "howto" | "graph";

export interface GraphPageProps {
  selectedLineageId: string | null;
  setSelectedLineageId: (id: string) => void;
  setTab: (tab: AppTab) => void;
}

const SVG_WIDTH = 900;
const SVG_HEIGHT = 600;
const GRAPH_PANEL_HEIGHT = "clamp(420px, 70vh, 760px)";
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nodeColor(type: string): string {
  if (type === "skill") return "var(--accent)";
  if (type === "mistake" || type === "lesson") return "var(--accent-2)";
  if (type === "project" || type === "reference") return "var(--accent-3)";
  return "rgba(236,243,158,0.68)";
}

function edgeColor(signal: string): string {
  if (signal === "explicit") return "var(--accent)";
  if (signal === "tag") return "var(--accent-3)";
  return "rgba(255,255,255,0.4)";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "...";
}

export function GraphPage({ selectedLineageId, setSelectedLineageId, setTab }: GraphPageProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [positions, setPositions] = useState<SimNode[]>([]);
  const [globalMode, setGlobalMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [svgWidth, setSvgWidth] = useState(SVG_WIDTH);
  const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, scale: 1 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<"idle" | "pan" | "drag-node">("idle");

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map());
  const activePointerModeRef = useRef<"pan" | "node-drag" | null>(null);
  const activeNodeIdRef = useRef<string | null>(null);
  const gestureStartRef = useRef<{ x: number; y: number; viewportX: number; viewportY: number } | null>(null);
  const movedDuringGestureRef = useRef(false);
  const dragRafRef = useRef(0);

  const safeGraphData = useMemo(() => {
    if (!graphData) {
      return null;
    }

    const nodeIds = new Set(graphData.nodes.map((node) => node.lineage_id));
    const edges = graphData.edges.filter(
      (edge) => nodeIds.has(edge.source_lineage_id) && nodeIds.has(edge.target_lineage_id)
    );

    return {
      nodes: graphData.nodes,
      edges,
      droppedEdges: graphData.edges.length - edges.length,
    };
  }, [graphData]);

  useEffect(() => {
    if (!globalMode && !selectedLineageId) {
      setGraphData(null);
      setPositions([]);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    const load = async () => {
      try {
        const url = globalMode
          ? "/owner/graph?limit=200"
          : `/owner/entries/${encodeURIComponent(selectedLineageId!)}/graph?depth=2&signals=explicit,tag,fts&direction=both`;

        const data = await fetchJson<GraphData>(
          url,
          { signal: controller.signal },
          "Failed to load graph data."
        );

        setGraphData(data);
        setViewport({ x: 0, y: 0, scale: 1 });
        setHoveredNodeId(null);
      } catch (err) {
        if (!controller.signal.aborted) {
          setLoadError(getErrorMessage(err, "Failed to load graph data."));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [globalMode, selectedLineageId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width } = entry.contentRect;
      if (width > 0) {
        setSvgWidth((prev) => (Math.abs(prev - width) > 1 ? width : prev));
      }
    });

    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!safeGraphData || safeGraphData.nodes.length === 0) {
      setPositions([]);
      simulationRef.current?.stop();
      simulationRef.current = null;
      return;
    }

    if (safeGraphData.droppedEdges > 0) {
      // Keep rendering resilient even if payload includes orphaned links.
      // eslint-disable-next-line no-console
      console.warn(`Graph payload dropped ${safeGraphData.droppedEdges} invalid edge(s).`);
    }

    const width = Math.max(svgWidth, 320);
    const height = SVG_HEIGHT;

    const localDegreeMap = new Map<string, number>();
    for (const edge of safeGraphData.edges) {
      localDegreeMap.set(edge.source_lineage_id, (localDegreeMap.get(edge.source_lineage_id) ?? 0) + 1);
      localDegreeMap.set(edge.target_lineage_id, (localDegreeMap.get(edge.target_lineage_id) ?? 0) + 1);
    }

    const nodePositions: SimNode[] = safeGraphData.nodes.map((node) => ({
      id: node.lineage_id,
      x: width / 2 + (Math.random() - 0.5) * 240,
      y: height / 2 + (Math.random() - 0.5) * 220,
    }));

    nodesRef.current = nodePositions;
    nodeMapRef.current = new Map(nodePositions.map((node) => [node.id, node]));

    const edgeLinks: SimLink[] = safeGraphData.edges.map((edge) => ({
      source: edge.source_lineage_id,
      target: edge.target_lineage_id,
    }));

    let simulation: Simulation<SimNode, SimLink>;
    try {
      simulation = forceSimulation<SimNode>(nodePositions)
        .force(
          "link",
          forceLink<SimNode, SimLink>(edgeLinks)
            .id((node: SimNode) => node.id)
            .distance(80)
        )
        .force(
          "collision",
          forceCollide<SimNode>().radius((node: SimNode) => {
            const degree = localDegreeMap.get(node.id) ?? 0;
            return Math.min(34, Math.max(12, Math.sqrt(degree + 1) * 7));
          })
        )
        .force("charge", forceManyBody<SimNode>().strength(globalMode ? -140 : -260))
        .force("center", forceCenter(width / 2, height / 2));
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to render graph simulation."));
      setPositions([]);
      return;
    }

    simulationRef.current = simulation;

    let rafId = 0;
    simulation.on("tick", () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setPositions([...nodePositions]);
      });
    });

    simulation.on("end", () => {
      setPositions([...nodePositions]);
    });

    return () => {
      cancelAnimationFrame(rafId);
      simulation.stop();
      if (simulationRef.current === simulation) {
        simulationRef.current = null;
      }
    };
  }, [globalMode, safeGraphData, svgWidth]);

  const toWorldPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) {
        return null;
      }

      const rect = svg.getBoundingClientRect();
      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      };
    },
    [viewport]
  );

  const zoomAroundPoint = useCallback((anchorX: number, anchorY: number, scale: number) => {
    setViewport((prev) => {
      const nextScale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
      if (nextScale === prev.scale) {
        return prev;
      }

      const worldX = (anchorX - prev.x) / prev.scale;
      const worldY = (anchorY - prev.y) / prev.scale;
      return {
        x: anchorX - worldX * nextScale,
        y: anchorY - worldY * nextScale,
        scale: nextScale,
      };
    });
  }, []);

  const releaseDraggedNode = useCallback(() => {
    const nodeId = activeNodeIdRef.current;
    if (!nodeId) {
      return;
    }

    const node = nodeMapRef.current.get(nodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
    }

    simulationRef.current?.alphaTarget(0);
    activeNodeIdRef.current = null;
  }, []);

  const endPointerInteraction = useCallback(() => {
    if (activePointerModeRef.current === "node-drag") {
      cancelAnimationFrame(dragRafRef.current);
      releaseDraggedNode();
    }

    activePointerModeRef.current = null;
    gestureStartRef.current = null;
    setInteractionMode("idle");
  }, [releaseDraggedNode]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<SVGSVGElement>) => {
      event.preventDefault();

      const svg = svgRef.current;
      if (!svg) {
        return;
      }

      const rect = svg.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      const nextScale = viewport.scale * (event.deltaY < 0 ? 1.12 : 0.89);
      zoomAroundPoint(anchorX, anchorY, nextScale);
    },
    [viewport.scale, zoomAroundPoint]
  );

  const handleSurfacePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) {
        return;
      }

      activePointerModeRef.current = "pan";
      gestureStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        viewportX: viewport.x,
        viewportY: viewport.y,
      };
      movedDuringGestureRef.current = false;
      setInteractionMode("pan");
    },
    [viewport.x, viewport.y]
  );

  const handleNodePointerDown = useCallback(
    (lineageId: string, event: ReactPointerEvent<SVGGElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.stopPropagation();

      const node = nodeMapRef.current.get(lineageId);
      const point = toWorldPoint(event.clientX, event.clientY);
      if (!node || !point) {
        return;
      }

      node.fx = point.x;
      node.fy = point.y;
      activeNodeIdRef.current = lineageId;
      activePointerModeRef.current = "node-drag";
      gestureStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        viewportX: viewport.x,
        viewportY: viewport.y,
      };
      movedDuringGestureRef.current = false;
      setInteractionMode("drag-node");

      simulationRef.current?.alphaTarget(0.25).restart();
    },
    [toWorldPoint, viewport.x, viewport.y]
  );

  const handleSurfacePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const start = gestureStartRef.current;
      if (!start) {
        return;
      }

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!movedDuringGestureRef.current && Math.hypot(dx, dy) > 2) {
        movedDuringGestureRef.current = true;
      }

      if (activePointerModeRef.current === "pan") {
        setViewport((current) => ({
          ...current,
          x: start.viewportX + dx,
          y: start.viewportY + dy,
        }));
        return;
      }

      if (activePointerModeRef.current === "node-drag") {
        const nodeId = activeNodeIdRef.current;
        if (!nodeId) {
          return;
        }

        const node = nodeMapRef.current.get(nodeId);
        const point = toWorldPoint(event.clientX, event.clientY);
        if (!node || !point) {
          return;
        }

        node.fx = point.x;
        node.fy = point.y;
        simulationRef.current?.alphaTarget(0.25).restart();
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = requestAnimationFrame(() => {
          setPositions([...nodesRef.current]);
        });
      }
    },
    [toWorldPoint]
  );

  const handleSurfacePointerUp = useCallback(
    (_event: ReactPointerEvent<SVGSVGElement>) => {
      endPointerInteraction();
    },
    [endPointerInteraction]
  );

  const zoomIn = useCallback(() => {
    zoomAroundPoint(svgWidth / 2, SVG_HEIGHT / 2, viewport.scale * 1.2);
  }, [svgWidth, viewport.scale, zoomAroundPoint]);

  const zoomOut = useCallback(() => {
    zoomAroundPoint(svgWidth / 2, SVG_HEIGHT / 2, viewport.scale * 0.83);
  }, [svgWidth, viewport.scale, zoomAroundPoint]);

  const resetView = useCallback(() => {
    setViewport({ x: 0, y: 0, scale: 1 });
  }, []);

  const degreeMap = new Map<string, number>();
  if (safeGraphData) {
    for (const edge of safeGraphData.edges) {
      degreeMap.set(edge.source_lineage_id, (degreeMap.get(edge.source_lineage_id) ?? 0) + 1);
      degreeMap.set(edge.target_lineage_id, (degreeMap.get(edge.target_lineage_id) ?? 0) + 1);
    }
  }

  const posMap = new Map<string, SimNode>();
  for (const position of positions) {
    posMap.set(position.id, position);
  }

  const nodeCount = safeGraphData?.nodes.length ?? 0;
  const edgeCount = safeGraphData?.edges.length ?? 0;
  const hoveredNode =
    safeGraphData?.nodes.find((node) => node.lineage_id === hoveredNodeId) ?? null;

  const modeLabel = globalMode ? "Global Map" : selectedLineageId ? "Entry Neighborhood" : "-";

  return (
    <section
      className="cyber-card cyber-card--terminal"
      style={{
        display: "flex",
        flexDirection: "column",
        height: GRAPH_PANEL_HEIGHT,
        maxHeight: GRAPH_PANEL_HEIGHT,
        overflow: "hidden",
      }}
    >
      <div className="terminal__bar" style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <span className="terminal__title">Graph - {modeLabel}</span>
        {!loading && safeGraphData && (
          <span style={{ color: "var(--muted-fg)", fontSize: "0.8rem" }}>
            {nodeCount} nodes - {edgeCount} edges
          </span>
        )}
        <button
          type="button"
          className="cyber-btn cyber-btn--ghost cyber-btn--sm"
          onClick={() => setGlobalMode((mode) => !mode)}
          style={{ marginLeft: "auto" }}
        >
          {globalMode ? "Entry View" : "Global Map"}
        </button>
      </div>

      <div
        ref={containerRef}
        className="terminal__body"
        style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}
      >
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            padding: "0.35rem",
            border: "1px solid var(--border)",
            background: "rgba(19,42,19,0.78)",
            backdropFilter: "blur(3px)",
            borderRadius: "6px",
          }}
        >
          <button type="button" className="cyber-btn cyber-btn--ghost cyber-btn--sm" onClick={zoomOut}>
            -
          </button>
          <button type="button" className="cyber-btn cyber-btn--ghost cyber-btn--sm" onClick={zoomIn}>
            +
          </button>
          <button type="button" className="cyber-btn cyber-btn--ghost cyber-btn--sm" onClick={resetView}>
            Reset
          </button>
        </div>

        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            zIndex: 3,
            color: "var(--muted-fg)",
            background: "rgba(19,42,19,0.72)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "0.5rem 0.65rem",
            fontSize: "0.75rem",
            lineHeight: 1.5,
          }}
        >
          <div>Drag background to pan</div>
          <div>Wheel to zoom</div>
          <div>Drag node to reposition</div>
        </div>

        {hoveredNode && (
          <div
            style={{
              position: "absolute",
              left: 12,
              top: 12,
              zIndex: 3,
              maxWidth: "20rem",
              color: "var(--fg)",
              background: "rgba(19,42,19,0.82)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "0.6rem 0.75rem",
            }}
          >
            <div style={{ fontFamily: "var(--font-accent)", fontSize: "0.75rem", letterSpacing: "0.08em" }}>
              {hoveredNode.type}
            </div>
            <div style={{ fontSize: "0.84rem", marginTop: "0.2rem" }}>{hoveredNode.title}</div>
          </div>
        )}

        {loading && <p role="status" style={{ padding: "1rem" }}>Loading graph...</p>}

        {loadError && (
          <p role="alert" style={{ padding: "1rem", color: "var(--accent-2)" }}>
            {loadError}
          </p>
        )}

        {!loading && !loadError && !globalMode && !selectedLineageId && (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--muted-fg)", marginBottom: "1rem" }}>Select an entry to see its graph</p>
            <button
              type="button"
              className="cyber-btn cyber-btn--ghost cyber-btn--sm"
              onClick={() => setGlobalMode(true)}
            >
              Switch to Global View
            </button>
          </div>
        )}

        {!loading && !loadError && safeGraphData && safeGraphData.nodes.length === 0 && (
          <p role="status" style={{ padding: "1rem" }}>No related graph data found for this entry.</p>
        )}

        {!loading && !loadError && safeGraphData && positions.length > 0 && (
          <svg
            ref={svgRef}
            width="100%"
            height={SVG_HEIGHT}
            viewBox={`0 0 ${svgWidth} ${SVG_HEIGHT}`}
            onWheel={handleWheel}
            onPointerDown={handleSurfacePointerDown}
            onPointerMove={handleSurfacePointerMove}
            onPointerUp={handleSurfacePointerUp}
            onPointerCancel={handleSurfacePointerUp}
            onPointerLeave={handleSurfacePointerUp}
            style={{
              display: "block",
              cursor: interactionMode === "idle" ? "grab" : "grabbing",
              touchAction: "none",
              userSelect: "none",
            }}
          >
            <defs>
              <radialGradient id="graph-bg" cx="50%" cy="45%" r="75%">
                <stop offset="0%" stopColor="rgba(49,87,44,0.34)" />
                <stop offset="100%" stopColor="rgba(19,42,19,0.12)" />
              </radialGradient>
            </defs>

            <rect width={svgWidth} height={SVG_HEIGHT} fill="url(#graph-bg)" />

            <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
              <g>
                {safeGraphData.edges.map((edge) => {
                  const src = posMap.get(edge.source_lineage_id);
                  const tgt = posMap.get(edge.target_lineage_id);
                  if (!src || !tgt) return null;

                  return (
                    <line
                      key={`${edge.source_lineage_id}:${edge.target_lineage_id}`}
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke={edgeColor(edge.signal)}
                      strokeWidth={edge.signal === "explicit" ? 2 : 1.4}
                      strokeOpacity={edge.signal === "fts" ? 0.34 : 0.72}
                      strokeDasharray={edge.signal === "fts" ? "4 5" : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </g>

              <g>
                {safeGraphData.nodes.map((node) => {
                  const pos = posMap.get(node.lineage_id);
                  if (!pos) return null;

                  const degree = degreeMap.get(node.lineage_id) ?? 0;
                  const radius = Math.min(30, Math.max(9, Math.sqrt(degree + 1) * 7.4));
                  const isRoot = node.lineage_id === selectedLineageId;
                  const isHovered = hoveredNodeId === node.lineage_id;
                  const color = nodeColor(node.type);
                  const showLabel = isRoot || isHovered;

                  return (
                    <g
                      key={node.lineage_id}
                      transform={`translate(${pos.x},${pos.y})`}
                      style={{ cursor: interactionMode === "idle" ? "pointer" : "grabbing" }}
                      onPointerDown={(event) => handleNodePointerDown(node.lineage_id, event)}
                      onMouseEnter={() => setHoveredNodeId(node.lineage_id)}
                      onMouseLeave={() => setHoveredNodeId((current) => (current === node.lineage_id ? null : current))}
                      onClick={() => {
                        if (movedDuringGestureRef.current) {
                          movedDuringGestureRef.current = false;
                          return;
                        }

                        setSelectedLineageId(node.lineage_id);
                        setTab("entries");
                      }}
                    >
                      <circle
                        r={radius}
                        fill={color}
                        fillOpacity={isHovered ? 0.95 : 0.82}
                        stroke={isRoot ? "white" : color}
                        strokeWidth={isRoot ? 2.8 : isHovered ? 2 : 1.2}
                        strokeOpacity={isRoot ? 1 : 0.66}
                      >
                        <title>{node.title}</title>
                      </circle>

                      {showLabel && (
                        <text
                          x={radius + 6}
                          y={4}
                          fontSize={11}
                          fill="rgba(255,255,255,0.86)"
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {truncate(node.title, 26)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}
      </div>
    </section>
  );
}

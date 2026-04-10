import { useEffect, useRef, useState } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCenter } from "d3-force";

import { fetchJson, getErrorMessage } from "../lib/http-client.js";

interface GraphNode {
  lineage_id: string;
  title: string;
  type: string;
  depth: number;
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

export interface GraphPageProps {
  selectedLineageId: string | null;
  setSelectedLineageId: (id: string) => void;
  setTab: (tab: string) => void;
}

function nodeColor(type: string): string {
  if (type === "skill") return "var(--cyber-primary)";
  if (type === "mistake" || type === "lesson") return "var(--cyber-accent)";
  return "var(--cyber-dim, rgba(255,255,255,0.35))";
}

function edgeColor(signal: string): string {
  if (signal === "explicit") return "var(--cyber-primary)";
  if (signal === "tag") return "var(--cyber-accent)";
  return "rgba(255,255,255,0.4)";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

const SVG_WIDTH = 900;
const SVG_HEIGHT = 600;

export function GraphPage({ selectedLineageId, setSelectedLineageId, setTab }: GraphPageProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [positions, setPositions] = useState<SimNode[]>([]);
  const [globalMode, setGlobalMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [svgDimensions, setSvgDimensions] = useState({ width: SVG_WIDTH, height: SVG_HEIGHT });
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch graph data when mode or selectedLineageId changes
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

  // ResizeObserver to reactively update SVG dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0) setSvgDimensions({ width, height: Math.max(height, 400) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Run d3-force simulation when graph data changes
  useEffect(() => {
    if (!graphData || graphData.nodes.length === 0) {
      setPositions([]);
      return;
    }

    const width = svgDimensions.width;
    const height = svgDimensions.height;

    const nodePositions: SimNode[] = graphData.nodes.map((n) => ({
      id: n.lineage_id,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
    }));

    const edgeLinks: SimLink[] = graphData.edges.map((e) => ({
      source: e.source_lineage_id,
      target: e.target_lineage_id,
    }));

    const simulation = forceSimulation<SimNode>(nodePositions)
      .force(
        "link",
        forceLink<SimNode, SimLink>(edgeLinks)
          .id((d) => d.id)
          .distance(80)
      )
      .force("charge", forceManyBody<SimNode>().strength(-200))
      .force("center", forceCenter(width / 2, height / 2));

    let rafId: number;
    simulation.on("tick", () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setPositions([...nodePositions]);
      });
    });

    // Stop after reasonable time to avoid infinite ticking
    simulation.on("end", () => {
      setPositions([...nodePositions]);
    });

    return () => {
      cancelAnimationFrame(rafId);
      simulation.stop();
    };
  }, [graphData, svgDimensions]);

  // Compute degree map for node sizing
  const degreeMap = new Map<string, number>();
  if (graphData) {
    for (const e of graphData.edges) {
      degreeMap.set(e.source_lineage_id, (degreeMap.get(e.source_lineage_id) ?? 0) + 1);
      degreeMap.set(e.target_lineage_id, (degreeMap.get(e.target_lineage_id) ?? 0) + 1);
    }
  }

  // Build position lookup
  const posMap = new Map<string, SimNode>();
  for (const p of positions) {
    posMap.set(p.id, p);
  }

  const nodeCount = graphData?.nodes.length ?? 0;
  const edgeCount = graphData?.edges.length ?? 0;

  const modeLabel = globalMode ? "Global Map" : selectedLineageId ? "Entry Neighborhood" : "—";

  return (
    <section className="cyber-card cyber-card--terminal" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="terminal__bar" style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <span className="terminal__title">
          Graph — {modeLabel}
        </span>
        {!loading && graphData && (
          <span style={{ color: "var(--cyber-dim, rgba(255,255,255,0.4))", fontSize: "0.8rem" }}>
            {nodeCount} nodes · {edgeCount} edges
          </span>
        )}
        <button
          type="button"
          className="cyber-btn cyber-btn--ghost cyber-btn--sm"
          onClick={() => setGlobalMode((m) => !m)}
          style={{ marginLeft: "auto" }}
        >
          {globalMode ? "Entry View" : "Global Map"}
        </button>
      </div>

      <div
        ref={containerRef}
        className="terminal__body"
        style={{ flex: 1, position: "relative", overflow: "hidden" }}
      >
        {loading && (
          <p role="status" style={{ padding: "1rem" }}>Loading graph...</p>
        )}

        {loadError && (
          <p role="alert" style={{ padding: "1rem", color: "var(--cyber-accent)" }}>{loadError}</p>
        )}

        {!loading && !loadError && !globalMode && !selectedLineageId && (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--cyber-dim, rgba(255,255,255,0.4))", marginBottom: "1rem" }}>
              Select an entry to see its graph
            </p>
            <button
              type="button"
              className="cyber-btn cyber-btn--ghost cyber-btn--sm"
              onClick={() => setGlobalMode(true)}
            >
              Switch to Global View
            </button>
          </div>
        )}

        {!loading && !loadError && graphData && positions.length > 0 && (() => {
          const width = svgDimensions.width;
          const height = svgDimensions.height;

          return (
            <svg
              width="100%"
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              style={{ display: "block" }}
            >
              {/* Edges */}
              <g>
                {graphData.edges.map((edge) => {
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
                      strokeWidth={1.5}
                      strokeOpacity={edge.signal === "fts" ? 0.4 : 0.7}
                    />
                  );
                })}
              </g>

              {/* Nodes */}
              <g>
                {graphData.nodes.map((node) => {
                  const pos = posMap.get(node.lineage_id);
                  if (!pos) return null;
                  const degree = degreeMap.get(node.lineage_id) ?? 0;
                  const r = Math.min(30, Math.max(8, Math.sqrt(degree + 1) * 8));
                  const isRoot = node.lineage_id === selectedLineageId;
                  const color = nodeColor(node.type);

                  return (
                    <g
                      key={node.lineage_id}
                      transform={`translate(${pos.x},${pos.y})`}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setSelectedLineageId(node.lineage_id);
                        setTab("entries");
                      }}
                    >
                      <circle
                        r={r}
                        fill={color}
                        fillOpacity={0.85}
                        stroke={isRoot ? "white" : color}
                        strokeWidth={isRoot ? 3 : 1}
                        strokeOpacity={isRoot ? 1 : 0.5}
                      >
                        <title>{node.title}</title>
                      </circle>
                      <text
                        x={r + 4}
                        y={4}
                        fontSize={10}
                        fill="rgba(255,255,255,0.8)"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {truncate(node.title, 20)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          );
        })()}
      </div>
    </section>
  );
}

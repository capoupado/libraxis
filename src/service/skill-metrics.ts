import type Database from "better-sqlite3";

interface SkillMetricRow {
  id: string;
  lineage_id: string;
  title: string;
  is_latest: number;
  status: "active" | "archived";
}

interface RunRow {
  id: string;
  metadata_json: string;
}

interface UsedSkillLinkRow {
  run_id: string;
  skill_entry_id: string;
}

interface RunMetadata {
  outcome?: "success" | "partial" | "failure";
  quality_score?: number;
  skill_entry_id?: string;
  skill_lineage_id?: string;
  failure_category?: string;
}

export interface SkillMetricsSnapshot {
  items: Array<{
    skill_entry_id: string;
    skill_lineage_id: string;
    title: string;
    usage_count: number;
    average_quality: number;
    success_count: number;
    failure_count: number;
  }>;
  top_failure_categories: Array<{ category: string; count: number }>;
}

function parseRunMetadata(metadataJson: string): RunMetadata | null {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as RunMetadata;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveSkillLineageId(
  metadata: RunMetadata,
  lineageByEntryId: Map<string, string>,
  activeLineages: Set<string>
): string | undefined {
  const skillEntryOrLineage =
    typeof metadata.skill_entry_id === "string" && metadata.skill_entry_id.length > 0
      ? metadata.skill_entry_id
      : undefined;
  const explicitLineage =
    typeof metadata.skill_lineage_id === "string" && metadata.skill_lineage_id.length > 0
      ? metadata.skill_lineage_id
      : undefined;

  if (explicitLineage && activeLineages.has(explicitLineage)) {
    return explicitLineage;
  }

  if (skillEntryOrLineage && activeLineages.has(skillEntryOrLineage)) {
    return skillEntryOrLineage;
  }

  if (skillEntryOrLineage) {
    const mappedLineage = lineageByEntryId.get(skillEntryOrLineage);
    if (mappedLineage && activeLineages.has(mappedLineage)) {
      return mappedLineage;
    }
  }

  return undefined;
}

export function buildSkillMetrics(db: Database.Database): SkillMetricsSnapshot {
  const allActiveSkills = db
    .prepare<[], SkillMetricRow>(
      "SELECT id, lineage_id, title, is_latest, status FROM entries WHERE type = 'skill' AND status = 'active' ORDER BY updated_at DESC"
    )
    .all();

  const latestSkills = allActiveSkills.filter((skill) => skill.is_latest === 1);
  const activeLineages = new Set(latestSkills.map((skill) => skill.lineage_id));
  const lineageByEntryId = new Map(allActiveSkills.map((skill) => [skill.id, skill.lineage_id]));

  const usedSkillLinks = db
    .prepare<[], UsedSkillLinkRow>(
      `
        SELECT links.source_entry_id AS run_id, links.target_entry_id AS skill_entry_id
        FROM entry_links links
        JOIN entries run_entries
          ON run_entries.id = links.source_entry_id
         AND run_entries.type = 'run'
         AND run_entries.is_latest = 1
         AND run_entries.status = 'active'
        JOIN entries skill_entries
          ON skill_entries.id = links.target_entry_id
         AND skill_entries.type = 'skill'
         AND skill_entries.status = 'active'
        WHERE links.relation_type = 'used_skill'
      `
    )
    .all();

  const linkedLineagesByRunId = new Map<string, Set<string>>();
  for (const link of usedSkillLinks) {
    const lineageId = lineageByEntryId.get(link.skill_entry_id);
    if (!lineageId || !activeLineages.has(lineageId)) {
      continue;
    }

    const lineages = linkedLineagesByRunId.get(link.run_id) ?? new Set<string>();
    lineages.add(lineageId);
    linkedLineagesByRunId.set(link.run_id, lineages);
  }

  const runs = db
    .prepare<[], RunRow>(
      "SELECT id, metadata_json FROM entries WHERE type = 'run' AND is_latest = 1 AND status = 'active'"
    )
    .all();

  const byLineage = new Map<string, RunMetadata[]>();
  const failureCategoryCounts = new Map<string, number>();

  for (const run of runs) {
    const metadata = parseRunMetadata(run.metadata_json);
    if (!metadata) {
      continue;
    }

    const relatedLineages = new Set<string>();
    const resolvedMetadataLineage = resolveSkillLineageId(metadata, lineageByEntryId, activeLineages);
    if (resolvedMetadataLineage) {
      relatedLineages.add(resolvedMetadataLineage);
    }

    const linkedLineages = linkedLineagesByRunId.get(run.id);
    if (linkedLineages) {
      for (const lineageId of linkedLineages) {
        relatedLineages.add(lineageId);
      }
    }

    for (const lineageId of relatedLineages) {
      const list = byLineage.get(lineageId) ?? [];
      list.push(metadata);
      byLineage.set(lineageId, list);
    }

    if (metadata.outcome === "failure") {
      const category = metadata.failure_category ?? "uncategorized";
      failureCategoryCounts.set(category, (failureCategoryCounts.get(category) ?? 0) + 1);
    }
  }

  const items = latestSkills.map((skill) => {
    const relatedRuns = byLineage.get(skill.lineage_id) ?? [];
    const successCount = relatedRuns.filter((run) => run.outcome === "success").length;
    const failureCount = relatedRuns.filter((run) => run.outcome === "failure").length;
    const qualityValues = relatedRuns
      .map((run) => run.quality_score)
      .filter((value): value is number => typeof value === "number");

    const averageQuality =
      qualityValues.length > 0
        ? qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length
        : 0;

    return {
      skill_entry_id: skill.id,
      skill_lineage_id: skill.lineage_id,
      title: skill.title,
      usage_count: relatedRuns.length,
      average_quality: Number(averageQuality.toFixed(2)),
      success_count: successCount,
      failure_count: failureCount
    };
  });

  const topFailureCategories = Array.from(failureCategoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return {
    items,
    top_failure_categories: topFailureCategories
  };
}

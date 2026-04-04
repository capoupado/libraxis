import { useEffect, useState } from "react";

import { fetchJson, getErrorMessage } from "../lib/http-client.js";

interface SkillMetric {
  skill_entry_id: string;
  skill_lineage_id: string;
  title: string;
  usage_count: number;
  average_quality: number;
  success_count: number;
  failure_count: number;
}

interface FailureCategory {
  category: string;
  count: number;
}

interface DashboardPayload {
  disabled?: boolean;
  message?: string;
  items: SkillMetric[];
  top_failure_categories: FailureCategory[];
}

export function SkillsDashboardPage() {
  const [metrics, setMetrics] = useState<SkillMetric[]>([]);
  const [failures, setFailures] = useState<FailureCategory[]>([]);
  const [disabledMessage, setDisabledMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchJson<DashboardPayload>(
          "/skills/dashboard",
          {},
          "Failed to load skill dashboard."
        );

        if (active) {
          setMetrics(payload.items ?? []);
          setFailures(payload.top_failure_categories ?? []);
          setDisabledMessage(
            payload.disabled
              ? payload.message ??
                  "Skill dashboard metrics are temporarily disabled while analytics are redesigned."
              : null
          );
        }
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Failed to load skill dashboard."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>Skill Dashboard</h2>
      {loading ? <p role="status">Loading dashboard...</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {disabledMessage ? (
        <p role="status">{disabledMessage}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Usage</th>
                  <th>Avg Quality</th>
                  <th>Success</th>
                  <th>Failure</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((item) => (
                  <tr key={item.skill_entry_id}>
                    <td>{item.title}</td>
                    <td>{item.usage_count}</td>
                    <td>{item.average_quality}</td>
                    <td>{item.success_count}</td>
                    <td>{item.failure_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Top Failure Categories</h3>
          <ol>
            {failures.map((failure) => (
              <li key={failure.category}>
                {failure.category}: {failure.count}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

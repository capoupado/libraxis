import { useEffect, useState } from "react";

import { fetchJson, getErrorMessage } from "../lib/http-client.js";

interface ProposalItem {
  id: string;
  status: "pending" | "approved" | "rejected";
  skill_lineage_id: string;
  skill_title: string | null;
  proposal_markdown: string;
  rationale: string;
  action_type: "improve" | "archive";
}

interface SkillListItem {
  lineage_id: string;
  title: string;
}

type ProposalStatusFilter = "all" | "pending" | "approved" | "rejected";

export interface ProposalsPageProps {
  csrfToken: string;
}

export function ProposalsPage({ csrfToken }: ProposalsPageProps) {
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [selectedSkillLineageId, setSelectedSkillLineageId] = useState("");
  const [proposalMarkdown, setProposalMarkdown] = useState("Improve this skill by tightening validation and clarifying usage guidance.");
  const [rationale, setRationale] = useState("Observed repeated operator confusion and avoidable failures.");
  const [actionType, setActionType] = useState<"improve" | "archive">("improve");
  const [statusFilter, setStatusFilter] = useState<ProposalStatusFilter>("pending");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewingProposalId, setReviewingProposalId] = useState<string | null>(null);

  const refresh = async (filter: ProposalStatusFilter = statusFilter) => {
    const query = filter === "all" ? "" : `?status=${filter}`;
    const payload = await fetchJson<{ items: ProposalItem[] }>(
      `/proposals${query}`,
      {},
      "Failed to load proposals."
    );
    setItems(payload.items ?? []);
  };

  const refreshSkills = async () => {
    const payload = await fetchJson<{ items: SkillListItem[] }>(
      "/skills?limit=100",
      {},
      "Failed to load skills for proposal creation."
    );

    const availableSkills = payload.items ?? [];
    setSkills(availableSkills);
    setSelectedSkillLineageId((current) => {
      if (current) {
        return current;
      }

      return availableSkills[0]?.lineage_id ?? "";
    });
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh(statusFilter);
      } catch (caught) {
        setError(getErrorMessage(caught, "Failed to load proposals."));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [statusFilter]);

  useEffect(() => {
    const loadSkills = async () => {
      setSkillsLoading(true);
      setError(null);
      try {
        await refreshSkills();
      } catch (caught) {
        setError(getErrorMessage(caught, "Failed to load skills for proposal creation."));
      } finally {
        setSkillsLoading(false);
      }
    };

    void loadSkills();
  }, []);

  const handleReview = async (proposalId: string, decision: "approve" | "reject") => {
    setReviewingProposalId(proposalId);
    setError(null);
    setFeedback(null);

    try {
      await fetchJson(
        `/proposals/${proposalId}/review`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken
          },
          body: JSON.stringify({ decision })
        },
        "Failed to review proposal."
      );

      await refresh(statusFilter);
      setFeedback(`Proposal ${decision === "approve" ? "approved" : "rejected"}.`);
    } catch (caught) {
      setError(getErrorMessage(caught, "Failed to review proposal."));
    } finally {
      setReviewingProposalId(null);
    }
  };

  const handleCreateProposal = async () => {
    if (!selectedSkillLineageId) {
      setError("Select a skill before creating a proposal.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setFeedback(null);

    try {
      await fetchJson(
        `/skills/${selectedSkillLineageId}/proposals`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken
          },
          body: JSON.stringify({
            proposal_markdown: proposalMarkdown,
            rationale,
            action_type: actionType
          })
        },
        "Failed to create proposal."
      );

      setFeedback("Proposal created.");
      setStatusFilter("pending");
      await refresh("pending");
    } catch (caught) {
      setError(getErrorMessage(caught, "Failed to create proposal."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <h2>Skill Proposals</h2>

      <h3>Create Proposal</h3>
      {skillsLoading ? <p role="status">Loading skills...</p> : null}
      {skills.length === 0 && !skillsLoading ? <p>No active skills found to propose changes.</p> : null}
      {skills.length > 0 ? (
        <>
          <label>
            Target Skill
            <select
              value={selectedSkillLineageId}
              onChange={(event) => setSelectedSkillLineageId(event.target.value)}
            >
              {skills.map((skill) => (
                <option key={skill.lineage_id} value={skill.lineage_id}>
                  {skill.title} ({skill.lineage_id})
                </option>
              ))}
            </select>
          </label>

          <label>
            Action
            <select
              value={actionType}
              onChange={(event) => setActionType(event.target.value as "improve" | "archive")}
            >
              <option value="improve">Improve skill</option>
              <option value="archive">Archive skill</option>
            </select>
          </label>

          <label>
            Proposal Markdown
            <textarea
              rows={6}
              value={proposalMarkdown}
              onChange={(event) => setProposalMarkdown(event.target.value)}
            />
          </label>

          <label>
            Rationale
            <textarea rows={3} value={rationale} onChange={(event) => setRationale(event.target.value)} />
          </label>

          <button type="button" disabled={submitting} onClick={handleCreateProposal}>
            {submitting ? "Creating..." : "Create Proposal"}
          </button>
        </>
      ) : null}

      <h3>Review Proposals</h3>
      <label>
        Status Filter
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ProposalStatusFilter)}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </label>

      {loading ? <p role="status">Loading proposals...</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {feedback ? <p role="status">{feedback}</p> : null}
      {!loading && items.length === 0 ? <p>No proposals found for the selected filter.</p> : null}
      {items.map((proposal) => (
        <article key={proposal.id}>
          <h3>{proposal.skill_title?.trim() ? proposal.skill_title : proposal.skill_lineage_id}</h3>
          <p>Skill ID: {proposal.skill_lineage_id}</p>
          <p>Status: {proposal.status}</p>
          <p>Action: {proposal.action_type === "archive" ? "Archive skill" : "Improve skill"}</p>
          <pre className="proposal-markdown">{proposal.proposal_markdown}</pre>
          <p>{proposal.rationale}</p>
          {proposal.status === "pending" ? (
            <div>
              <button
                type="button"
                disabled={reviewingProposalId === proposal.id}
                onClick={async () => handleReview(proposal.id, "approve")}
              >
                {reviewingProposalId === proposal.id ? "Working..." : "Approve"}
              </button>
              <button
                type="button"
                disabled={reviewingProposalId === proposal.id}
                onClick={async () => handleReview(proposal.id, "reject")}
              >
                {reviewingProposalId === proposal.id ? "Working..." : "Reject"}
              </button>
            </div>
          ) : (
            <p>This proposal has already been reviewed.</p>
          )}
        </article>
      ))}
    </section>
  );
}

import type { SectionProps } from "../types";
import { SectionTitle, Lead, SubHeading, Card, CardTitle, CardBody, Grid, StepList, Table, InfoBox } from "../ui";

export default function TeamCollaboration(_props: SectionProps) {
  return (
    <div>
      <SectionTitle>Team Collaboration</SectionTitle>
      <Lead>
        Locker supports multi-tenant organizations with role-based access control, isolated team workspaces,
        and seat-based billing.
      </Lead>

      {/* Org Structure */}
      <SubHeading>Organization Structure</SubHeading>
      <Card>
        <CardBody>
          <p style={{ margin: "0 0 12px 0" }}>
            Locker uses a three-level hierarchy: <strong style={{ color: "var(--text)" }}>Organizations</strong> →{" "}
            <strong style={{ color: "var(--text)" }}>Teams</strong> →{" "}
            <strong style={{ color: "var(--text)" }}>Members</strong>.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>Each org has one billing account tied to a plan tier.</li>
            <li>Teams within an org can have isolated memory scopes via workspace keys, enabling strict
              project or client separation.</li>
            <li>Members can belong to multiple teams simultaneously, each with a different assigned role.</li>
          </ul>
        </CardBody>
      </Card>

      <div style={{ marginBottom: 28 }} />

      {/* Roles */}
      <SubHeading>Roles & Permissions</SubHeading>
      <Table
        headers={["Role", "Capabilities"]}
        rows={[
          [
            <strong key="owner" style={{ color: "var(--text)" }}>Owner</strong>,
            "Full administrative access including billing management, org deletion, and all member/token controls.",
          ],
          [
            <strong key="admin" style={{ color: "var(--text)" }}>Admin</strong>,
            "Manage members, generate and revoke agent tokens, configure webhooks. Cannot access billing or delete the org.",
          ],
          [
            <strong key="member" style={{ color: "var(--text)" }}>Member</strong>,
            "Read and write memories within allowed scopes. Cannot manage agent tokens, webhooks, or billing.",
          ],
        ]}
      />

      {/* Workspace Key Scoping */}
      <SubHeading>Workspace Key Scoping</SubHeading>
      <Grid min={260}>
        <Card>
          <CardTitle>
            <span style={{ fontSize: 15 }}>🗝️</span>
            Scoped Memories
          </CardTitle>
          <CardBody>
            Memories can be assigned a team workspace key at creation time. Agents using a team-scoped API
            token only see memories within that exact scope. Cross-scope reads are blocked at the SQL query
            and Vectorize pre-filter layers simultaneously.
          </CardBody>
        </Card>
        <Card>
          <CardTitle>
            <span style={{ fontSize: 15 }}>🏗️</span>
            Project & Client Isolation
          </CardTitle>
          <CardBody>
            Use distinct workspace keys per project or client. This ensures that an agent token issued for
            Project A cannot read any memories scoped to Project B, even within the same organization.
          </CardBody>
        </Card>
      </Grid>

      {/* Inviting Members */}
      <SubHeading>Inviting Members</SubHeading>
      <StepList
        items={[
          {
            step: "1",
            title: "Go to Admin → Team",
            text: "Navigate to the Admin section in the sidebar and select the Team tab.",
          },
          {
            step: "2",
            title: 'Click "Invite Member"',
            text: "Enter the invitee's email address in the invite field.",
          },
          {
            step: "3",
            title: "Select a role",
            text: "Choose Admin or Member. Owners cannot be assigned via invite — ownership is transferred explicitly from the org settings.",
          },
          {
            step: "4",
            title: "Invitee accepts",
            text: "The invitee receives an email with a secure acceptance link. Upon clicking and authenticating, they are added to the team with the assigned role and begin consuming a billing seat.",
          },
        ]}
      />

      {/* Billing Seats */}
      <SubHeading>Billing Seats</SubHeading>
      <Card accent="blue">
        <CardTitle>
          <span style={{ fontSize: 15 }}>💳</span>
          Seat-Based Billing
        </CardTitle>
        <CardBody>
          <p style={{ margin: "0 0 10px 0" }}>
            Each active team member occupies one billing seat. The plan tier sets the maximum seat count:
          </p>
          <ul style={{ margin: "0 0 10px 0", paddingLeft: 18, lineHeight: 1.9 }}>
            <li><strong style={{ color: "var(--text)" }}>Free</strong> — limited seat count, single team.</li>
            <li><strong style={{ color: "var(--text)" }}>Business</strong> — expanded seat limit, multiple teams, webhook support.</li>
            <li><strong style={{ color: "var(--text)" }}>Enterprise</strong> — unlimited seats, SSO, custom workspace key policies, SLA.</li>
          </ul>
          <p style={{ margin: 0 }}>
            Owners can view current seat usage and upgrade the plan from{" "}
            <strong style={{ color: "var(--text)" }}>Admin → Billing</strong>.
          </p>
        </CardBody>
      </Card>

      <div style={{ marginBottom: 28 }} />

      {/* Team-scoped Agent Tokens */}
      <SubHeading>Team-Scoped Agent Tokens</SubHeading>
      <InfoBox>
        <span style={{ fontSize: 18 }}>🤖</span>
        <span>
          When generating an agent token, Admins can scope it to a specific team workspace key. The token
          is then hard-limited to memories within that team's namespace — regardless of any ABAC category
          filters also applied. Team-scoped tokens cannot escalate their own scope and cannot read from
          the global vault or other team namespaces. Revoke a token at any time from{" "}
          <strong>Admin → API Tokens</strong>.
        </span>
      </InfoBox>
    </div>
  );
}

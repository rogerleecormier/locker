import type { SectionProps } from "../types";
import {
  SectionTitle,
  Lead,
  SubHeading,
  Card,
  CardTitle,
  CardBody,
  Grid,
  StepList,
  InfoBox,
  BulletList,
} from "../ui";

export default function Templates(_props: SectionProps) {
  return (
    <div>
      <SectionTitle>Blueprint Templates</SectionTitle>
      <Lead>
        Save and reuse common stack configurations as named templates. Skip re-entering your full
        tech stack for every new project by applying a template with one click.
      </Lead>

      <SubHeading>What templates are</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
        A template is a saved, named snapshot of a complete stack blueprint. Templates are stored as
        special memories with category <code>stack</code> and a <code>template</code> tag. They
        appear in a separate Templates tab in the Stack Creator, distinct from active project
        blueprints.
      </p>

      <SubHeading>Creating a template</SubHeading>
      <StepList
        items={[
          {
            step: "1",
            title: "Create a Stack Blueprint",
            text: "First create a full stack blueprint using the Stack Creator. Fill in all relevant categories and constraints for your archetype.",
          },
          {
            step: "2",
            title: 'Click "Save as Template"',
            text: 'On the blueprint detail view, click the "Save as Template" button in the top-right action bar.',
          },
          {
            step: "3",
            title: "Name your template",
            text: 'Give the template a descriptive, memorable name such as "Cloudflare Edge App" or "Next.js SaaS Starter".',
          },
          {
            step: "4",
            title: "Template is ready",
            text: "The template now appears in the Templates tab and is available for all future projects.",
          },
        ]}
      />

      <SubHeading>Applying a template</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        Open the Stack Creator for a new project, click{" "}
        <strong style={{ color: "var(--text)" }}>"Apply Template"</strong>, then select from your
        saved templates. The full blueprint is pre-filled into every category. Customize individual
        fields as needed before clicking Save Blueprint.
      </p>

      <Grid>
        <Card accent="purple">
          <CardTitle>Personal templates</CardTitle>
          <CardBody>
            Scoped to your user account by default. Only you can see and apply them. Ideal for your
            own repeating project patterns.
          </CardBody>
        </Card>
        <Card accent="blue">
          <CardTitle>Team templates</CardTitle>
          <CardBody>
            Admins can promote any template to team-wide status. Team templates appear for all
            members under a shared "Team Templates" section, ensuring org-wide consistency.
          </CardBody>
        </Card>
      </Grid>

      <SubHeading>Template versioning</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        Like all memories in Locker, templates are versioned. The following rules apply when you
        update a template:
      </p>
      <BulletList
        items={[
          "Future project blueprints that are applied from the updated template will receive the new version.",
          "Existing project blueprints that were previously applied from the old template are not retroactively changed — they remain frozen at the version applied.",
          "A version history panel on the template detail view shows all past snapshots for audit and rollback.",
        ]}
      />
      <div style={{ marginTop: 24 }}>
        <InfoBox>
          <span style={{ fontSize: 16 }}>📌</span>
          <span>
            To update all active projects to a new template version, re-apply the template from the
            Stack Creator for each project individually. This keeps changes deliberate and
            project-by-project.
          </span>
        </InfoBox>
      </div>
    </div>
  );
}

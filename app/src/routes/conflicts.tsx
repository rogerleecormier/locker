import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/conflicts")({
  beforeLoad: () => {
    throw redirect({ to: "/memories" });
  },
  component: () => null,
});

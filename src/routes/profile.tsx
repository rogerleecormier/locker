import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProfile, saveProfile } from "~/server/memoryFunctions";

function ProfilePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [savedMessage, setSavedMessage] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
  });

  // Sync state with loaded data
  useEffect(() => {
    if (profileQuery.data) {
      setName(profileQuery.data.name);
      setLocation(profileQuery.data.location);
    }
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 5000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate({ data: { name, location } });
  }

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "40px auto 0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "30px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <h1 style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Profile Settings</h1>
        </div>
        <Link to="/" style={{ color: "var(--accent)", fontSize: "14px", fontWeight: 500 }}>← Back to App</Link>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "30px",
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
        }}
      >
        {profileQuery.isPending ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>Loading profile data...</div>
        ) : profileQuery.isError ? (
          <div style={{ padding: "15px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--error)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: "14px" }}>
            Failed to load profile settings: {String(profileQuery.error)}
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: "8px",
                  fontWeight: 600,
                }}
              >
                Preferred Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Roger"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  fontSize: "14px",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  color: "var(--text)",
                }}
              />
              <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
                This name will be referenced in ingested memories (e.g. converting "You live in Florida" to "Roger lives in Florida").
              </span>
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: "8px",
                  fontWeight: 600,
                }}
              >
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g., Florida"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  fontSize: "14px",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  color: "var(--text)",
                }}
              />
              <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
                Your current location, stored as a background reference context.
              </span>
            </div>

            {savedMessage && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "rgba(34,197,94,0.1)",
                  border: "1px solid rgba(34,197,94,0.3)",
                  borderRadius: "var(--radius)",
                  color: "var(--success)",
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Profile settings saved successfully! Preferred name is now set to "{name}".
              </div>
            )}

            {saveMutation.isError && (
              <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: "13px" }}>
                Failed to save settings: {(saveMutation.error as Error).message}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button
                type="submit"
                disabled={saveMutation.isPending}
                style={{
                  padding: "12px 24px",
                  background: "var(--accent)",
                  color: "white",
                  fontWeight: "bold",
                  fontSize: "14px",
                  borderRadius: "var(--radius)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {saveMutation.isPending ? "Saving Settings..." : "Save Profile"}
              </button>
              <button
                type="button"
                onClick={() => navigate({ to: "/" })}
                disabled={saveMutation.isPending}
                style={{
                  padding: "12px 20px",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  fontSize: "14px",
                  borderRadius: "var(--radius)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

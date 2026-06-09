export interface SectionProps {
  setActiveSection: (id: string) => void;
  handleCopy: (text: string) => void;
  origin: string;
  session: any;
  testLoading: boolean;
  testResult: { status: "success" | "error"; message: string } | null;
  handleTestConnection: () => void;
}

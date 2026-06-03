import * as React from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface VariableConfig {
  key: string;
  description: string;
  default: string;
}

interface ParsedPayload {
  rules: string[];
  variables?: VariableConfig[];
}

interface TemplateRowProps {
  template: any;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onImport: (tmpl: any) => void;
  onEdit: (tmpl: any) => void;
  onDelete: (tmpl: any) => void;
}

function VariableChip({ name, desc }: { name: string; desc: string }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded-sm text-[10px] bg-tag-bg border border-tag-border text-text-muted mr-1 mb-1 font-mono select-none"
      title={desc}
    >
      {name}
    </span>
  );
}

export function TemplateRow({
  template,
  selected,
  onToggleSelect,
  onImport,
  onEdit,
  onDelete,
}: TemplateRowProps) {
  let payload: ParsedPayload = { rules: [] };
  try {
    payload = JSON.parse(template.configPayload);
  } catch (e) {}

  const rules = payload.rules || [];
  const variables = payload.variables || [];

  return (
    <div
      className={`p-4 md:px-5 border-b border-border grid grid-cols-[auto_1fr_auto] gap-3 md:gap-4 items-start select-none transition-all ${
        selected ? "bg-accent/4" : "hover:bg-surface2/30"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(template.id)}
        className="mt-1 cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
      />
      
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <span
            onClick={() => onEdit(template)}
            className="font-bold text-sm md:text-base text-text cursor-pointer hover:text-accent transition-colors"
          >
            {template.name}
          </span>
          {rules.length > 0 && (
            <Badge variant="secondary" className="border-blue-500/30 bg-blue-500/10 text-blue-400 font-semibold normal-case tracking-normal">
              {rules.length} Rule{rules.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {variables.length > 0 && (
            <Badge variant="accent" className="font-semibold normal-case tracking-normal">
              {variables.length} Var{variables.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <p className="text-text-muted text-xs md:text-sm leading-relaxed max-w-3xl break-words">
          {template.description}
        </p>
        {variables.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mt-2.5">
            {variables.map((v) => (
              <VariableChip key={v.key} name={v.key} desc={v.description} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1.5 min-w-[110px] select-none">
        <Badge variant={template.category}>{template.category}</Badge>
        <span className="text-[10px] text-text-muted font-medium">
          {new Date(template.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <div className="flex gap-1.5 mt-1 select-none">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onImport(template)}
            className="h-6 text-[10px] px-2 hover:border-accent/30 hover:text-accent"
          >
            Import
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(template)}
            className="h-6 text-[10px] px-2 hover:border-accent/30 hover:text-accent"
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(template)}
            className="h-6 text-[10px] px-2 hover:border-error/30 hover:text-error hover:bg-error/5"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

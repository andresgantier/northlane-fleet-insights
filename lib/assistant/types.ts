// Shapes shared by the assistant tools (server) and the chat UI (browser).

export type Column = {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "percent" | "boolean";
};

export type Calculation = {
  tool: string;
  metric: string[];         // metric definitions used, in plain words
  period: string;           // e.g. "Last 6 months (180 days): 2026-05-09 to 2026-11-04"
  filters: string[];        // e.g. "Vehicle class = Trailer", "Depot = W-EUN/EJ (your depot)"
  source: string;           // semantic-layer object that produced the numbers
  notes?: string[];
};

export type DataResult = {
  result_id: string;
  title: string;
  columns: Column[];
  rows: Record<string, string | number | boolean | null>[];
  total_rows: number;       // before top_n / row limit
  truncated: boolean;
  calculation: Calculation;
};

export type ChartSpec = {
  result_id: string;
  chart_type: "bar" | "line" | "table";
  x: string;
  y: string[];
  title: string;
};

export const MAX_ROWS = 50;

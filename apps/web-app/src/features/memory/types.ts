export type MemoryType = "knowledge" | "inspiration" | "reflection";
export type Memory = {
  id: string;
  type: MemoryType;
  title: string | null;
  content: string;
  tags: string[];
  source_url: string | null;
  created_at: string;
  updated_at: string;
};

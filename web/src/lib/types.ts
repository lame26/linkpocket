export type LinkStatus = "unread" | "reading" | "done" | "archived";
export type LinkAiState = "idle" | "pending" | "success" | "failed";

export interface Collection {
  id: string;
  name: string;
  color: string | null;
}

export interface LinkItem {
  id: string;
  url: string;
  title: string | null;
  note: string | null;
  status: LinkStatus;
  rating: number | null;
  is_favorite: boolean;
  category: string | null;
  summary: string | null;
  keywords: string[];
  collection_id: string | null;
  ai_state: LinkAiState;
  ai_error: string | null;
  published_at: string | null;
  created_at: string;
  deleted_at: string | null;
  collection: Collection | null;
  tags: string[];
}

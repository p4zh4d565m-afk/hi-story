// Search-related types used by the Inspiration Panel
export interface SearchLayer {
  name: string;
  displayName: string;
  icon: string;
  description: string;
}

export interface SearchResult {
  layer: string;
  layerDisplay: string;
  layerIcon: string;
  title: string;
  content: string;
  snippet: string;
  score: number;
  source?: string;
  materialId?: string;
}

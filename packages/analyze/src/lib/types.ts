
export interface Project {
  id?: number;
  name: string;
  description?: string;
  project_type?: string;
  source_root?: string;
  root?: string;
  tags?: string;
  created_at?: string;
}

export interface ProjectMetrics extends Project {
  touched_count?: number;
  dependent_count?: number;
  load?: number;
  affected_count?: number;
}

export interface ProjectFile {
  id?: number;
  project_id: number;
  file_path: string;
  file_type?: string;
  added_at?: string;
}

export interface FileDependency {
  id?: number;
  file_path: string;
  depends_on_project: string;
  depends_on_file?: string;
  created_at?: string;
}

export interface GitCommit {
  id?: number;
  hash: string;
  author: string;
  date: string;
  message: string;
  created_at?: string;
}

export interface TouchedFile {
  id?: number;
  commit_id: number;
  file_path: string;
  change_type: string; // A (added), M (modified), D (deleted), R (renamed)
  created_at?: string;
}

export interface SymbolDefinition {
  symbol: string;
  defined_in_project: string;
  defined_in_file?: string;
}

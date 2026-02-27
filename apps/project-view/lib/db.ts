/**
 * Read-only DB client for the project-view Next.js app.
 * Uses only sqlite3 (no @nx/devkit) so it can run in Next.js API routes without
 * pulling in native Nx bindings that Webpack cannot bundle.
 */

import * as path from 'path';
import * as fs from 'fs';

// Use require so Next.js can externalize sqlite3 and we avoid bundling @nx/devkit
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqlite3 = require('sqlite3');

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

export class ProjectViewDb {
  private db: InstanceType<typeof sqlite3.Database>;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new sqlite3.Database(this.dbPath);
  }

  private query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err: Error | null, rows: unknown[]) => {
        if (err) reject(err);
        else resolve((rows || []) as T[]);
      });
    });
  }

  async getProject(name: string): Promise<Project | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM projects WHERE name = ?',
        [name],
        (err: Error | null, row: unknown) => {
          if (err) reject(err);
          else resolve((row as Project) || null);
        }
      );
    });
  }

  async getAllProjects(): Promise<Project[]> {
    return this.query<Project>('SELECT * FROM projects ORDER BY name');
  }

  async getProjectDependents(projectName: string): Promise<string[]> {
    try {
      const result = new Set<string>();
      const visited = new Set<string>();
      const queue: string[] = [projectName];
      visited.add(projectName);

      while (queue.length > 0) {
        const batch = queue.splice(0, 50);
        const placeholders = batch.map(() => '?').join(',');
        const rows = await this.query<{ source_project: string }>(
          `SELECT source_project FROM project_dependencies WHERE target_project IN (${placeholders})`,
          batch
        );

        for (const r of rows) {
          const s = r.source_project;
          if (!visited.has(s)) {
            visited.add(s);
            result.add(s);
            queue.push(s);
          }
        }
      }

      return Array.from(result);
    } catch (error) {
      console.warn(`Could not get dependents for ${projectName}:`, error);
      return [];
    }
  }

  async getProjectFiles(projectName: string): Promise<ProjectFile[]> {
    const project = await this.getProject(projectName);
    if (!project) return [];

    return this.query<ProjectFile>(
      'SELECT * FROM project_files WHERE project_id = ? ORDER BY file_path',
      [project.id]
    );
  }

  getProjectsDependingOnFile(filePath: string): Promise<string[]> {
    return this.query<{ name: string }>(
      `SELECT DISTINCT p.name
       FROM projects p
       JOIN project_files pf ON p.id = pf.project_id
       JOIN file_dependencies fd ON fd.file_path = pf.file_path
       WHERE fd.depends_on_file = ?
       ORDER BY p.name`,
      [filePath]
    ).then((rows) => rows.map((r) => r.name));
  }

  async getFilesTouchedCount(
    filePaths: string[],
    commitCount = 100
  ): Promise<number> {
    if (!filePaths || filePaths.length === 0) return 0;

    const placeholders = filePaths.map(() => '?').join(',');
    const query = `
      SELECT COUNT(DISTINCT tf.commit_id) as commit_count
      FROM touched_files tf
      WHERE tf.commit_id IN (
        SELECT id FROM git_commits ORDER BY date DESC LIMIT ?
      )
      AND tf.file_path IN (${placeholders})
    `;

    const params = [commitCount, ...filePaths] as any;
    const rows = await this.query<{ commit_count: number }>(query, params);
    if (!rows || rows.length === 0) return 0;
    return Number(rows[0].commit_count || 0);
  }

  async getProjectDependencyMapForFiles(
    filePaths: string[]
  ): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    if (!filePaths || filePaths.length === 0) return result;

    const placeholders = filePaths.map(() => '?').join(',');
    const query = `
      SELECT fd.depends_on_file as file_path, p.name as project_name
      FROM file_dependencies fd
      JOIN project_files pf ON pf.file_path = fd.file_path
      JOIN projects p ON p.id = pf.project_id
      WHERE fd.depends_on_file IN (${placeholders})
      ORDER BY fd.depends_on_file, p.name
    `;

    const rows = await this.query<{ file_path: string; project_name: string }>(
      query,
      filePaths
    );

    for (const f of filePaths) result[f] = [];

    for (const r of rows) {
      const file = r.file_path;
      if (!result[file]) result[file] = [];
      if (!result[file].includes(r.project_name)) result[file].push(r.project_name);
    }

    return result;
  }

  async getEstimatedLoad(
    filePaths: string[],
    commitCount = 100
  ): Promise<number> {
    if (!filePaths || filePaths.length === 0) return 0;

    // Get the number of commits touching these files
    const touchCount = await this.getFilesTouchedCount(filePaths, commitCount);

    // Get direct project dependents for all files
    const dependencyMap = await this.getProjectDependencyMapForFiles(filePaths);

    // Collect all unique directly dependent projects
    const directDependents = new Set<string>();
    for (const projects of Object.values(dependencyMap)) {
      for (const project of projects) {
        directDependents.add(project);
      }
    }

    if (directDependents.size === 0) return 0;

    // Get transitive dependents for all directly dependent projects
    const transitiveDependents = new Map<string, string[]>();
    await Promise.all(
      Array.from(directDependents).map((p) =>
        this.getProjectDependents(p).then((deps) => {
          transitiveDependents.set(p, deps);
          return deps;
        })
      )
    );

    // Count total unique transitive dependents (including direct)
    const allDependents = new Set<string>(directDependents);
    for (const deps of transitiveDependents.values()) {
      for (const dep of deps) {
        allDependents.add(dep);
      }
    }

    return touchCount * allDependents.size;
  }

  /**
   * Suggest a split of the given files into two groups such that
   * the sum of the estimated loads of the two groups is minimized.
   *
   * Algorithm (hill climbing):
   * 1. Filter to files that actually have dependent projects.
   * 2. Randomly split these files into two groups.
   * 3. Repeatedly try moving a single file between groups; if a move
   *    reduces the total estimated load, keep it and continue.
   * 4. Stop when no single-file move improves the total load.
   * 5. Return the two groups, placing all files without dependents
   *    into the first group.
   */
  async getSuggestedFileSplit(
    filePaths: string[],
    commitCount = 100
  ): Promise<[string[], string[]]> {
    if (!filePaths || filePaths.length === 0) {
      return [[], []];
    }

    // Determine which files have dependent projects
    const dependencyMap = await this.getProjectDependencyMapForFiles(filePaths);
    const filesWithDeps: string[] = [];
    const filesWithoutDeps: string[] = [];

    for (const fp of filePaths) {
      const dependents = dependencyMap[fp] || [];
      if (dependents.length > 0) {
        filesWithDeps.push(fp);
      } else {
        filesWithoutDeps.push(fp);
      }
    }

    // If none of the files have dependents, all load is zero.
    // Put everything into the first group.
    if (filesWithDeps.length === 0) {
      return [filePaths.slice(), []];
    }

    // Initial random split for files that affect load
    const groupA: string[] = [];
    const groupB: string[] = [];
    for (const fp of filesWithDeps) {
      if (Math.random() < 0.5) {
        groupA.push(fp);
      } else {
        groupB.push(fp);
      }
    }

    let loadA = await this.getEstimatedLoad(groupA, commitCount);
    let loadB = await this.getEstimatedLoad(groupB, commitCount);
    let totalLoad = loadA + loadB;

    let improved = true;
    while (improved) {
      improved = false;
      let bestDelta = 0;
      let bestMove:
        | {
            fromA: boolean;
            file: string;
            newGroupA: string[];
            newGroupB: string[];
            newLoadA: number;
            newLoadB: number;
          }
        | null = null;

      // Try moving each file from A to B
      for (const file of groupA) {
        const newGroupA = groupA.filter((f) => f !== file);
        const newGroupB = [...groupB, file];

        const [candidateLoadA, candidateLoadB] = await Promise.all([
          this.getEstimatedLoad(newGroupA, commitCount),
          this.getEstimatedLoad(newGroupB, commitCount),
        ]);

        const candidateTotal = candidateLoadA + candidateLoadB;
        const delta = candidateTotal - totalLoad;

        if (delta < bestDelta) {
          bestDelta = delta;
          bestMove = {
            fromA: true,
            file,
            newGroupA,
            newGroupB,
            newLoadA: candidateLoadA,
            newLoadB: candidateLoadB,
          };
        }
      }

      // Try moving each file from B to A
      for (const file of groupB) {
        const newGroupB = groupB.filter((f) => f !== file);
        const newGroupA = [...groupA, file];

        const [candidateLoadA, candidateLoadB] = await Promise.all([
          this.getEstimatedLoad(newGroupA, commitCount),
          this.getEstimatedLoad(newGroupB, commitCount),
        ]);

        const candidateTotal = candidateLoadA + candidateLoadB;
        const delta = candidateTotal - totalLoad;

        if (delta < bestDelta) {
          bestDelta = delta;
          bestMove = {
            fromA: false,
            file,
            newGroupA,
            newGroupB,
            newLoadA: candidateLoadA,
            newLoadB: candidateLoadB,
          };
        }
      }

      // Apply the best improving move, if any
      if (bestMove && bestDelta < 0) {
        groupA.length = 0;
        groupA.push(...bestMove.newGroupA);
        groupB.length = 0;
        groupB.push(...bestMove.newGroupB);
        loadA = bestMove.newLoadA;
        loadB = bestMove.newLoadB;
        totalLoad = loadA + loadB;
        improved = true;
      }
    }

    // Place all files without dependents into the first group
    return [[...groupA, ...filesWithoutDeps], groupB.slice()];
  }

  async getAllProjectsMetrics(commitCount = 100): Promise<ProjectMetrics[]> {
    const [projects, commitRows] = await Promise.all([
      this.getAllProjects(),
      this.query<{ id: number }>(
        'SELECT id FROM git_commits ORDER BY date DESC LIMIT ?',
        [commitCount]
      ),
    ]);

    const commitIds = commitRows.map((r) => r.id);

    if (commitIds.length === 0) {
      return projects.map((p) => ({
        ...p,
        touched_count: 0,
        load: 0,
        affected_count: 0,
      }));
    }

    const touchedRows = await this.query<{
      commit_id: number;
      project_name: string;
      project_id: number;
    }>(
      `SELECT DISTINCT tf.commit_id, p.name as project_name, p.id as project_id
       FROM touched_files tf
       JOIN project_files pf ON pf.file_path = tf.file_path
       JOIN projects p ON p.id = pf.project_id
       WHERE tf.commit_id IN (${commitIds.map(() => '?').join(',')})`,
      commitIds
    );

    const touchedByCommit = new Map<number, Set<string>>();
    const touchCountMap = new Map<string, number>();
    const projectsToCompute = new Set<string>();

    for (const r of touchedRows) {
      const s = touchedByCommit.get(r.commit_id) || new Set<string>();
      s.add(r.project_name);
      touchedByCommit.set(r.commit_id, s);

      touchCountMap.set(
        r.project_name,
        (touchCountMap.get(r.project_name) || 0) + 1
      );
      projectsToCompute.add(r.project_name);
    }

    const transitiveDependents = new Map<string, string[]>();
    if (projectsToCompute.size > 0) {
      const projectsArr = Array.from(projectsToCompute);
      await Promise.all(
        projectsArr.map((p) =>
          this.getProjectDependents(p).then((deps) => {
            transitiveDependents.set(p, deps);
            return deps;
          })
        )
      );
    }

    const affectedCounts = new Map<string, number>();
    for (const [, touched] of touchedByCommit) {
      const affected = new Set<string>();
      for (const t of touched) {
        affected.add(t);
        const depsSet = transitiveDependents.get(t);
        if (depsSet) depsSet.forEach((p) => affected.add(p));
      }
      for (const proj of affected) {
        affectedCounts.set(proj, (affectedCounts.get(proj) || 0) + 1);
      }
    }

    return projects.map((p) => ({
      ...p,
      touched_count: touchCountMap.get(p.name) || 0,
      dependent_count: transitiveDependents.get(p.name)?.length || 0,
      load:
        (touchCountMap.get(p.name) || 0) *
        (transitiveDependents.get(p.name)?.length || 0),
      affected_count: affectedCounts.get(p.name) || 0,
    }));
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export function findWorkspaceRoot(startPath: string): string {
  let current = path.resolve(startPath);
  while (current !== path.dirname(current)) {
    const nxJsonPath = path.join(current, 'nx.json');
    if (fs.existsSync(nxJsonPath)) {
      return current;
    }
    current = path.dirname(current);
  }
  return startPath;
}

export function getDbPath(): string {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  return path.join(workspaceRoot, 'nx-projects.db');
}

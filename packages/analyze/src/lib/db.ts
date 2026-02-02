import { createRequire } from 'module';
import type { RunResult } from 'sqlite3';
type Sqlite3Module = typeof import('sqlite3');
// Use CommonJS require for sqlite3 to ensure correct runtime shape under NodeNext/ESM
const sqlite3: Sqlite3Module = createRequire(import.meta.url)('sqlite3');
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import {
  createProjectGraphAsync,
  createProjectFileMapUsingProjectGraph,
  workspaceRoot,
} from '@nx/devkit';
import type {
  FileData,
  ProjectGraph,
  ProjectGraphProjectNode,
} from '@nx/devkit';
import ts from 'typescript';

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

export interface ProjectFile {
  id?: number;
  project_id: number;
  file_path: string;
  file_type?: string;
  added_at?: string;
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

export class ProjectDatabase {
  private db: InstanceType<Sqlite3Module['Database']>;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'projects.db');
    this.db = new sqlite3.Database(this.dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    const createProjectsTable = `
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        project_type TEXT,
        source_root TEXT,
        root TEXT,
        tags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createFilesTable = `
      CREATE TABLE IF NOT EXISTS project_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        UNIQUE(project_id, file_path)
      )
    `;

    const createCommitsTable = `
      CREATE TABLE IF NOT EXISTS git_commits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT UNIQUE NOT NULL,
        author TEXT NOT NULL,
        date TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createTouchedFilesTable = `
      CREATE TABLE IF NOT EXISTS touched_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commit_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        change_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (commit_id) REFERENCES git_commits (id) ON DELETE CASCADE,
        UNIQUE(commit_id, file_path)
      )
    `;

    const createFileDepsTable = `
      CREATE TABLE IF NOT EXISTS file_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        depends_on_project TEXT NOT NULL,
        depends_on_file TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(file_path, depends_on_project, depends_on_file)
      )
    `;

    this.db.serialize(() => {
      this.db.run(createProjectsTable);
      this.db.run(createFilesTable);
      this.db.run(createCommitsTable);
      this.db.run(createTouchedFilesTable);
      this.db.run(createFileDepsTable);
    });
  }

  // Nx integration methods
  async syncWithNxWorkspace(workspaceRoot?: string): Promise<ProjectGraph> {
    process.chdir(workspaceRoot || process.cwd());

    try {
      // Read Nx configuration and create project graph
      const projectGraph = await createProjectGraphAsync({
        exitOnError: false,
      });
      const fileMap = await createProjectFileMapUsingProjectGraph(projectGraph);

      // Sync all Nx projects to database
      for (const [projectName, files] of Object.entries(fileMap)) {
        await this.syncNxProject(
          projectName,
          projectGraph.nodes[projectName],
          files
        );
      }

      console.log(
        `Synced ${Object.keys(fileMap).length} Nx projects to database`
      );
      return projectGraph;
    } catch (error) {
      throw new Error(
        `Failed to sync with Nx workspace: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  private async syncNxProject(
    projectName: string,
    projectNode: ProjectGraphProjectNode,
    files: FileData[]
  ): Promise<void> {
    const data = projectNode.data;

    // Create or update project in database
    const existingProject = await this.getProject(projectName);

    if (existingProject) {
      // Update existing project
      await this.updateProject(projectName, {
        description: data.description,
        project_type: data.projectType,
        source_root: data.sourceRoot,
        root: data.root,
        tags: data.tags?.join(','),
      });
    } else {
      // Create new project
      await this.createProjectFromNx(projectName, {
        description: data.description,
        project_type: data.projectType,
        source_root: data.sourceRoot,
        root: data.root,
        tags: data.tags?.join(','),
      });
    }

    // Add all files from the project
    for (const file of files) {
      await this.addFileToProject(
        projectName,
        file.file,
        file.deps?.map((d) => d[0])
      );
    }
  }

  // Project methods
  async createProject(name: string, description?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        'INSERT INTO projects (name, description) VALUES (?, ?)'
      );
      stmt.run([name, description], function (err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve((this as unknown as RunResult).lastID as number);
        }
      });
      stmt.finalize();
    });
  }

  async createProjectFromNx(
    name: string,
    nxData: {
      description?: string;
      project_type?: string;
      source_root?: string;
      root?: string;
      tags?: string;
    }
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO projects (name, description, project_type, source_root, root, tags) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        [
          name,
          nxData.description,
          nxData.project_type,
          nxData.source_root,
          nxData.root,
          nxData.tags,
        ],
        function (err: Error | null) {
          if (err) {
            reject(err);
          } else {
            resolve((this as unknown as RunResult).lastID as number);
          }
        }
      );
      stmt.finalize();
    });
  }

  async updateProject(
    name: string,
    updates: {
      description?: string;
      project_type?: string;
      source_root?: string;
      root?: string;
      tags?: string;
    }
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        UPDATE projects 
        SET description = ?, project_type = ?, source_root = ?, root = ?, tags = ?
        WHERE name = ?
      `);
      stmt.run(
        [
          updates.description,
          updates.project_type,
          updates.source_root,
          updates.root,
          updates.tags,
          name,
        ],
        function (err: Error | null) {
          if (err) {
            reject(err);
          } else {
            resolve(((this as unknown as RunResult).changes ?? 0) > 0);
          }
        }
      );
      stmt.finalize();
    });
  }

  async getProject(name: string): Promise<Project | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM projects WHERE name = ?',
        [name],
        (err: Error | null, row: unknown) => {
          if (err) {
            reject(err);
          } else {
            resolve((row as Project) || null);
          }
        }
      );
    });
  }

  async getAllProjects(): Promise<Project[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM projects ORDER BY name',
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows as Project[]);
          }
        }
      );
    });
  }

  async deleteProject(name: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM projects WHERE name = ?',
        [name],
        function (err: Error | null) {
          if (err) {
            reject(err);
          } else {
            resolve(((this as unknown as RunResult).changes ?? 0) > 0);
          }
        }
      );
    });
  }

  // File methods
  async addFileToProject(
    projectName: string,
    filePath: string,
    fileDeps?: string[]
  ): Promise<void> {
    const project = await this.getProject(projectName);
    if (!project) {
      throw new Error(`Project "${projectName}" not found`);
    }

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO project_files (project_id, file_path, file_type) VALUES (?, ?, ?)'
      );
      stmt.run([project.id, filePath, fileDeps], (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
      stmt.finalize();
    });
  }

  async removeFileFromProject(
    projectName: string,
    filePath: string
  ): Promise<boolean> {
    const project = await this.getProject(projectName);
    if (!project) {
      return false;
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM project_files WHERE project_id = ? AND file_path = ?',
        [project.id, filePath],
        function (err: Error | null) {
          if (err) {
            reject(err);
          } else {
            resolve(((this as unknown as RunResult).changes ?? 0) > 0);
          }
        }
      );
    });
  }

  async getProjectFiles(projectName: string): Promise<ProjectFile[]> {
    const project = await this.getProject(projectName);
    if (!project) {
      return [];
    }

    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM project_files WHERE project_id = ? ORDER BY file_path',
        [project.id],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows as ProjectFile[]);
          }
        }
      );
    });
  }

  async getFileProjects(filePath: string): Promise<Project[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT p.* FROM projects p
        JOIN project_files pf ON p.id = pf.project_id
        WHERE pf.file_path = ?
        ORDER BY p.name
      `;
      this.db.all(query, [filePath], (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as Project[]);
        }
      });
    });
  }

  // Nx-specific query methods
  async getProjectDependencies(projectName: string): Promise<string[]> {
    try {
      const projectGraph = await createProjectGraphAsync({
        exitOnError: false,
      });
      const dependencies = projectGraph.dependencies[projectName] || [];
      return dependencies.map((dep) => dep.target);
    } catch (error) {
      console.warn(`Could not get dependencies for ${projectName}:`, error);
      return [];
    }
  }

  async getProjectDependents(projectName: string): Promise<string[]> {
    try {
      const projectGraph = await createProjectGraphAsync({
        exitOnError: false,
      });
      const dependents: string[] = [];

      for (const [project, deps] of Object.entries(projectGraph.dependencies)) {
        if (deps.some((dep) => dep.target === projectName)) {
          dependents.push(project);
        }
      }

      return dependents;
    } catch (error) {
      console.warn(`Could not get dependents for ${projectName}:`, error);
      return [];
    }
  }

  async getAffectedProjects(changedFiles: string[]): Promise<string[]> {
    try {
      const affectedProjects = new Set<string>();

      // Find which projects contain the changed files
      for (const filePath of changedFiles) {
        const projects = await this.getFileProjects(filePath);
        for (const project of projects) {
          affectedProjects.add(project.name);

          // Also add dependent projects
          const dependents = await this.getProjectDependents(project.name);
          dependents.forEach((dep) => affectedProjects.add(dep));
        }
      }

      return Array.from(affectedProjects);
    } catch (error) {
      console.warn('Could not determine affected projects:', error);
      return [];
    }
  }

  // File dependency methods (Nx file-map ingestion)
  async clearFileDependencies(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM file_dependencies', (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  findDefinition(fileName: string, targetPackage: string): SymbolDefinition[] {
    const configFilePath =
      ts.findConfigFile(fileName, ts.sys.fileExists) ||
      path.join(workspaceRoot, 'tsconfig.json');
    const configHost: ts.ParseConfigFileHost = {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configFilePath,
      undefined,
      configHost
    );
    const program = ts.createProgram([fileName], parsed?.options || {});
    const sourceFile = program.getSourceFile(fileName);
    const checker = program.getTypeChecker();
    const foundSymbols: SymbolDefinition[] = [];

    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        // Get the module name (stripping quotes)
        const moduleName = node.moduleSpecifier
          .getText(sourceFile)
          .replace(/['"]/g, '');

        if (moduleName.includes(targetPackage)) {
          const importClause = node.importClause;

          if (
            importClause?.namedBindings &&
            ts.isNamedImports(importClause.namedBindings)
          ) {
            // Handle Named Imports: import { useState, useEffect } from 'react'
            importClause.namedBindings.elements.forEach((namedImport) => {
              const symbol = checker.getSymbolAtLocation(namedImport.name);
              let defined_in_file: string | undefined = undefined;
              if (symbol) {
                // Follow the import chain to the original definition
                const aliasedSymbol = checker.getAliasedSymbol(symbol);
                const declaration =
                  aliasedSymbol?.declarations?.[0] || symbol.declarations?.[0];

                if (declaration) {
                  defined_in_file = declaration.getSourceFile().fileName.replace(workspaceRoot + '/', '');
                }
              }
              foundSymbols.push({
                symbol: namedImport.name.text,
                defined_in_project: targetPackage,
                defined_in_file,
              });
              console.log(
                `Import: ${namedImport.name.text} in ${fileName} defined in: ${defined_in_file}`
              );
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile!);
    return foundSymbols;
  }

  async addFileDependency(
    filePath: string,
    dependsOn: string
  ): Promise<void[]> {
    const foundSymbols = this.findDefinition(filePath, dependsOn);
    return Promise.all(
      foundSymbols.map(
        (foundSymbol) =>
          new Promise<void>((resolve, reject) => {
            const stmt = this.db.prepare(
              'INSERT OR IGNORE INTO file_dependencies (file_path, depends_on_project, depends_on_file) VALUES (?, ?, ?)'
            );
            stmt.run(
              [filePath, dependsOn, foundSymbol.defined_in_file],
              (err: Error | null) => {
                if (err) reject(err);
                else resolve();
              }
            );
            stmt.finalize();
          })
      )
    );
  }

  async getFileDependencies(filePath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT depends_on FROM file_dependencies WHERE file_path = ? ORDER BY depends_on',
        [filePath],
        (err: Error | null, rows: Array<{ depends_on: string }>) => {
          if (err) reject(err);
          else resolve(rows.map((r) => r.depends_on));
        }
      );
    });
  }

  async getFileDependents(dependsOn: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT file_path FROM file_dependencies WHERE depends_on = ? ORDER BY file_path',
        [dependsOn],
        (err: Error | null, rows: Array<{ file_path: string }>) => {
          if (err) reject(err);
          else resolve(rows.map((r) => r.file_path));
        }
      );
    });
  }

  async syncFileDependenciesFromNx(workspaceRoot?: string): Promise<number> {
    const root = workspaceRoot ? path.resolve(workspaceRoot) : process.cwd();
    // Determine Nx cache dir from nx.json if present, default to .nx
    let cacheDir = '.nx';
    try {
      const nxJsonPath = path.join(root, 'nx.json');
      if (fs.existsSync(nxJsonPath)) {
        const nxConfig = JSON.parse(
          fs.readFileSync(nxJsonPath, 'utf8')
        ) as Record<string, unknown>;
        const installation = (nxConfig as any).installation;
        if (
          installation &&
          typeof installation === 'object' &&
          typeof (installation as any).cacheDirectory === 'string'
        ) {
          cacheDir = (installation as any).cacheDirectory as string;
        }
      }
    } catch {
      // ignore and use default
    }

    const fileMapPath = path.join(
      root,
      cacheDir,
      'workspace-data',
      'file-map.json'
    );
    if (!fs.existsSync(fileMapPath)) {
      throw new Error(`Nx file map not found at ${fileMapPath}`);
    }

    const content = fs.readFileSync(fileMapPath, 'utf8');
    const parsed = JSON.parse(content) as any;

    let inserted = 0;
    await this.clearFileDependencies();

    // Helper to process one record
    const processEntry = async (filePathRel: string, deps: unknown) => {
      if (!deps || !Array.isArray(deps)) return;
      for (const dep of deps) {
        // Accept only workspace file paths (exclude npm: or tuples with non-file info)
        if (typeof dep === 'string') {
          if (dep.startsWith('npm:') || dep === 'dynamic') continue;
          await this.addFileDependency(filePathRel, dep);
          inserted++;
        } else if (
          Array.isArray(dep) &&
          dep.length > 0 &&
          typeof dep[0] === 'string'
        ) {
          const depStr = dep[0] as string;
          if (depStr.startsWith('npm:') || depStr === 'dynamic') continue;
          await this.addFileDependency(filePathRel, depStr);
          inserted++;
        }
      }
    };

    // nonProjectFiles
    const nonProjectFiles: Array<{ file: string; deps?: unknown }> =
      parsed?.fileMap?.nonProjectFiles ?? [];
    for (const entry of nonProjectFiles) {
      await processEntry(entry.file, (entry as any).deps);
    }

    // projectFileMap
    const projectFileMap = parsed?.fileMap?.projectFileMap ?? {};
    for (const project of Object.keys(projectFileMap)) {
      const files: Array<{ file: string; deps?: unknown }> =
        projectFileMap[project] ?? [];
      for (const entry of files) {
        await processEntry(entry.file, (entry as any).deps);
      }
    }

    return inserted;
  }

  // Git commit tracking methods
  async syncGitCommits(commitCount = 100): Promise<void> {
    try {
      // Get commit information using git log
      const gitLogOutput = execSync(
        `git log --oneline --name-status -${commitCount} --pretty=format:"%H|%an|%ad|%s" --date=iso`,
        { encoding: 'utf8', cwd: process.cwd() }
      );

      const lines = gitLogOutput.split('\n').filter((line) => line.trim());
      let currentCommit: Partial<GitCommit> | null = null;
      const touchedFiles: Array<{ filePath: string; changeType: string }> = [];

      for (const line of lines) {
        if (line.includes('|')) {
          // This is a commit line
          if (currentCommit && touchedFiles.length > 0) {
            // Save the previous commit and its files
            await this.saveCommitWithFiles(
              currentCommit as GitCommit,
              touchedFiles
            );
            touchedFiles.length = 0; // Clear the array
          }

          const [hash, author, date, message] = line.split('|');
          currentCommit = {
            hash: hash.trim(),
            author: author.trim(),
            date: date.trim(),
            message: message.trim(),
          };
        } else if (currentCommit && line.match(/^[AMDRT]\s+/)) {
          // This is a file change line (A/M/D/R/T followed by filename)
          const changeType = line.charAt(0);
          const filePath = line.substring(2).trim();
          touchedFiles.push({ filePath, changeType });
        }
      }

      // Don't forget the last commit
      if (currentCommit && touchedFiles.length > 0) {
        await this.saveCommitWithFiles(
          currentCommit as GitCommit,
          touchedFiles
        );
      }

      console.log(`Synced ${commitCount} git commits to database`);
    } catch (error) {
      throw new Error(
        `Failed to sync git commits: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  private async saveCommitWithFiles(
    commit: GitCommit,
    touchedFiles: Array<{ filePath: string; changeType: string }>
  ): Promise<void> {
    // First, insert or get the commit
    const commitId = await this.insertCommit(commit);

    // Then insert all touched files for this commit
    for (const file of touchedFiles) {
      await this.insertTouchedFile(commitId, file.filePath, file.changeType);
    }
  }

  private async insertCommit(commit: GitCommit): Promise<number> {
    return new Promise((resolve, reject) => {
      // Use INSERT OR IGNORE to avoid duplicates
      const dbRef = this.db;
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO git_commits (hash, author, date, message) 
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(
        [commit.hash, commit.author, commit.date, commit.message],
        function (err) {
          if (err) {
            reject(err);
            return;
          }

          // If we inserted a new row, use the lastID
          if ((this.lastID ?? 0) > 0) {
            resolve(this.lastID as number);
            return;
          }

          // Insert was ignored (duplicate hash). Query the existing row id.
          dbRef.get(
            'SELECT id FROM git_commits WHERE hash = ?',
            [commit.hash],
            (err2: Error | null, row: { id: number } | undefined) => {
              if (err2) {
                reject(err2);
              } else if (row && typeof row.id === 'number') {
                resolve(row.id);
              } else {
                reject(new Error('Failed to insert or retrieve commit'));
              }
            }
          );
        }
      );
      stmt.finalize();
    });
  }

  private async insertTouchedFile(
    commitId: number,
    filePath: string,
    changeType: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO touched_files (commit_id, file_path, change_type) 
        VALUES (?, ?, ?)
      `);
      stmt.run([commitId, filePath, changeType], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
      stmt.finalize();
    });
  }

  async getCommits(limit = 50): Promise<GitCommit[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM git_commits ORDER BY date DESC LIMIT ?',
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows as GitCommit[]);
          }
        }
      );
    });
  }

  async getTouchedFiles(commitHash?: string): Promise<TouchedFile[]> {
    return new Promise((resolve, reject) => {
      let query = `
        SELECT tf.*, gc.hash, gc.author, gc.date, gc.message 
        FROM touched_files tf
        JOIN git_commits gc ON tf.commit_id = gc.id
      `;
      const params: string[] = [];

      if (commitHash) {
        query += ' WHERE gc.hash = ?';
        params.push(commitHash);
      }

      query += ' ORDER BY gc.date DESC, tf.file_path';

      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as TouchedFile[]);
        }
      });
    });
  }

  async getFilesTouchedInLastCommits(commitCount = 100): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT DISTINCT tf.file_path 
        FROM touched_files tf
        JOIN git_commits gc ON tf.commit_id = gc.id
        ORDER BY gc.date DESC
        LIMIT ?
      `;

      this.db.all(
        query,
        [commitCount * 10],
        (err, rows: { file_path: string }[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map((row) => row.file_path));
          }
        }
      );
    });
  }

  async getProjectsAffectedByCommits(commitCount = 100): Promise<string[]> {
    try {
      const touchedFiles = await this.getFilesTouchedInLastCommits(commitCount);
      const affectedProjects = new Set<string>();

      for (const filePath of touchedFiles) {
        const projects = await this.getFileProjects(filePath);
        for (const project of projects) {
          affectedProjects.add(project.name);
        }
      }

      return Array.from(affectedProjects);
    } catch (error) {
      console.warn('Could not determine projects affected by commits:', error);
      return [];
    }
  }

  close(): void {
    this.db.close();
  }
}

// Export convenience functions
export async function createDatabase(
  dbPath?: string
): Promise<ProjectDatabase> {
  return new ProjectDatabase(dbPath);
}

export function db(): string {
  return 'db';
}

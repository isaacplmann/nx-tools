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
import {
  Project,
  ProjectFile,
  SymbolDefinition,
  GitCommit,
  TouchedFile,
  FileDependency,
  ProjectMetrics,
} from './types.js';

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

    const createProjectDepsTable = `
      CREATE TABLE IF NOT EXISTS project_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_project TEXT NOT NULL,
        target_project TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_project, target_project)
      )
    `;

    this.db.serialize(() => {
      this.db.run(createProjectsTable);
      this.db.run(createFilesTable);
      this.db.run(createCommitsTable);
      this.db.run(createTouchedFilesTable);
      this.db.run(createFileDepsTable);
      this.db.run(createProjectDepsTable);
    });
  }

  private query<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
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
    return this.query<Project>('SELECT * FROM projects ORDER BY name');
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

  async getProjectsByType(projectType: string): Promise<Project[]> {
    return this.query<Project>(
      'SELECT * FROM projects WHERE project_type = ? ORDER BY name',
      [projectType]
    );
  }

  async getProjectsByTag(tag: string): Promise<Project[]> {
    return this.query<Project>(
      'SELECT * FROM projects WHERE tags LIKE ? ORDER BY name',
      [`%${tag}%`]
    );
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

    return this.query<ProjectFile>(
      'SELECT * FROM project_files WHERE project_id = ? ORDER BY file_path',
      [project.id]
    );
  }

  async getFileProjects(filePath: string): Promise<Project[]> {
    return this.query<Project>(
      `
        SELECT p.* FROM projects p
        JOIN project_files pf ON p.id = pf.project_id
        WHERE pf.file_path = ?
        ORDER BY p.name
      `,
      [filePath]
    );
  }

  // Nx-specific query methods
  async syncAllProjectDependencies(): Promise<
    { source: string; target: string }[]
  > {
    try {
      const projectGraph = await createProjectGraphAsync({ exitOnError: false });
      const dependencies: { source: string; target: string }[] = [];

      // 1) Start with the dependencies from the Nx project graph
      for (const [projectName, deps] of Object.entries(
        projectGraph.dependencies
      )) {
        dependencies.push(
          ...deps.map((dep) => ({ source: projectName, target: dep.target }))
        );
      }

      // 2) Augment with dependencies inferred from the Nx file map.
      //    We look for file deps that reference a project name directly
      //    or with an `npm:` prefix (e.g. `npm:my-project`).
      const { projectFileMap } = this.loadNxFileMap();
      const projectNames = new Set(Object.keys(projectGraph.nodes));

      for (const [sourceProject, files] of Object.entries(projectFileMap)) {
        if (!projectNames.has(sourceProject)) continue;

        for (const entry of files) {
          const deps = (entry as any).deps;
          if (!deps || !Array.isArray(deps)) continue;

          for (const dep of deps) {
            let depStr: string | undefined;
            if (typeof dep === 'string') {
              depStr = dep;
            } else if (
              Array.isArray(dep) &&
              dep.length > 0 &&
              typeof dep[0] === 'string'
            ) {
              depStr = dep[0] as string;
            }
            if (!depStr || depStr === 'dynamic') continue;

            // Match direct project name
            if (projectNames.has(depStr)) {
              dependencies.push({ source: sourceProject, target: depStr });
              continue;
            }

            // Match `npm:` + project name
            if (depStr.startsWith('npm:')) {
              const candidate = depStr.slice('npm:'.length);
              if (projectNames.has(candidate)) {
                dependencies.push({
                  source: sourceProject,
                  target: candidate,
                });
              }
            }
          }
        }
      }

      // Persist dependencies to the database (replace existing)
      await new Promise<void>((resolve, reject) => {
        this.db.serialize(() => {
          this.db.run('BEGIN TRANSACTION', (err: Error | null) => {
            if (err) return reject(err);

            this.db.run(
              'DELETE FROM project_dependencies',
              (delErr: Error | null) => {
                if (delErr) return reject(delErr);

                const stmt = this.db.prepare(
                  'INSERT OR IGNORE INTO project_dependencies (source_project, target_project) VALUES (?, ?)'
                );

                if (dependencies.length === 0) {
                  stmt.finalize((finalizeErr) => {
                    if (finalizeErr) return reject(finalizeErr);
                    this.db.run('COMMIT', (commitErr: Error | null) => {
                      if (commitErr) return reject(commitErr);
                      resolve();
                    });
                  });
                  return;
                }

                let pending = dependencies.length;
                for (const d of dependencies) {
                  stmt.run([d.source, d.target], (runErr: Error | null) => {
                    if (runErr) {
                      stmt.finalize();
                      return reject(runErr);
                    }
                    pending--;
                    if (pending === 0) {
                      stmt.finalize((finalizeErr) => {
                        if (finalizeErr) return reject(finalizeErr);
                        this.db.run('COMMIT', (commitErr: Error | null) => {
                          if (commitErr) return reject(commitErr);
                          resolve();
                        });
                      });
                    }
                  });
                }
              }
            );
          });
        });
      });

      return dependencies;
    } catch (error) {
      console.warn(`Could not sync dependencies:`, error);
      return [];
    }
  }

  async getProjectDependencies(projectName: string): Promise<string[]> {
    try {
      // Compute transitive dependencies from the project_dependencies table.
      const result = new Set<string>();
      const visited = new Set<string>();
      const queue: string[] = [projectName];
      visited.add(projectName);

      while (queue.length > 0) {
        // Process in small batches to avoid huge IN (...) lists
        const batch = queue.splice(0, 50);
        const placeholders = batch.map(() => '?').join(',');
        const rows = await this.query<{ target_project: string }>(
          `SELECT target_project FROM project_dependencies WHERE source_project IN (${placeholders})`,
          batch as any
        );

        for (const r of rows) {
          const t = r.target_project;
          if (!visited.has(t)) {
            visited.add(t);
            result.add(t);
            queue.push(t);
          }
        }
      }

      return Array.from(result);
    } catch (error) {
      console.warn(`Could not get dependencies for ${projectName}:`, error);
      return [];
    }
  }

  async getProjectDependents(projectName: string): Promise<string[]> {
    try {
      // Compute transitive dependents using the project_dependencies table.
      const result = new Set<string>();
      const visited = new Set<string>();
      const queue: string[] = [projectName];
      visited.add(projectName);

      while (queue.length > 0) {
        const batch = queue.splice(0, 50);
        const placeholders = batch.map(() => '?').join(',');
        const rows = await this.query<{ source_project: string }>(
          `SELECT source_project FROM project_dependencies WHERE target_project IN (${placeholders})`,
          batch as any
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

  /**
   * Loads and parses the Nx file map from the cache directory.
   * Returns the parsed file map data and the workspace root.
   */
  private loadNxFileMap(): {
    root: string;
    cacheDir: string;
    nonProjectFiles: Array<{ file: string; deps?: unknown }>;
    projectFileMap: Record<string, Array<{ file: string; deps?: unknown }>>;
  } {
    const root = process.cwd();
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

    const nonProjectFiles: Array<{ file: string; deps?: unknown }> =
      parsed?.fileMap?.nonProjectFiles ?? [];
    const projectFileMap =
      parsed?.fileMap?.projectFileMap ??
      ({} as Record<string, Array<{ file: string; deps?: unknown }>>);

    return { root, cacheDir, nonProjectFiles, projectFileMap };
  }

  /**
   * Creates a TypeScript program and checker from a list of file paths.
   * Returns undefined if program creation fails (graceful fallback).
   */
  private createTypeScriptProgram(
    root: string,
    filePaths: string[]
  ): { program: ts.Program; checker: ts.TypeChecker } | undefined {
    try {
      const configFilePath =
        ts.findConfigFile(root, ts.sys.fileExists) ||
        path.join(root, 'tsconfig.json');
      const configHost: ts.ParseConfigFileHost = {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {
          /** intentionally empty */
        },
      };
      const parsedConfig = ts.getParsedCommandLineOfConfigFile(
        configFilePath,
        undefined,
        configHost
      );

      const program = ts.createProgram(filePaths, parsedConfig?.options || {});
      const checker = program.getTypeChecker();
      return { program, checker };
    } catch (e) {
      // If program creation fails (e.g., missing files in test environment), return undefined
      return undefined;
    }
  }

  /**
   * Batch inserts file dependency records into the database in a single transaction.
   */
  private async batchInsertFileDependencies(
    records: Array<{
      filePath: string;
      dependsOn: string;
      defined_in_file?: string | null;
    }>
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        const stmt = this.db.prepare(
          'INSERT OR IGNORE INTO file_dependencies (file_path, depends_on_project, depends_on_file) VALUES (?, ?, ?)'
        );

        let pending = records.length;

        for (const r of records) {
          stmt.run(
            [r.filePath, r.dependsOn, r.defined_in_file],
            (err: Error | null) => {
              if (err) {
                // Ensure stmt finalized and propagate error
                stmt.finalize();
                reject(err);
                return;
              }

              pending--;
              if (pending === 0) {
                stmt.finalize((err) => {
                  if (err) return reject(err);
                  this.db.run('COMMIT', (err) => {
                    if (err) return reject(err);
                    resolve();
                  });
                });
              }
            }
          );
        }
      });
    });
  }

  /**
   * Processes a single file entry to extract dependency records.
   * Returns an array of dependency records found for this file.
   */
  private processFileEntry(
    filePathRel: string,
    deps: unknown,
    projectName: string,
    root: string,
    program?: ts.Program,
    checker?: ts.TypeChecker
  ): Array<{
    filePath: string;
    dependsOn: string;
    defined_in_file?: string | null;
  }> {
    const records: Array<{
      filePath: string;
      dependsOn: string;
      defined_in_file?: string | null;
    }> = [];

    if (!deps || !Array.isArray(deps)) return records;

    for (const dep of deps) {
      let depStr: string | undefined;
      if (typeof dep === 'string') {
        depStr = dep;
      } else if (
        Array.isArray(dep) &&
        dep.length > 0 &&
        typeof dep[0] === 'string'
      ) {
        depStr = dep[0] as string;
      }
      if (!depStr) continue;
      if (
        (depStr.startsWith('npm:') &&
          !depStr.startsWith('npm:' + projectName)) ||
        depStr === 'dynamic'
      )
        continue;

      // Resolve file path to absolute when program provided
      const absFile = path.resolve(root, filePathRel);

      let found: SymbolDefinition[] = [];
      if (program && checker) {
        found = this.findDefinition(absFile, depStr, program, checker);
      } else {
        // Fallback to old behavior (slower)
        found = this.findDefinition(filePathRel, depStr);
      }

      for (const f of found) {
        records.push({
          filePath: filePathRel,
          dependsOn: depStr,
          defined_in_file: f.defined_in_file ?? null,
        });
      }
    }

    return records;
  }

  // Accept an optional Program & TypeChecker to avoid rebuilding per-file (performance)
  findDefinition(
    fileName: string,
    targetPackage: string,
    program?: ts.Program,
    checker?: ts.TypeChecker
  ): SymbolDefinition[] {
    let localProgram: ts.Program | undefined = program;
    let localChecker: ts.TypeChecker | undefined = checker;

    // If no program/checker provided, fall back to previous behavior (single-file program)
    if (!localProgram || !localChecker) {
      const configFilePath =
        ts.findConfigFile(fileName, ts.sys.fileExists) ||
        path.join(workspaceRoot, 'tsconfig.json');
      const configHost: ts.ParseConfigFileHost = {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {
          /** intentionally empty */
        },
      };
      const parsed = ts.getParsedCommandLineOfConfigFile(
        configFilePath,
        undefined,
        configHost
      );
      localProgram = ts.createProgram([fileName], parsed?.options || {});
      localChecker = localProgram.getTypeChecker();
    }

    const sourceFile = localProgram.getSourceFile(fileName);
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
              const symbol = localChecker!.getSymbolAtLocation(
                namedImport.name
              );
              let defined_in_file: string | undefined = undefined;
              if (symbol) {
                // Follow the import chain to the original definition
                const aliasedSymbol = localChecker!.getAliasedSymbol(symbol);
                const declaration =
                  aliasedSymbol?.declarations?.[0] || symbol.declarations?.[0];

                if (declaration) {
                  defined_in_file = declaration
                    .getSourceFile()
                    .fileName.replace(workspaceRoot + '/', '');
                }
              }
              foundSymbols.push({
                symbol: namedImport.name.text,
                defined_in_project: targetPackage,
                defined_in_file,
              });
              // Keep logging for now; can be toggled later if needed
              // console.log(
              //   `Import: ${namedImport.name.text} in ${fileName} defined in: ${defined_in_file}`
              // );
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    if (sourceFile) visit(sourceFile);
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
    return this.query<FileDependency>(
      'SELECT depends_on_project FROM file_dependencies WHERE file_path = ? ORDER BY depends_on_project',
      [filePath]
    ).then((rows) => rows.map((r) => r.depends_on_project));
  }

  async getFileDependents(dependsOn: string): Promise<string[]> {
    return this.query<FileDependency>(
      'SELECT file_path FROM file_dependencies WHERE depends_on_project = ? ORDER BY file_path',
      [dependsOn]
    ).then((rows) => rows.map((r) => r.file_path));
  }

  /**
   * Get projects that have files depending on the given file.
   * Returns unique project names.
   */
  async getProjectsDependingOnFile(filePath: string): Promise<string[]> {
    return this.query<{ name: string }>(
      `
        SELECT DISTINCT p.name
        FROM projects p
        JOIN project_files pf ON p.id = pf.project_id
        JOIN file_dependencies fd ON fd.file_path = pf.file_path
        WHERE fd.depends_on_file = ?
        ORDER BY p.name
      `,
      [filePath]
    ).then((rows) => rows.map((r) => r.name));
  }

  /**
   * Finds all outgoing file dependencies from a single project.
   * Returns an array of dependency records that should be inserted into the database.
   */
  private findProjectFileDependencies(
    projectName: string,
    projectFiles: Array<{ file: string; deps?: unknown }>,
    root: string,
    program?: ts.Program,
    checker?: ts.TypeChecker
  ): Array<{
    filePath: string;
    dependsOn: string;
    defined_in_file?: string | null;
  }> {
    const records: Array<{
      filePath: string;
      dependsOn: string;
      defined_in_file?: string | null;
    }> = [];

    // Process all files in this project
    for (const entry of projectFiles) {
      const entryRecords = this.processFileEntry(
        entry.file,
        entry.deps,
        projectName,
        root,
        program,
        checker
      );
      records.push(...entryRecords);
    }

    return records;
  }

  /**
   * Syncs file dependencies for a single project.
   * This includes:
   * - Outgoing dependencies: files in the project that depend on other projects
   * - Incoming dependencies: files in other projects that depend on files in this project
   */
  async syncFileDependenciesForProject(projectName: string): Promise<number> {
    const { root, nonProjectFiles, projectFileMap } = this.loadNxFileMap();

    // Get the project's files
    const projectFiles = projectFileMap[projectName];
    if (!projectFiles || projectFiles.length === 0) {
      return 0;
    }

    // Collect all file entries to build a TS program
    const allEntries: Array<{ file: string; deps?: unknown }> = [];
    for (const entry of nonProjectFiles) allEntries.push(entry);
    for (const files of Object.values(projectFileMap)) {
      for (const entry of files as any) allEntries.push(entry);
    }

    // Build absolute file list for TS program
    const allFileAbs = Array.from(
      new Set(allEntries.map((e) => path.resolve(root, e.file)))
    );

    // Create TypeScript program for all files
    const tsProgram = this.createTypeScriptProgram(root, allFileAbs);
    const program = tsProgram?.program;
    const checker = tsProgram?.checker;

    const records: Array<{
      filePath: string;
      dependsOn: string;
      defined_in_file?: string | null;
    }> = [];

    // Process outgoing dependencies: files in this project that depend on other projects
    const outgoingRecords = this.findProjectFileDependencies(
      projectName,
      projectFiles,
      root,
      program,
      checker
    );
    records.push(...outgoingRecords);

    // Process incoming dependencies: files in other projects that depend on this project
    // We need to check all other files to see if they depend on this project
    const projectFileSet = new Set(
      projectFiles.map((f) => path.resolve(root, f.file))
    );

    for (const [otherProjectName, otherFiles] of Object.entries(
      projectFileMap
    )) {
      if (otherProjectName === projectName) continue; // Already processed above

      for (const entry of otherFiles) {
        const entryRecords = this.processFileEntry(
          entry.file,
          entry.deps,
          otherProjectName,
          root,
          program,
          checker
        );

        // Filter to only include dependencies that target this project
        // Either depends_on_project matches, or depends_on_file is in this project
        for (const record of entryRecords) {
          if (
            record.dependsOn === projectName ||
            (record.defined_in_file &&
              projectFileSet.has(path.resolve(root, record.defined_in_file)))
          ) {
            records.push(record);
          }
        }
      }
    }

    // Also check non-project files for dependencies on this project
    for (const entry of nonProjectFiles) {
      const entryRecords = this.processFileEntry(
        entry.file,
        entry.deps,
        '',
        root,
        program,
        checker
      );

      // Filter to only include dependencies that target this project
      for (const record of entryRecords) {
        if (
          record.dependsOn === projectName ||
          (record.defined_in_file &&
            projectFileSet.has(path.resolve(root, record.defined_in_file)))
        ) {
          records.push(record);
        }
      }
    }

    // Batch insert all records
    await this.batchInsertFileDependencies(records);

    return records.length;
  }

  async syncFileDependenciesFromNx(): Promise<number> {
    const { root, nonProjectFiles, projectFileMap } = this.loadNxFileMap();

    // Collect all file records to build a single TS program (faster than per-file)
    const allEntries: Array<{ file: string; deps?: unknown }> = [];
    for (const entry of nonProjectFiles) allEntries.push(entry);
    for (const files of Object.values(projectFileMap)) {
      for (const entry of files as any) allEntries.push(entry);
    }

    // Build absolute file list for TS program
    const allFileAbs = Array.from(
      new Set(allEntries.map((e) => path.resolve(root, e.file)))
    );

    // Create TypeScript program for all files
    const tsProgram = this.createTypeScriptProgram(root, allFileAbs);
    const program = tsProgram?.program;
    const checker = tsProgram?.checker;

    await this.clearFileDependencies();

    // Gather dependency insertion records in memory first
    const records: Array<{
      filePath: string;
      dependsOn: string;
      defined_in_file?: string | null;
    }> = [];

    // Process each project's files
    for (const [projectName, files] of Object.entries(projectFileMap)) {
      const projectRecords = this.findProjectFileDependencies(
        projectName,
        files as Array<{ file: string; deps?: unknown }>,
        root,
        program,
        checker
      );
      records.push(...projectRecords);
    }

    // Process non-project files (treat as a special "non-project" project)
    if (nonProjectFiles.length > 0) {
      const nonProjectRecords = this.findProjectFileDependencies(
        '',
        nonProjectFiles,
        root,
        program,
        checker
      );
      records.push(...nonProjectRecords);
    }

    // Batch insert all records in a single transaction for performance
    await this.batchInsertFileDependencies(records);

    return records.length;
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
    return this.query<GitCommit>(
      'SELECT * FROM git_commits ORDER BY date DESC LIMIT ?',
      [limit]
    );
  }

  async getTouchedFiles(commitHash?: string): Promise<TouchedFile[]> {
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

    return this.query<TouchedFile>(query, params);
  }

  async getFilesTouchedInLastCommits(commitCount = 100): Promise<string[]> {
    const query = `
      SELECT DISTINCT tf.file_path 
      FROM touched_files tf
      WHERE tf.commit_id IN (
        SELECT id FROM git_commits 
        ORDER BY date DESC 
        LIMIT ?
      )
      ORDER BY tf.file_path
    `;

    return this.query<TouchedFile>(query, [commitCount]).then((rows) =>
      rows.map((row) => row.file_path)
    );
  }

  async getAllProjectsLoad(
    commitCount = 100
  ): Promise<{ name: string; load: number }[]> {
    const touchCount = await this.getAllProjectsTouchedCount(commitCount);
    return Promise.all(
      touchCount.map(async (p) => {
        const dependentsCount = (await this.getProjectDependents(p.name))
          .length;
        return { name: p.name, load: p.touch_count * dependentsCount };
      })
    ).then((projects) => projects.sort((a, b) => b.load - a.load));
  }

  async getAllProjectsTouchedCount(
    commitCount = 100
  ): Promise<{ name: string; touch_count: number }[]> {
    const query = `
      SELECT p.name, COUNT(DISTINCT tf.commit_id) as touch_count
      FROM projects p
      JOIN project_files pf ON pf.project_id = p.id
      JOIN touched_files tf ON tf.file_path = pf.file_path
      WHERE tf.commit_id IN (
        SELECT id FROM git_commits
        ORDER BY date DESC
        LIMIT ?
      )
      GROUP BY p.name
      ORDER BY touch_count DESC
    `;

    return this.query<{ name: string; touch_count: number }>(query, [
      commitCount,
    ]);
  }

  async getAllProjectsAffectedCount(
    commitCount = 100
  ): Promise<{ name: string; affected_count: number }[]> {
    // Step 1: get recent commit ids
    const commitRows = await this.query<{ id: number }>(
      `SELECT id FROM git_commits ORDER BY date DESC LIMIT ?`,
      [commitCount]
    );

    const commitIds = commitRows.map((r) => r.id);

    if (commitIds.length === 0) return [];

    // Step 1 (cont): get touched projects per commit
    const touchedRows = await this.query<{
      commit_id: number;
      project_name: string;
    }>(
      `
        SELECT tf.commit_id, p.name as project_name
        FROM touched_files tf
        JOIN project_files pf ON pf.file_path = tf.file_path
        JOIN projects p ON p.id = pf.project_id
        WHERE tf.commit_id IN (${commitIds.map(() => '?').join(',')})
      `,
      commitIds as any
    );

    // Build map: commitId -> Set of directly touched project names
    const touchedByCommit = new Map<number, Set<string>>();
    for (const r of touchedRows) {
      const s = touchedByCommit.get(r.commit_id) || new Set<string>();
      s.add(r.project_name);
      touchedByCommit.set(r.commit_id, s);
    }

    // Step 2: build dependents map
    // Build the set of projects we need dependents for and compute touched map in one pass
    const projectsToCompute = new Set<string>();
    for (const r of touchedRows) projectsToCompute.add(r.project_name);

    // Fetch dependents in parallel for better performance
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

    // Compute affected counts by iterating commits once and adding touched + dependents
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

    // Ensure all projects are present (with zero) so result covers every project
    const allProjects = await this.query<{ name: string }>(
      'SELECT name FROM projects'
    );
    const result: { name: string; affected_count: number }[] = allProjects.map(
      (p) => ({
        name: p.name,
        affected_count: affectedCounts.get(p.name) || 0,
      })
    );

    // Sort by descending affected_count
    result.sort((a, b) => b.affected_count - a.affected_count);
    return result;
  }

  async getAllProjectsMetrics(commitCount = 100): Promise<ProjectMetrics[]> {
    // Fetch all projects and recent commits in parallel
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

    // Single query to get touched projects and file counts for all projects in one pass
    const touchedRows = await this.query<{
      commit_id: number;
      project_name: string;
      project_id: number;
    }>(
      `
        SELECT DISTINCT tf.commit_id, p.name as project_name, p.id as project_id
        FROM touched_files tf
        JOIN project_files pf ON pf.file_path = tf.file_path
        JOIN projects p ON p.id = pf.project_id
        WHERE tf.commit_id IN (${commitIds.map(() => '?').join(',')})
      `,
      commitIds as any
    );

    // Build maps for touched counts and commit tracking
    const touchedByCommit = new Map<number, Set<string>>();
    const touchCountMap = new Map<string, number>();
    const projectsToCompute = new Set<string>();

    for (const r of touchedRows) {
      // For affected counts
      const s = touchedByCommit.get(r.commit_id) || new Set<string>();
      s.add(r.project_name);
      touchedByCommit.set(r.commit_id, s);

      // For touched counts
      touchCountMap.set(
        r.project_name,
        (touchCountMap.get(r.project_name) || 0) + 1
      );
      projectsToCompute.add(r.project_name);
    }

    // Build dependents map for load and affected calculations (parallel)
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

    // Calculate affected counts by iterating commits once
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

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
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

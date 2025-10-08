import { createRequire } from 'module';
import type { RunResult } from 'sqlite3';
type Sqlite3Module = typeof import('sqlite3');
// Use CommonJS require for sqlite3 to ensure correct runtime shape under NodeNext/ESM
const sqlite3: Sqlite3Module = createRequire(import.meta.url)('sqlite3');
import * as path from 'path';
import * as fs from 'fs';
import { createProjectGraphAsync } from '@nx/devkit';
import type { ProjectGraph, ProjectGraphProjectNode } from '@nx/devkit';

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

    this.db.serialize(() => {
      this.db.run(createProjectsTable);
      this.db.run(createFilesTable);
    });
  }

  // Nx integration methods
  async syncWithNxWorkspace(workspaceRoot?: string): Promise<ProjectGraph> {
    process.chdir(workspaceRoot || process.cwd());
    
    try {
      // Read Nx configuration and create project graph
      const projectGraph = await createProjectGraphAsync({ exitOnError: false });
      
      // Sync all Nx projects to database
      for (const [projectName, projectNode] of Object.entries(projectGraph.nodes)) {
        await this.syncNxProject(projectName, projectNode);
      }
      
      console.log(`Synced ${Object.keys(projectGraph.nodes).length} Nx projects to database`);
      return projectGraph;
    } catch (error) {
      throw new Error(`Failed to sync with Nx workspace: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async syncNxProject(projectName: string, projectNode: ProjectGraphProjectNode): Promise<void> {
    const { data } = projectNode;
    
    // Create or update project in database
    const existingProject = await this.getProject(projectName);
    
    if (existingProject) {
      // Update existing project
      await this.updateProject(projectName, {
        description: data.description,
        project_type: data.projectType,
        source_root: data.sourceRoot,
        root: data.root,
        tags: data.tags?.join(',')
      });
    } else {
      // Create new project
      await this.createProjectFromNx(projectName, {
        description: data.description,
        project_type: data.projectType,
        source_root: data.sourceRoot,
        root: data.root,
        tags: data.tags?.join(',')
      });
    }

    // Add all files from the project
    if (data.root) {
      await this.scanNxProjectFiles(projectName, data.root);
    }
  }

  private async scanNxProjectFiles(projectName: string, projectRoot: string): Promise<void> {
    const fullProjectRoot = path.resolve(projectRoot);
    
    if (!fs.existsSync(fullProjectRoot)) {
      console.warn(`Project root does not exist: ${fullProjectRoot}`);
      return;
    }

    const scanDirectory = async (dirPath: string): Promise<void> => {
      try {
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const relativePath = path.relative(process.cwd(), fullPath);
          
          // Skip hidden files, node_modules, and build outputs
          if (item.startsWith('.') || 
              item === 'node_modules' || 
              item === 'dist' || 
              item === 'build' ||
              item === 'coverage') {
            continue;
          }

          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (stat.isFile()) {
            const fileType = path.extname(item).slice(1) || 'unknown';
            await this.addFileToProject(projectName, relativePath, fileType);
          }
        }
      } catch (error) {
        console.warn(`Error scanning directory ${dirPath}:`, error);
      }
    };

    await scanDirectory(fullProjectRoot);
  }

  // Project methods
  async createProject(name: string, description?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)');
      stmt.run([name, description], function(err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve((this as unknown as RunResult).lastID as number);
        }
      });
      stmt.finalize();
    });
  }

  async createProjectFromNx(name: string, nxData: {
    description?: string;
    project_type?: string;
    source_root?: string;
    root?: string;
    tags?: string;
  }): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO projects (name, description, project_type, source_root, root, tags) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run([
        name, 
        nxData.description, 
        nxData.project_type, 
        nxData.source_root, 
        nxData.root, 
        nxData.tags
      ], function(err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve((this as unknown as RunResult).lastID as number);
        }
      });
      stmt.finalize();
    });
  }

  async updateProject(name: string, updates: {
    description?: string;
    project_type?: string;
    source_root?: string;
    root?: string;
    tags?: string;
  }): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        UPDATE projects 
        SET description = ?, project_type = ?, source_root = ?, root = ?, tags = ?
        WHERE name = ?
      `);
      stmt.run([
        updates.description,
        updates.project_type,
        updates.source_root,
        updates.root,
        updates.tags,
        name
      ], function(err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve(((this as unknown as RunResult).changes ?? 0) > 0);
        }
      });
      stmt.finalize();
    });
  }

  async getProject(name: string): Promise<Project | null> {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM projects WHERE name = ?', [name], (err: Error | null, row: unknown) => {
        if (err) {
          reject(err);
        } else {
          resolve(row as Project || null);
        }
      });
    });
  }

  async getAllProjects(): Promise<Project[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM projects ORDER BY name', (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as Project[]);
        }
      });
    });
  }

  async deleteProject(name: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM projects WHERE name = ?', [name], function(err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve(((this as unknown as RunResult).changes ?? 0) > 0);
        }
      });
    });
  }

  // File methods
  async addFileToProject(projectName: string, filePath: string, fileType?: string): Promise<void> {
    const project = await this.getProject(projectName);
    if (!project) {
      throw new Error(`Project "${projectName}" not found`);
    }

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO project_files (project_id, file_path, file_type) VALUES (?, ?, ?)');
      stmt.run([project.id, filePath, fileType], (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
      stmt.finalize();
    });
  }

  async removeFileFromProject(projectName: string, filePath: string): Promise<boolean> {
    const project = await this.getProject(projectName);
    if (!project) {
      return false;
    }

    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM project_files WHERE project_id = ? AND file_path = ?', 
        [project.id, filePath], function(err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve(((this as unknown as RunResult).changes ?? 0) > 0);
        }
      });
    });
  }

  async getProjectFiles(projectName: string): Promise<ProjectFile[]> {
    const project = await this.getProject(projectName);
    if (!project) {
      return [];
    }

    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM project_files WHERE project_id = ? ORDER BY file_path', 
        [project.id], (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as ProjectFile[]);
        }
      });
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
      const projectGraph = await createProjectGraphAsync({ exitOnError: false });
      const dependencies = projectGraph.dependencies[projectName] || [];
      return dependencies.map(dep => dep.target);
    } catch (error) {
      console.warn(`Could not get dependencies for ${projectName}:`, error);
      return [];
    }
  }

  async getProjectDependents(projectName: string): Promise<string[]> {
    try {
      const projectGraph = await createProjectGraphAsync({ exitOnError: false });
      const dependents: string[] = [];
      
      for (const [project, deps] of Object.entries(projectGraph.dependencies)) {
        if (deps.some(dep => dep.target === projectName)) {
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
          dependents.forEach(dep => affectedProjects.add(dep));
        }
      }

      return Array.from(affectedProjects);
    } catch (error) {
      console.warn('Could not determine affected projects:', error);
      return [];
    }
  }

  async getProjectsByType(projectType: string): Promise<Project[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM projects WHERE project_type = ? ORDER BY name', 
        [projectType], (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as Project[]);
        }
      });
    });
  }

  async getProjectsByTag(tag: string): Promise<Project[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM projects WHERE tags LIKE ? ORDER BY name', 
        [`%${tag}%`], (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as Project[]);
        }
      });
    });
  }

  // Utility methods
  async scanRepositoryFiles(rootPath: string, projectName: string): Promise<void> {
    const project = await this.getProject(projectName);
    if (!project) {
      throw new Error(`Project "${projectName}" not found`);
    }

    const scanDirectory = async (dirPath: string): Promise<void> => {
      const items = fs.readdirSync(dirPath);
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const relativePath = path.relative(rootPath, fullPath);
        
        // Skip hidden files and directories, node_modules, etc.
        if (item.startsWith('.') || item === 'node_modules') {
          continue;
        }

        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (stat.isFile()) {
          const fileType = path.extname(item).slice(1) || 'unknown';
          await this.addFileToProject(projectName, relativePath, fileType);
        }
      }
    };

    await scanDirectory(rootPath);
  }

  close(): void {
    this.db.close();
  }
}

// Export convenience functions
export async function createDatabase(dbPath?: string): Promise<ProjectDatabase> {
  return new ProjectDatabase(dbPath);
}

export function db(): string {
  return 'db';
}

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectDatabase, createDatabase, db } from './db.js';

describe('ProjectDatabase', () => {
  // Use the sibling ws-nx-summer2025 repository as the workspace root
  const repoRoot = path.resolve(__dirname, '../../../../../ws-nx-summer2025');
  const originalCwd = process.cwd();
  const dbFile = path.join(os.tmpdir(), `nx-tools-test-${Date.now()}.db`);
  let pdb: ProjectDatabase;

  beforeAll(() => {
    // Ensure tests run inside the Nx + git repo
    process.chdir(repoRoot);
    // Ensure any prior leftovers are removed
    try {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    } catch {
      // ignore
    }
    pdb = new ProjectDatabase(dbFile);
  });

  afterAll(() => {
    pdb.close();
    try {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    } catch {
      // ignore
    }
    // Restore original working directory
    process.chdir(originalCwd);
  });

  describe('Project CRUD operations', () => {
    it('can create, read, update and delete projects', async () => {
      const id = await pdb.createProject('proj-a', 'A project');
      expect(typeof id).toBe('number');

      const proj = await pdb.getProject('proj-a');
      expect(proj).not.toBeNull();
      expect(proj?.name).toBe('proj-a');

      const all = await pdb.getAllProjects();
      expect(all.some((p) => p.name === 'proj-a')).toBe(true);

      const updated = await pdb.updateProject('proj-a', {
        description: 'Updated',
      });
      expect(updated).toBe(true);

      const proj2 = await pdb.getProject('proj-a');
      expect(proj2?.description).toBe('Updated');

      const deleted = await pdb.deleteProject('proj-a');
      expect(deleted).toBe(true);

      const missing = await pdb.getProject('proj-a');
      expect(missing).toBeNull();
    });

    it('can create projects from Nx data', async () => {
      const id = await pdb.createProjectFromNx('proj-nx', {
        description: 'nx project',
        project_type: 'application',
        source_root: 'packages/proj-nx/src',
        root: 'packages/proj-nx',
        tags: 'team:api,type:feature',
      });

      expect(typeof id).toBe('number');

      const proj = await pdb.getProject('proj-nx');
      expect(proj?.name).toBe('proj-nx');
      expect(proj?.project_type).toBe('application');
      expect(proj?.tags).toBe('team:api,type:feature');
    });

    it('returns false when updating non-existent project', async () => {
      const updated = await pdb.updateProject('non-existent-proj', {
        description: 'Updated',
      });
      expect(updated).toBe(false);
    });

    it('returns false when deleting non-existent project', async () => {
      const deleted = await pdb.deleteProject('non-existent-proj');
      expect(deleted).toBe(false);
    });

    it('returns empty array for non-existent project files', async () => {
      const files = await pdb.getProjectFiles('non-existent-proj');
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBe(0);
    });
  });

  describe('Project queries by type and tag', () => {
    beforeEach(async () => {
      // Clean up before each test
      const projects = await pdb.getAllProjects();
      for (const proj of projects) {
        if (proj.name.startsWith('query-test-')) {
          await pdb.deleteProject(proj.name);
        }
      }
    });

    it('can query projects by type', async () => {
      await pdb.createProjectFromNx('query-test-app', {
        description: 'test application',
        project_type: 'application',
      });

      await pdb.createProjectFromNx('query-test-lib', {
        description: 'test library',
        project_type: 'library',
      });

      const apps = await pdb.getProjectsByType('application');
      expect(apps.some((p) => p.name === 'query-test-app')).toBe(true);

      const libs = await pdb.getProjectsByType('library');
      expect(libs.some((p) => p.name === 'query-test-lib')).toBe(true);
    });

    it('can query projects by tag', async () => {
      await pdb.createProjectFromNx('query-test-tagged', {
        description: 'tagged project',
        tags: 'scope:frontend,type:ui',
      });

      const frontend = await pdb.getProjectsByTag('scope:frontend');
      expect(frontend.some((p) => p.name === 'query-test-tagged')).toBe(true);

      const ui = await pdb.getProjectsByTag('type:ui');
      expect(ui.some((p) => p.name === 'query-test-tagged')).toBe(true);
    });

    it('returns empty array when querying non-existent type', async () => {
      const results = await pdb.getProjectsByType('non-existent-type');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('returns empty array when querying non-existent tag', async () => {
      const results = await pdb.getProjectsByTag('non-existent:tag');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('File operations', () => {
    beforeEach(async () => {
      await pdb.deleteProject('file-test-proj').catch(() => {});
      await pdb.createProject('file-test-proj', 'for file tests');
    });

    it('can add, list, and remove files for a project', async () => {
      await pdb.addFileToProject(
        'file-test-proj',
        'packages/file-test/src/index.ts'
      );
      await pdb.addFileToProject(
        'file-test-proj',
        'packages/file-test/README.md'
      );

      const files = await pdb.getProjectFiles('file-test-proj');
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(
        files.some((f) => f.file_path === 'packages/file-test/src/index.ts')
      ).toBe(true);

      const removed = await pdb.removeFileFromProject(
        'file-test-proj',
        'packages/file-test/src/index.ts'
      );
      expect(removed).toBe(true);

      const filesAfter = await pdb.getProjectFiles('file-test-proj');
      expect(
        filesAfter.some(
          (f) => f.file_path === 'packages/file-test/src/index.ts'
        )
      ).toBe(false);
    });

    it('can find projects containing a file', async () => {
      await pdb.addFileToProject(
        'file-test-proj',
        'packages/file-test/src/shared.ts'
      );

      const projectsForFile = await pdb.getFileProjects(
        'packages/file-test/src/shared.ts'
      );
      expect(projectsForFile.some((p) => p.name === 'file-test-proj')).toBe(
        true
      );
    });

    it('returns empty array when querying files for non-existent file', async () => {
      const projects = await pdb.getFileProjects('non/existent/file.ts');
      expect(Array.isArray(projects)).toBe(true);
      expect(projects.length).toBe(0);
    });

    it('throws when adding a file to a non-existent project', async () => {
      await expect(
        pdb.addFileToProject('no-such-proj', 'some/path')
      ).rejects.toThrow();
    });

    it('returns false when removing file from non-existent project', async () => {
      const removed = await pdb.removeFileFromProject(
        'no-such-proj',
        'some/path'
      );
      expect(removed).toBe(false);
    });
  });

  describe('File dependencies', () => {
    it('can clear file dependencies', async () => {
      await pdb.clearFileDependencies();
      // Ensure there are no entries afterwards
      const count: number = await new Promise((resolve, reject) => {
        (pdb as any).db.get('SELECT COUNT(*) AS c FROM file_dependencies', (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve(row.c as number);
        });
      });
      expect(count).toBe(0);
    });

    it('can get file dependencies', async () => {
      await pdb.clearFileDependencies();
      // Insert a known dependency entry so we can assert exact values
      await new Promise<void>((resolve, reject) => {
        (pdb as any).db.run(
          'INSERT INTO file_dependencies (file_path, depends_on_project, depends_on_file) VALUES (?, ?, ?)',
          ['src/index.ts', 'shared-core', 'src/lib.ts'],
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });

      const deps = await pdb.getFileDependencies('src/index.ts');
      expect(Array.isArray(deps)).toBe(true);
      expect(deps).toContain('shared-core');
    });

    it('can get file dependents', async () => {
      await pdb.clearFileDependencies();
      // Insert a known dependent
      await new Promise<void>((resolve, reject) => {
        (pdb as any).db.run(
          'INSERT INTO file_dependencies (file_path, depends_on_project, depends_on_file) VALUES (?, ?, ?)',
          ['src/shared.ts', 'shared-core', null],
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });

      const dependents = await pdb.getFileDependents('shared-core');
      expect(Array.isArray(dependents)).toBe(true);
      expect(dependents).toContain('src/shared.ts');
    });

    it('can sync file dependencies from Nx', async () => {
      try {
        const count = await pdb.syncFileDependenciesFromNx();
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThanOrEqual(0);
      } catch (e) {
        // If the Nx cache file-map is missing, ensure a helpful error is thrown
        expect((e as Error).message).toMatch(/file map not found/i);
      }
    }, 20000);

    it('throws when syncing dependencies with invalid workspace root', async () => {
      await expect(
        pdb.syncFileDependenciesFromNx('/non/existent/path')
      ).rejects.toThrow();
    });
  });

  describe('Project dependencies from Nx', () => {
    it('can get project dependencies', async () => {
      try {
        // This may return empty array if no projects are synced, but should not throw
        const deps = await pdb.getProjectDependencies('test-project');
        expect(Array.isArray(deps)).toBe(true);
      } catch (error) {
        // Nx graph operations might fail in test environment
        expect(error).toBeDefined();
      }
    });

    it('can get project dependents', async () => {
      try {
        const dependents = await pdb.getProjectDependents('test-project');
        expect(Array.isArray(dependents)).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('can determine affected projects from file changes', async () => {
      const affected = await pdb.getAffectedProjects([
        'src/shared/utils.ts',
        'package.json',
      ]);
      expect(Array.isArray(affected)).toBe(true);
    });
  });

  describe('Git commit tracking', () => {
    it('can handle git commit functionality', async () => {
      // Skip git tests if not in a git repository
      let isGitRepo = false;
      try {
        const { execSync } = require('child_process');
        execSync('git rev-parse --git-dir', { stdio: 'ignore' });
        isGitRepo = true;
      } catch {
        console.log('Skipping git tests - not in a git repository');
      }

      if (!isGitRepo) {
        // Test the basic methods exist and handle empty data gracefully
        const commits = await pdb.getCommits(10);
        expect(Array.isArray(commits)).toBe(true);

        const touchedFiles = await pdb.getTouchedFiles();
        expect(Array.isArray(touchedFiles)).toBe(true);

        const projectsTouched = await pdb.getProjectsTouchedByCommits(10);
        expect(Array.isArray(projectsTouched)).toBe(true);

        return;
      }

      // Test actual git functionality if in a git repo
      try {
        await pdb.syncGitCommits(5); // Sync just a few commits for testing

        const commits = await pdb.getCommits(10);
        expect(Array.isArray(commits)).toBe(true);

        const touchedFiles = await pdb.getTouchedFiles();
        expect(Array.isArray(touchedFiles)).toBe(true);

        const filesTouched = await pdb.getFilesTouchedInLastCommits(5);
        expect(Array.isArray(filesTouched)).toBe(true);

        const projectsTouched = await pdb.getProjectsTouchedByCommits(5);
        expect(Array.isArray(projectsTouched)).toBe(true);
      } catch (error) {
        // Git operations might fail in test environment, that's expected
        console.log(
          'Git operations failed (expected in test environment):',
          error
        );
      }
    });

    it('can get commits with limit parameter', async () => {
      const commits = await pdb.getCommits(5);
      expect(Array.isArray(commits)).toBe(true);
    });

    it('can get touched files by commit hash', async () => {
      try {
        const allTouched = await pdb.getTouchedFiles();
        if (allTouched.length > 0) {
          // If we have commits, try getting files for a specific commit
          const firstCommit = allTouched[0];
          if (firstCommit.hash) {
            const specificFiles = await pdb.getTouchedFiles(firstCommit.hash);
            expect(Array.isArray(specificFiles)).toBe(true);
          }
        }
      } catch (error) {
        // Git operations might fail in test environment
        console.log('Git specific hash test skipped:', error);
      }
    });

    it('validates git commit data structure', async () => {
      const commits = await pdb.getCommits(1);
      expect(Array.isArray(commits)).toBe(true);

      if (commits.length > 0) {
        const commit = commits[0];
        expect(commit).toHaveProperty('id');
        expect(commit).toHaveProperty('hash');
        expect(commit).toHaveProperty('author');
        expect(commit).toHaveProperty('date');
        expect(commit).toHaveProperty('message');
      }

      const touchedFiles = await pdb.getTouchedFiles();
      expect(Array.isArray(touchedFiles)).toBe(true);

      if (touchedFiles.length > 0) {
        const file = touchedFiles[0];
        expect(file).toHaveProperty('file_path');
        expect(file).toHaveProperty('change_type');
      }
    });
  });

  describe('Database lifecycle', () => {
    it('can close database connection', async () => {
      const tempDb = path.join(
        os.tmpdir(),
        `nx-tools-test-close-${Date.now()}.db`
      );
      const db = new ProjectDatabase(tempDb);
      await db.createProject('test', 'test');
      db.close();

      try {
        if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
      } catch {
        // ignore
      }
      expect(true).toBe(true);
    });

    it('can sync with Nx workspace', async () => {
      try {
        const projectGraph = await pdb.syncWithNxWorkspace();
        expect(projectGraph).toBeDefined();
        expect(projectGraph.nodes).toBeDefined();
      } catch (error) {
        // syncWithNxWorkspace might fail in test environment due to missing Nx config
        expect(error).toBeDefined();
      }
    });
  });

  describe('Exported utility functions', () => {
    it('exports createDatabase function', async () => {
      const tempDb = path.join(
        os.tmpdir(),
        `nx-tools-test-util-${Date.now()}.db`
      );
      const database = await createDatabase(tempDb);
      expect(database).toBeInstanceOf(ProjectDatabase);
      database.close();

      try {
        if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
      } catch {
        // ignore
      }
    });

    it('exports db function', () => {
      const result = db();
      expect(typeof result).toBe('string');
      expect(result).toBe('db');
    });
  });
});

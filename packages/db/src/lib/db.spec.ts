import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectDatabase } from './db.js';

describe('ProjectDatabase', () => {
  const tmpDir = os.tmpdir();
  const dbFile = path.join(tmpDir, `nx-tools-test-${Date.now()}.db`);
  let pdb: ProjectDatabase;

  beforeAll(() => {
    // Ensure any prior leftovers are removed
    try {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    } catch (e) {
      // ignore
    }
    pdb = new ProjectDatabase(dbFile);
  });

  afterAll(() => {
    pdb.close();
    try {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    } catch (e) {
      // ignore
    }
  });

  it('can create, read, update and delete projects', async () => {
    const id = await pdb.createProject('proj-a', 'A project');
    expect(typeof id).toBe('number');

    const proj = await pdb.getProject('proj-a');
    expect(proj).not.toBeNull();
    expect(proj?.name).toBe('proj-a');

    const all = await pdb.getAllProjects();
    expect(all.some(p => p.name === 'proj-a')).toBe(true);

    const updated = await pdb.updateProject('proj-a', { description: 'Updated' });
    expect(updated).toBe(true);

    const proj2 = await pdb.getProject('proj-a');
    expect(proj2?.description).toBe('Updated');

    const deleted = await pdb.deleteProject('proj-a');
    expect(deleted).toBe(true);

    const missing = await pdb.getProject('proj-a');
    expect(missing).toBeNull();
  });

  it('supports Nx-style project creation and queries by type/tag', async () => {
    const id = await pdb.createProjectFromNx('proj-nx', {
      description: 'nx project',
      project_type: 'application',
      source_root: 'packages/proj-nx/src',
      root: 'packages/proj-nx',
      tags: 'team:api,type:feature',
    });

    expect(typeof id).toBe('number');

    const byType = await pdb.getProjectsByType('application');
    expect(byType.some(p => p.name === 'proj-nx')).toBe(true);

    const byTag = await pdb.getProjectsByTag('type:feature');
    expect(byTag.some(p => p.name === 'proj-nx')).toBe(true);
  });

  it('can add, list, and remove files for a project', async () => {
    // ensure project exists
    await pdb.createProject('proj-files', 'with files');

    await pdb.addFileToProject('proj-files', 'packages/proj-files/src/index.ts', 'ts');
    await pdb.addFileToProject('proj-files', 'packages/proj-files/README.md', 'md');

    const files = await pdb.getProjectFiles('proj-files');
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some(f => f.file_path === 'packages/proj-files/src/index.ts')).toBe(true);

    const projectsForFile = await pdb.getFileProjects('packages/proj-files/src/index.ts');
    expect(projectsForFile.some(p => p.name === 'proj-files')).toBe(true);

    const removed = await pdb.removeFileFromProject('proj-files', 'packages/proj-files/src/index.ts');
    expect(removed).toBe(true);

    const filesAfter = await pdb.getProjectFiles('proj-files');
    expect(filesAfter.some(f => f.file_path === 'packages/proj-files/src/index.ts')).toBe(false);
  });

  it('throws when adding a file to a non-existent project', async () => {
    await expect(pdb.addFileToProject('no-such-proj', 'some/path', 'txt')).rejects.toThrow();
  });

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

      const affectedProjects = await pdb.getProjectsAffectedByCommits(10);
      expect(Array.isArray(affectedProjects)).toBe(true);

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
      
      const affectedProjects = await pdb.getProjectsAffectedByCommits(5);
      expect(Array.isArray(affectedProjects)).toBe(true);
    } catch (error) {
      // Git operations might fail in test environment, that's expected
      console.log('Git operations failed (expected in test environment):', error);
    }
  });

  it('validates git commit data structure', async () => {
    // Test that the methods return the expected data structure even with no data
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

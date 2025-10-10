import { execFile } from 'child_process';
import * as util from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = util.promisify(execFile);
const node = process.execPath;
// Execute built CLI to avoid TS runtime loaders
const cliPath = path.resolve(__dirname, '../dist/cli.js');

describe('db CLI', () => {
  // Use the sibling ws-nx-summer2025 repository as the workspace root
  const repoRoot = path.resolve(__dirname, '../../../../ws-nx-summer2025');
  const originalCwd = process.cwd();
  let tmpDir: string;
  let dbFile: string;

  beforeAll(() => {
    // Ensure commands run inside the Nx + git repo
    process.chdir(repoRoot);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-db-cli-'));
    dbFile = path.join(repoRoot, 'nx-projects.db');
  });

  afterAll(() => {
    try {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    } catch {
      // ignore
    }

    try {
      fs.rmdirSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
    // Restore original working directory
    process.chdir(originalCwd);
  });

  it('creates, lists, adds files to, finds and deletes a project via the CLI', async () => {
    // Create a project
    const create = await execFileAsync(
      node,
      [cliPath, 'create-project', 'cli-proj', 'CLI project'],
      { cwd: repoRoot }
    );
    expect(create.stdout).toMatch(/Created project "cli-proj"/);
    expect(fs.existsSync(dbFile)).toBe(true);

    // List projects
    const list = await execFileAsync(node, [cliPath, 'list-projects'], {
      cwd: repoRoot,
    });
    expect(list.stdout).toMatch(/cli-proj/);

    // Add a file to the project
    const add = await execFileAsync(
      node,
      [cliPath, 'add-file', 'cli-proj', 'src/main.ts', 'ts'],
      { cwd: repoRoot }
    );
    expect(add.stdout).toMatch(/Added "src\/main.ts" to project "cli-proj"/);

    // List files
    const listFiles = await execFileAsync(
      node,
      [cliPath, 'list-files', 'cli-proj'],
      { cwd: repoRoot }
    );
    expect(listFiles.stdout).toMatch(/src\/main.ts/);

    // Find projects containing the file
    const find = await execFileAsync(
      node,
      [cliPath, 'find-projects', 'src/main.ts'],
      { cwd: repoRoot }
    );
    expect(find.stdout).toMatch(/cli-proj/);

    // Remove file
    const remove = await execFileAsync(
      node,
      [cliPath, 'remove-file', 'cli-proj', 'src/main.ts'],
      { cwd: repoRoot }
    );
    expect(remove.stdout).toMatch(
      /Removed "src\/main.ts" from project "cli-proj"/
    );

    // Delete project
    const del = await execFileAsync(
      node,
      [cliPath, 'delete-project', 'cli-proj'],
      { cwd: repoRoot }
    );
    expect(del.stdout).toMatch(/Deleted project "cli-proj"/);

    // Final list should not include project
    const finalList = await execFileAsync(node, [cliPath, 'list-projects'], {
      cwd: repoRoot,
    });
    expect(finalList.stdout).toMatch(/No projects found/);
  }, 20000);

  it('handles by-type and by-tag queries', async () => {
    // We'll use the database directly to set up test data since CLI doesn't have direct Nx project creation
    const { ProjectDatabase } = require('./lib/db');
    const db = new ProjectDatabase(dbFile);

    try {
      // Create projects with types and tags
      await db.createProjectFromNx('app1', {
        description: 'Application 1',
        project_type: 'application',
        tags: 'scope:frontend,type:app',
      });

      await db.createProjectFromNx('lib1', {
        description: 'Library 1',
        project_type: 'library',
        tags: 'scope:shared,type:util',
      });

      await db.createProjectFromNx('app2', {
        description: 'Application 2',
        project_type: 'application',
        tags: 'scope:backend,type:app',
      });
    } finally {
      db.close();
    }

    // Test by-type query
    const byType = await execFileAsync(
      node,
      [cliPath, 'by-type', 'application'],
      { cwd: repoRoot }
    );
    expect(byType.stdout).toMatch(/app1/);
    expect(byType.stdout).toMatch(/app2/);
    expect(byType.stdout).not.toMatch(/lib1/);

    // Test by-tag query
    const byTag = await execFileAsync(
      node,
      [cliPath, 'by-tag', 'scope:shared'],
      { cwd: repoRoot }
    );
    expect(byTag.stdout).toMatch(/lib1/);
    expect(byTag.stdout).not.toMatch(/app1/);
  }, 20000);

  it('handles affected files queries', async () => {
    // Set up test data
    const { ProjectDatabase } = require('./lib/db');
    const db = new ProjectDatabase(dbFile);

    try {
      // Create a project and add files
      await db.createProject('affected-test', 'Test project for affected');
      await db.addFileToProject('affected-test', 'src/utils.ts', 'ts');
      await db.addFileToProject('affected-test', 'package.json', 'json');
    } finally {
      db.close();
    }

    // Test affected command
    const affected = await execFileAsync(
      node,
      [cliPath, 'affected', 'src/utils.ts'],
      { cwd: repoRoot }
    );
    expect(affected.stdout).toMatch(/affected-test/);
  }, 20000);

  it('handles error cases properly', async () => {
    // Test missing project name
    try {
      await execFileAsync(node, [cliPath, 'create-project'], { cwd: repoRoot });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(
        /Project name is required/
      );
    }

    // Test unknown command
    try {
      await execFileAsync(node, [cliPath, 'unknown-command'], {
        cwd: repoRoot,
      });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(/Unknown command/);
    }

    // Test adding file to non-existent project
    try {
      await execFileAsync(
        node,
        [cliPath, 'add-file', 'nonexistent', 'file.ts'],
        { cwd: repoRoot }
      );
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(/not found/);
    }
  }, 20000);

  it('shows help when no command provided', async () => {
    try {
      await execFileAsync(node, [cliPath], { cwd: repoRoot });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(/Usage:/);
    }
  }, 20000);

  it('handles git commands properly', async () => {
    // Test sync-git with default count
    const syncGit = await execFileAsync(node, [cliPath, 'sync-git'], {
      cwd: repoRoot,
    });
    expect(syncGit.stdout).toMatch(/Syncing last 100 git commits/);
    expect(syncGit.stdout).toMatch(/Git sync completed successfully/);

    // Test list-commits
    const listCommits = await execFileAsync(
      node,
      [cliPath, 'list-commits', '10'],
      { cwd: repoRoot }
    );
    expect(listCommits.stdout).toMatch(/Recent commits|No commits found/);

    // Test touched-files
    const touchedFiles = await execFileAsync(node, [cliPath, 'touched-files'], {
      cwd: repoRoot,
    });
    expect(touchedFiles.stdout).toMatch(
      /Recently touched files|No touched files found/
    );

    // Test git-affected
    const gitAffected = await execFileAsync(
      node,
      [cliPath, 'git-affected', '10'],
      { cwd: repoRoot }
    );
    expect(gitAffected.stdout).toMatch(
      /Projects affected|No projects affected/
    );
  }, 30000);

  it('syncs and queries file dependencies via CLI', async () => {
    // Sync file dependencies
    const sync = await execFileAsync(node, [cliPath, 'sync-file-deps'], { cwd: repoRoot });
    expect(sync.stdout).toMatch(/Syncing file dependencies from Nx file map/);

    // Query deps for a common file (may be empty depending on workspace)
    const depsOut = await execFileAsync(node, [cliPath, 'file-deps', 'package.json'], { cwd: repoRoot });
    expect(depsOut.stdout).toMatch(/Dependencies of|No dependencies recorded/);

    // Query dependents for a common file
    const dependentsOut = await execFileAsync(node, [cliPath, 'file-dependents', 'package.json'], { cwd: repoRoot });
    expect(dependentsOut.stdout).toMatch(/Files depending on|No dependents recorded/);
  }, 30000);

  it('validates git command parameters', async () => {
    // Test invalid commit count for sync-git
    try {
      await execFileAsync(node, [cliPath, 'sync-git', 'invalid'], {
        cwd: repoRoot,
      });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(
        /Commit count must be a positive number/
      );
    }

    // Test invalid limit for list-commits
    try {
      await execFileAsync(node, [cliPath, 'list-commits', '-1'], {
        cwd: repoRoot,
      });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(
        /Limit must be a positive number/
      );
    }

    // Test invalid commit count for git-affected
    try {
      await execFileAsync(node, [cliPath, 'git-affected', '0'], {
        cwd: repoRoot,
      });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(
        /Commit count must be a positive number/
      );
    }
  }, 20000);
});

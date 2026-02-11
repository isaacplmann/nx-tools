import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { runCLI } from './cli';

// Mock Nx devkit to avoid creating background native handles in the test process
jest.mock('@nx/devkit', () => ({
  createProjectGraphAsync: async () => ({ nodes: {}, dependencies: {} }),
  createProjectFileMapUsingProjectGraph: async () => ({}),
  workspaceRoot: process.cwd(),
}));

describe('db CLI', () => {
  // Use current workspace root (avoid depending on external sibling repos)
  const repoRoot = process.cwd();
  let tmpDir: string;
  let dbFile: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-db-cli-'));
    dbFile = path.join(repoRoot, 'nx-projects.db');
  });

  // Helper to call the CLI in-process and capture its output
  const run = async (args: string[]) => {
    let out = '';
    let err = '';
    const logger = {
      log: (...a: any[]) => (out += a.join(' ') + '\n'),
      table: (...a: any[]) => (out += a.map(r => JSON.stringify(r, null, 2)).join('\n') + '\n'),
      error: (...a: any[]) => (err += a.join(' ') + '\n'),
    };
    const code = await runCLI(args, { dbPath: dbFile, logger });
    return { stdout: out, stderr: err, code };
  };

  afterAll(() => {
    try {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    } catch {
      // ignore
    }

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates, lists, adds files to, finds and deletes a project via the CLI', async () => {
    // Create a project
    const create = await run(['create-project', 'cli-proj', 'CLI project']);
    expect(create.stdout).toMatch(/Created project "cli-proj"/);
    expect(fs.existsSync(dbFile)).toBe(true);

    // List projects
    const list = await run(['list-projects']);
    expect(list.stdout).toMatch(/cli-proj/);

    // Add a file to the project
    const add = await run(['add-file', 'cli-proj', 'src/main.ts', 'ts']);
    expect(add.stdout).toMatch(/Added "src\/main.ts" to project "cli-proj"/);

    // List files
    const listFiles = await run(['list-files', 'cli-proj']);
    expect(listFiles.stdout).toMatch(/src\/main.ts/);

    // Find projects containing the file
    const find = await run(['find-projects', 'src/main.ts']);
    expect(find.stdout).toMatch(/cli-proj/);

    // Remove file
    const remove = await run(['remove-file', 'cli-proj', 'src/main.ts']);
    expect(remove.stdout).toMatch(
      /Removed "src\/main.ts" from project "cli-proj"/
    );

    // Delete project
    const del = await run(['delete-project', 'cli-proj']);
    expect(del.stdout).toMatch(/Deleted project "cli-proj"/);

    // Final list should not include project
    const finalList = await run(['list-projects']);
    expect(finalList.stdout).toMatch(/No projects found/);
  });

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
      await db.close();
    }

    // Test by-type query
    const byType = await run(['by-type', 'application']);
    expect(byType.stdout).toMatch(/app1/);
    expect(byType.stdout).toMatch(/app2/);
    expect(byType.stdout).not.toMatch(/lib1/);

    // Test by-tag query
    const byTag = await run(['by-tag', 'scope:shared']);
    expect(byTag.stdout).toMatch(/lib1/);
    expect(byTag.stdout).not.toMatch(/app1/);
  });

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
      await db.close();
    }

    // Test affected command
    const affected = await run(['affected', 'src/utils.ts']);
    expect(affected.stdout).toMatch(/affected-test/);
  });

  it('handles error cases properly', async () => {
    // Test missing project name
    // Test missing project name
    const missing = await run(['create-project']);
    expect(missing.code).toBe(1);
    expect(missing.stderr || missing.stdout).toMatch(/Project name is required/);

    // Test unknown command
    const unknown = await run(['unknown-command']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr || unknown.stdout).toMatch(/Unknown command/);

    // Test adding file to non-existent project
    const addNon = await run(['add-file', 'nonexistent', 'file.ts']);
    expect(addNon.code).toBe(1);
    expect(addNon.stderr || addNon.stdout).toMatch(/not found/);
  });

  it('shows help when no command provided', async () => {
    const help = await run([]);
    expect(help.stdout).toMatch(/Usage:/);
  });

  it('handles git commands properly', async () => {
    // Test sync-git with default count
    const syncGit = await run(['sync-git']);
    expect(syncGit.stdout).toMatch(/Syncing last 100 git commits/);
    expect(syncGit.stdout).toMatch(/Git sync completed successfully/);

    // Test list-commits
    const listCommits = await run(['list-commits', '10']);
    expect(listCommits.stdout).toMatch(/Recent commits|No commits found/);

    // Test touched-files
    const touchedFiles = await run(['touched-files']);
    expect(touchedFiles.stdout).toMatch(/Recently touched files|No touched files found/);

    // Test git-affected
    const gitAffected = await run(['git-affected', '10']);
    expect(gitAffected.stdout).toMatch(/Projects affected|No projects affected/);
  }, 30000);

  it('syncs and queries file dependencies via CLI', async () => {
    // Sync file dependencies - may fail if Nx file map is not present in the test workspace
    const sync = await run(['sync-file-deps']);
    if (sync.code === 0) {
      expect(sync.stdout).toMatch(/Syncing file dependencies from Nx file map/);
    } else {
      expect((sync.stderr || sync.stdout || '').toLowerCase()).toMatch(/file map not found|file-map.json/i);
    }

    // Query deps for a common file (may be empty depending on workspace)
    const depsOut = await run(['file-deps', 'package.json']);
    expect(depsOut.stdout).toMatch(/Dependencies of|No dependencies recorded/);

    // Query dependents for a common file
    const dependentsOut = await run(['file-dependents', 'package.json']);
    expect(dependentsOut.stdout).toMatch(/Files depending on|No dependents recorded/);
  }, 30000);

  it('validates git command parameters', async () => {
    // Test invalid commit count for sync-git
    const invalidSync = await run(['sync-git', 'invalid']);
    expect(invalidSync.code).toBe(1);
    expect(invalidSync.stderr || invalidSync.stdout).toMatch(/Commit count must be a positive number/);

    // Test invalid limit for list-commits
    const invalidLimit = await run(['list-commits', '-1']);
    expect(invalidLimit.code).toBe(1);
    expect(invalidLimit.stderr || invalidLimit.stdout).toMatch(/Limit must be a positive number/);

    // Test invalid commit count for git-affected
    const invalidAffected = await run(['git-affected', '0']);
    expect(invalidAffected.code).toBe(1);
    expect(invalidAffected.stderr || invalidAffected.stdout).toMatch(/Commit count must be a positive number/);
  });
});

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
  let tmpDir: string;
  let dbFile: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-db-cli-'));
    dbFile = path.join(tmpDir, 'nx-projects.db');
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
  });

  it('creates, lists, adds files to, finds and deletes a project via the CLI', async () => {
    // Create a project
    const create = await execFileAsync(node, [cliPath, 'create-project', 'cli-proj', 'CLI project'], { cwd: tmpDir });
    expect(create.stdout).toMatch(/Created project "cli-proj"/);
    expect(fs.existsSync(dbFile)).toBe(true);

    // List projects
    const list = await execFileAsync(node, [cliPath, 'list-projects'], { cwd: tmpDir });
    expect(list.stdout).toMatch(/cli-proj/);

    // Add a file to the project
    const add = await execFileAsync(node, [cliPath, 'add-file', 'cli-proj', 'src/main.ts', 'ts'], { cwd: tmpDir });
    expect(add.stdout).toMatch(/Added "src\/main.ts" to project "cli-proj"/);

    // List files
    const listFiles = await execFileAsync(node, [cliPath, 'list-files', 'cli-proj'], { cwd: tmpDir });
    expect(listFiles.stdout).toMatch(/src\/main.ts/);

    // Find projects containing the file
    const find = await execFileAsync(node, [cliPath, 'find-projects', 'src/main.ts'], { cwd: tmpDir });
    expect(find.stdout).toMatch(/cli-proj/);

    // Remove file
    const remove = await execFileAsync(node, [cliPath, 'remove-file', 'cli-proj', 'src/main.ts'], { cwd: tmpDir });
    expect(remove.stdout).toMatch(/Removed "src\/main.ts" from project "cli-proj"/);

    // Delete project
    const del = await execFileAsync(node, [cliPath, 'delete-project', 'cli-proj'], { cwd: tmpDir });
    expect(del.stdout).toMatch(/Deleted project "cli-proj"/);

    // Final list should not include project
    const finalList = await execFileAsync(node, [cliPath, 'list-projects'], { cwd: tmpDir });
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
        tags: 'scope:frontend,type:app'
      });
      
      await db.createProjectFromNx('lib1', {
        description: 'Library 1', 
        project_type: 'library',
        tags: 'scope:shared,type:util'
      });
      
      await db.createProjectFromNx('app2', {
        description: 'Application 2',
        project_type: 'application', 
        tags: 'scope:backend,type:app'
      });
    } finally {
      db.close();
    }

    // Test by-type query
    const byType = await execFileAsync(node, [cliPath, 'by-type', 'application'], { cwd: tmpDir });
    expect(byType.stdout).toMatch(/app1/);
    expect(byType.stdout).toMatch(/app2/);
    expect(byType.stdout).not.toMatch(/lib1/);

    // Test by-tag query
    const byTag = await execFileAsync(node, [cliPath, 'by-tag', 'scope:shared'], { cwd: tmpDir });
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
    const affected = await execFileAsync(node, [cliPath, 'affected', 'src/utils.ts'], { cwd: tmpDir });
    expect(affected.stdout).toMatch(/affected-test/);
  }, 20000);

  it('handles error cases properly', async () => {
    // Test missing project name
    try {
      await execFileAsync(node, [cliPath, 'create-project'], { cwd: tmpDir });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(/Project name is required/);
    }

    // Test unknown command
    try {
      await execFileAsync(node, [cliPath, 'unknown-command'], { cwd: tmpDir });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(/Unknown command/);
    }

    // Test adding file to non-existent project
    try {
      await execFileAsync(node, [cliPath, 'add-file', 'nonexistent', 'file.ts'], { cwd: tmpDir });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(/not found/);
    }
  }, 20000);

  it('shows help when no command provided', async () => {
    try {
      await execFileAsync(node, [cliPath], { cwd: tmpDir });
      fail('Should have thrown an error');
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      expect(execError.stderr || execError.stdout).toMatch(/Usage:/);
    }
  }, 20000);
});

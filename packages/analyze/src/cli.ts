#!/usr/bin/env node

import { ProjectDatabase } from './lib/db.js';
import * as process from 'process';
import * as path from 'path';
import generateArchitectureDiagram from './lib/view.js';

export async function runCLI(
  args: string[],
  opts?: {
    dbPath?: string;
    logger?: {
      log: (...a: any[]) => void;
      table: (...a: any[]) => void;
      error: (...a: any[]) => void;
    };
  }
): Promise<number> {
  const logger = opts?.logger ?? console;
  const command = args[0];

  if (!command) {
    logger.log(`
Usage: nx-tools-db <command> [options]

Commands:
  sync-nx [workspace-root]               Sync all Nx projects to database
  list-projects                          List all projects
  list-files <project>                   List files in project
  find-projects <filepath>               Find projects containing file
  dependencies <project>                 Show project dependencies
  dependents <project>                   Show projects that depend on this project

  view                                   Launch a web-based viewer for the database

  Git Commands:
  sync-git [commit-count]                Sync git commits and touched files (default: 100 commits)
  list-commits [limit]                   List recent git commits from database (default: 50)
  touched-files [commit-hash]            List files touched in commits (optionally for specific commit)
  touched-projects [commit-count]        Show projects touched by recent git changes (default: 100)

  File Dependency Commands:
  sync-file-deps [workspace-root]        Sync file dependencies from Nx file-map.json
  file-deps <file>                       List files that the given file depends on
  file-dependents <file>                 List files that depend on the given file

Examples:
  nx-tools-db sync-nx                    # Sync all Nx projects
  nx-tools-db create-project "my-app" "My application"
  nx-tools-db add-file "my-app" "src/main.ts" "ts"
  nx-tools-db list-files "my-app"
  nx-tools-db dependencies "my-app"      # Show what my-app depends on
  nx-tools-db dependents "shared-lib"    # Show what depends on shared-lib
  nx-tools-db affected "src/lib/utils.ts" "package.json"
  nx-tools-db sync-git 50                # Sync last 50 git commits
  nx-tools-db list-commits 20            # Show last 20 commits
  nx-tools-db touched-files abc123       # Show files touched in commit abc123
  nx-tools-db git-affected 50            # Show projects affected by last 50 commits
`);
    return 1;
  }

  const dbPath = opts?.dbPath ?? path.join(process.cwd(), 'nx-projects.db');
  const db = new ProjectDatabase(dbPath);
  let exitCode = 0;

  try {
    switch (command) {
      case 'view': {
        logger.log(await generateArchitectureDiagram(dbPath));
        break;
      }

      case 'sync': {
        logger.log('Syncing Nx workspace to database...');
        const projectGraph = await db.syncWithNxWorkspace();
        logger.log(
          `Successfully synced ${
            Object.keys(projectGraph.nodes).length
          } projects`
        );
        const deps = await db.syncAllProjectDependencies();
        logger.log(`Successfully synced ${deps.length} project dependencies`);

        const [commitCountStr] = args.slice(1);
        const commitCount = commitCountStr ? parseInt(commitCountStr, 10) : 100;
        if (isNaN(commitCount) || commitCount <= 0) {
          logger.error('Commit count must be a positive number');
          return 1;
        }
        logger.log(`Syncing last ${commitCount} git commits...`);
        await db.syncGitCommits(commitCount);
        logger.log('Git sync completed successfully');
        break;
      }

      case 'sync-nx': {
        const [workspaceRoot] = args.slice(1);
        logger.log('Syncing Nx workspace to database...');
        const projectGraph = await db.syncWithNxWorkspace(workspaceRoot);
        logger.log(
          `Successfully synced ${
            Object.keys(projectGraph.nodes).length
          } projects`
        );
        const deps = await db.syncAllProjectDependencies();
        logger.log(`Successfully synced ${deps.length} project dependencies`);
        const fileDeps = await db.syncFileDependenciesFromNx(workspaceRoot);
        logger.log(`Successfully synced ${fileDeps} file dependencies`);
        break;
      }

      case 'create-project': {
        const [name, description] = args.slice(1);
        if (!name) {
          logger.error('Project name is required');
          return 1;
        }
        const id = await db.createProject(name, description);
        logger.log(`Created project "${name}" with ID ${id}`);
        break;
      }

      case 'list-projects': {
        const [commitCountStr] = args.slice(1);
        const commitCount = commitCountStr ? parseInt(commitCountStr, 10) : 100;
        if (isNaN(commitCount) || commitCount <= 0) {
          logger.error('Commit count must be a positive number');
          return 1;
        }
        const projects = await db.getAllProjects();
        logger.log('Projects loaded');
        const touchedCounts = await db.getAllProjectsTouchedCount(commitCount);
        logger.log('Calculated touched count');
        const loads = await db.getAllProjectsLoad(commitCount);
        logger.log('Calculated project loads');
        const affectedCounts = await db.getAllProjectsAffectedCount(commitCount);
        logger.log('Calculated affected count');

        if (projects.length === 0) {
          logger.log('No projects found');
        } else {
          logger.log('Projects:');

          const sortedProjects = projects
            .map((project) => ({
              ...project,
              touchedCount:
                touchedCounts.find((p) => p.name === project.name)
                  ?.touch_count || 0,
              load: loads.find((p) => p.name === project.name)?.load || 0,
              affectedCount:
                affectedCounts.find((p) => p.name === project.name)
                  ?.affected_count || 0,
            }))
            .sort((a, b) => b.load - a.load);
          logger.table(sortedProjects, [
            'name',
            'touchedCount',
            'load',
            'affectedCount',
          ]);
        }
        break;
      }

      case 'list-projects-load': {
        const projects = await db.getAllProjectsLoad();
        if (projects.length === 0) {
          logger.log('No projects found');
        } else {
          logger.log('Projects load:');
          projects.forEach((project) => {
            logger.log(`  ${project.name} - ${project.load}`);
          });
        }
        break;
      }

      case 'list-projects-touched': {
        const projects = await db.getAllProjectsTouchedCount();
        if (projects.length === 0) {
          logger.log('No projects found');
        } else {
          logger.log('Projects touched count:');
          projects.forEach((project) => {
            logger.log(`  ${project.name} - ${project.touch_count}`);
          });
        }
        break;
      }

      case 'list-projects-affected': {
        const projects = await db.getAllProjectsAffectedCount();
        if (projects.length === 0) {
          logger.log('No projects found');
        } else {
          logger.log('Projects affected count:');
          projects.forEach((project) => {
            logger.log(`  ${project.name} - ${project.affected_count}`);
          });
        }
        break;
      }

      case 'delete-project': {
        const [name] = args.slice(1);
        if (!name) {
          logger.error('Project name is required');
          return 1;
        }
        const deleted = await db.deleteProject(name);
        if (deleted) {
          logger.log(`Deleted project "${name}"`);
        } else {
          logger.log(`Project "${name}" not found`);
        }
        break;
      }

      case 'list-files': {
        const [projectName] = args.slice(1);
        if (!projectName) {
          logger.error('Project name is required');
          return 1;
        }
        const files = await db.getProjectFiles(projectName);
        if (files.length === 0) {
          logger.log(`No files found in project "${projectName}"`);
        } else {
          logger.log(`Files in project "${projectName}":`);
          files.forEach((file) => {
            logger.log(
              `  ${file.file_path}${
                file.file_type ? ` (${file.file_type})` : ''
              }`
            );
          });
        }
        break;
      }

      case 'find-projects': {
        const [filePath] = args.slice(1);
        if (!filePath) {
          logger.error('File path is required');
          return 1;
        }
        const projects = await db.getFileProjects(filePath);
        if (projects.length === 0) {
          logger.log(`File "${filePath}" not found in any project`);
        } else {
          logger.log(`File "${filePath}" found in projects:`);
          projects.forEach((project) => {
            logger.log(`  ${project.name}`);
          });
        }
        break;
      }

      case 'sync-file-deps': {
        const [workspaceRoot] = args.slice(1);
        logger.log('Syncing file dependencies from Nx file map...');
        const count = await db.syncFileDependenciesFromNx(workspaceRoot);
        logger.log(`Synced ${count} file dependency relations`);
        break;
      }

      case 'file-deps': {
        const [filePath] = args.slice(1);
        if (!filePath) {
          logger.error('File path is required');
          return 1;
        }
        const deps = await db.getFileDependencies(filePath);
        if (deps.length === 0) {
          logger.log(`No dependencies recorded for "${filePath}"`);
        } else {
          logger.log(`Dependencies of "${filePath}":`);
          deps.forEach((d) => logger.log(`  ${d}`));
        }
        break;
      }

      case 'file-dependents': {
        const [filePath] = args.slice(1);
        if (!filePath) {
          logger.error('File path is required');
          return 1;
        }
        const dependents = await db.getFileDependents(filePath);
        if (dependents.length === 0) {
          logger.log(`No dependents recorded for "${filePath}"`);
        } else {
          logger.log(`Files depending on "${filePath}":`);
          dependents.forEach((f) => logger.log(`  ${f}`));
        }
        break;
      }

      case 'dependencies': {
        const [projectName] = args.slice(1);
        if (!projectName) {
          logger.error('Project name is required');
          return 1;
        }
        const dependencies = await db.getProjectDependencies(projectName);
        if (dependencies.length === 0) {
          logger.log(`Project "${projectName}" has no dependencies`);
        } else {
          logger.log(`Dependencies of "${projectName}":`);
          dependencies.forEach((dep) => {
            logger.log(`  ${dep}`);
          });
        }
        break;
      }

      case 'dependents': {
        const [projectName] = args.slice(1);
        if (!projectName) {
          logger.error('Project name is required');
          return 1;
        }
        const dependents = await db.getProjectDependents(projectName);
        if (dependents.length === 0) {
          logger.log(`No projects depend on "${projectName}"`);
        } else {
          logger.log(`Projects that depend on "${projectName}":`);
          dependents.forEach((dep) => {
            logger.log(`  ${dep}`);
          });
        }
        break;
      }

      case 'add-file': {
        const [projectName, filePath, fileType] = args.slice(1);
        if (!projectName || !filePath) {
          logger.error('Project name and file path are required');
          return 1;
        }
        try {
          // fileType may be a short string like 'ts' - convert to array to match API
          await db.addFileToProject(
            projectName,
            filePath,
            fileType ? [fileType] : undefined
          );
          logger.log(`Added "${filePath}" to project "${projectName}"`);
        } catch (error) {
          logger.error(
            'Error:',
            error instanceof Error ? error.message : error
          );
          return 1;
        }
        break;
      }

      case 'remove-file': {
        const [projectName, filePath] = args.slice(1);
        if (!projectName || !filePath) {
          logger.error('Project name and file path are required');
          return 1;
        }
        try {
          const removed = await db.removeFileFromProject(projectName, filePath);
          if (removed) {
            logger.log(`Removed "${filePath}" from project "${projectName}"`);
          } else {
            logger.log(
              `File "${filePath}" not found in project "${projectName}"`
            );
          }
        } catch (error) {
          logger.error(
            'Error:',
            error instanceof Error ? error.message : error
          );
          return 1;
        }
        break;
      }

      case 'by-type': {
        const [type] = args.slice(1);
        if (!type) {
          logger.error('Project type is required');
          return 1;
        }
        const projects = await db.getProjectsByType(type);
        if (projects.length === 0) {
          logger.log(`No projects of type "${type}"`);
        } else {
          logger.log(`Projects of type "${type}":`);
          projects.forEach((p) => logger.log(`  ${p.name}`));
        }
        break;
      }

      case 'by-tag': {
        const [tag] = args.slice(1);
        if (!tag) {
          logger.error('Tag is required');
          return 1;
        }
        const projects = await db.getProjectsByTag(tag);
        if (projects.length === 0) {
          logger.log(`No projects with tag "${tag}"`);
        } else {
          logger.log(`Projects with tag "${tag}":`);
          projects.forEach((p) => logger.log(`  ${p.name}`));
        }
        break;
      }

      case 'git-affected': {
        const [commitCountStr] = args.slice(1);
        const commitCount = commitCountStr ? parseInt(commitCountStr, 10) : 100;
        if (isNaN(commitCount) || commitCount <= 0) {
          logger.error('Commit count must be a positive number');
          return 1;
        }
        const projects = await db.getAllProjectsTouchedCount(commitCount);
        if (projects.length === 0) {
          logger.log('No projects affected');
        } else {
          logger.log(`Projects affected by last ${commitCount} commits:`);
          projects.forEach((p) => logger.log(`  ${p}`));
        }
        break;
      }

      case 'affected': {
        const changedFiles = args.slice(1);
        if (changedFiles.length === 0) {
          logger.error('At least one file path is required');
          return 1;
        }
        const affectedProjects = await db.getAffectedProjects(changedFiles);
        if (affectedProjects.length === 0) {
          logger.log('No projects are affected by the changed files');
        } else {
          logger.log(
            `Projects affected by changes to: ${changedFiles.join(', ')}`
          );
          affectedProjects.forEach((project) => {
            logger.log(`  ${project}`);
          });
        }
        break;
      }

      case 'sync-git': {
        const [commitCountStr] = args.slice(1);
        const commitCount = commitCountStr ? parseInt(commitCountStr, 10) : 100;
        if (isNaN(commitCount) || commitCount <= 0) {
          logger.error('Commit count must be a positive number');
          return 1;
        }
        logger.log(`Syncing last ${commitCount} git commits...`);
        await db.syncGitCommits(commitCount);
        logger.log('Git sync completed successfully');
        break;
      }

      case 'list-commits': {
        const [limitStr] = args.slice(1);
        const limit = limitStr ? parseInt(limitStr, 10) : 50;
        if (isNaN(limit) || limit <= 0) {
          logger.error('Limit must be a positive number');
          return 1;
        }
        const commits = await db.getCommits(limit);
        if (commits.length === 0) {
          logger.log('No commits found in database');
        } else {
          logger.log(`Recent commits (last ${commits.length}):`);
          commits.forEach((commit) => {
            const shortHash = commit.hash.substring(0, 8);
            const shortMessage =
              commit.message.length > 60
                ? commit.message.substring(0, 60) + '...'
                : commit.message;
            logger.log(
              `  ${shortHash} - ${commit.author} (${commit.date}) - ${shortMessage}`
            );
          });
        }
        break;
      }

      case 'touched-files': {
        const [commitHash] = args.slice(1);
        const touchedFiles = await db.getTouchedFiles(commitHash);
        if (touchedFiles.length === 0) {
          const msg = commitHash
            ? `No files found for commit ${commitHash}`
            : 'No touched files found in database';
          logger.log(msg);
        } else {
          const msg = commitHash
            ? `Files touched in commit ${commitHash}:`
            : 'Recently touched files:';
          logger.log(msg);
          touchedFiles.forEach((file) => {
            logger.log(`  ${file.change_type} ${file.file_path}`);
          });
        }
        break;
      }

      case 'touched-projects': {
        const [commitCountStr] = args.slice(1);
        const commitCount = commitCountStr ? parseInt(commitCountStr, 10) : 100;
        if (isNaN(commitCount) || commitCount <= 0) {
          logger.error('Commit count must be a positive number');
          return 1;
        }
        const touchedProjects = await db.getAllProjectsTouchedCount(
          commitCount
        );
        if (touchedProjects.length === 0) {
          logger.log(
            `No projects touched by changes in last ${commitCount} commits`
          );
        } else {
          logger.log(
            `Projects touched by changes in last ${commitCount} commits:`
          );
          touchedProjects.forEach((project) => {
            logger.log(`  ${project}`);
          });
        }
        break;
      }

      default:
        logger.error(`Unknown command: ${command}`);
        return 1;
    }
  } catch (error) {
    logger.error('Error:', error instanceof Error ? error.message : error);
    exitCode = 1;
  } finally {
    await db.close();
  }

  return exitCode;
}

if (typeof process.env.JEST_WORKER_ID === 'undefined') {
  async function main() {
    const code = await runCLI(process.argv.slice(2));
    process.exit(code);
  }

  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

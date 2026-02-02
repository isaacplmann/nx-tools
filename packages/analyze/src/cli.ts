#!/usr/bin/env node

import { ProjectDatabase } from './lib/db.js';
import * as process from 'process';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`
Usage: nx-tools-db <command> [options]

Commands:
  sync-nx [workspace-root]               Sync all Nx projects to database
  list-projects                          List all projects
  list-files <project>                   List files in project
  find-projects <filepath>               Find projects containing file
  dependencies <project>                 Show project dependencies
  dependents <project>                   Show projects that depend on this project

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
    process.exit(1);
  }

  const dbPath = path.join(process.cwd(), 'nx-projects.db');
  const db = new ProjectDatabase(dbPath);

  try {
    switch (command) {
      case 'sync-nx': {
        const [workspaceRoot] = args.slice(1);
        console.log('Syncing Nx workspace to database...');
        const projectGraph = await db.syncWithNxWorkspace(workspaceRoot);
        console.log(
          `Successfully synced ${
            Object.keys(projectGraph.nodes).length
          } projects`
        );
        break;
      }

      case 'create-project': {
        const [name, description] = args.slice(1);
        if (!name) {
          console.error('Project name is required');
          process.exit(1);
        }
        const id = await db.createProject(name, description);
        console.log(`Created project "${name}" with ID ${id}`);
        break;
      }

      case 'list-projects': {
        const projects = await db.getAllProjects();
        if (projects.length === 0) {
          console.log('No projects found');
        } else {
          console.log('Projects:');
          projects.forEach((project) => {
            console.log(
              `  ${project.name}${
                project.description ? ` - ${project.description}` : ''
              }`
            );
          });
        }
        break;
      }

      case 'delete-project': {
        const [name] = args.slice(1);
        if (!name) {
          console.error('Project name is required');
          process.exit(1);
        }
        const deleted = await db.deleteProject(name);
        if (deleted) {
          console.log(`Deleted project "${name}"`);
        } else {
          console.log(`Project "${name}" not found`);
        }
        break;
      }

      case 'list-files': {
        const [projectName] = args.slice(1);
        if (!projectName) {
          console.error('Project name is required');
          process.exit(1);
        }
        const files = await db.getProjectFiles(projectName);
        if (files.length === 0) {
          console.log(`No files found in project "${projectName}"`);
        } else {
          console.log(`Files in project "${projectName}":`);
          files.forEach((file) => {
            console.log(
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
          console.error('File path is required');
          process.exit(1);
        }
        const projects = await db.getFileProjects(filePath);
        if (projects.length === 0) {
          console.log(`File "${filePath}" not found in any project`);
        } else {
          console.log(`File "${filePath}" found in projects:`);
          projects.forEach((project) => {
            console.log(`  ${project.name}`);
          });
        }
        break;
      }

      case 'sync-file-deps': {
        const [workspaceRoot] = args.slice(1);
        console.log('Syncing file dependencies from Nx file map...');
        const count = await db.syncFileDependenciesFromNx(workspaceRoot);
        console.log(`Synced ${count} file dependency relations`);
        break;
      }

      case 'file-deps': {
        const [filePath] = args.slice(1);
        if (!filePath) {
          console.error('File path is required');
          process.exit(1);
        }
        const deps = await db.getFileDependencies(filePath);
        if (deps.length === 0) {
          console.log(`No dependencies recorded for "${filePath}"`);
        } else {
          console.log(`Dependencies of "${filePath}":`);
          deps.forEach((d) => console.log(`  ${d}`));
        }
        break;
      }

      case 'file-dependents': {
        const [filePath] = args.slice(1);
        if (!filePath) {
          console.error('File path is required');
          process.exit(1);
        }
        const dependents = await db.getFileDependents(filePath);
        if (dependents.length === 0) {
          console.log(`No dependents recorded for "${filePath}"`);
        } else {
          console.log(`Files depending on "${filePath}":`);
          dependents.forEach((f) => console.log(`  ${f}`));
        }
        break;
      }

      case 'dependencies': {
        const [projectName] = args.slice(1);
        if (!projectName) {
          console.error('Project name is required');
          process.exit(1);
        }
        const dependencies = await db.getProjectDependencies(projectName);
        if (dependencies.length === 0) {
          console.log(`Project "${projectName}" has no dependencies`);
        } else {
          console.log(`Dependencies of "${projectName}":`);
          dependencies.forEach((dep) => {
            console.log(`  ${dep}`);
          });
        }
        break;
      }

      case 'dependents': {
        const [projectName] = args.slice(1);
        if (!projectName) {
          console.error('Project name is required');
          process.exit(1);
        }
        const dependents = await db.getProjectDependents(projectName);
        if (dependents.length === 0) {
          console.log(`No projects depend on "${projectName}"`);
        } else {
          console.log(`Projects that depend on "${projectName}":`);
          dependents.forEach((dep) => {
            console.log(`  ${dep}`);
          });
        }
        break;
      }

      case 'add-file': {
        const [projectName, filePath, fileType] = args.slice(1);
        if (!projectName || !filePath) {
          console.error('Project name and file path are required');
          process.exit(1);
        }
        try {
          // fileType may be a short string like 'ts' - convert to array to match API
          await db.addFileToProject(
            projectName,
            filePath,
            fileType ? [fileType] : undefined
          );
          console.log(`Added "${filePath}" to project "${projectName}"`);
        } catch (error) {
          console.error('Error:', error instanceof Error ? error.message : error);
          process.exit(1);
        }
        break;
      }

      case 'remove-file': {
        const [projectName, filePath] = args.slice(1);
        if (!projectName || !filePath) {
          console.error('Project name and file path are required');
          process.exit(1);
        }
        try {
          const removed = await db.removeFileFromProject(projectName, filePath);
          if (removed) {
            console.log(`Removed "${filePath}" from project "${projectName}"`);
          } else {
            console.log(`File "${filePath}" not found in project "${projectName}"`);
          }
        } catch (error) {
          console.error('Error:', error instanceof Error ? error.message : error);
          process.exit(1);
        }
        break;
      }

      case 'by-type': {
        const [type] = args.slice(1);
        if (!type) {
          console.error('Project type is required');
          process.exit(1);
        }
        const projects = await db.getProjectsByType(type);
        if (projects.length === 0) {
          console.log(`No projects of type "${type}"`);
        } else {
          console.log(`Projects of type "${type}":`);
          projects.forEach((p) => console.log(`  ${p.name}`));
        }
        break;
      }

      case 'by-tag': {
        const [tag] = args.slice(1);
        if (!tag) {
          console.error('Tag is required');
          process.exit(1);
        }
        const projects = await db.getProjectsByTag(tag);
        if (projects.length === 0) {
          console.log(`No projects with tag "${tag}"`);
        } else {
          console.log(`Projects with tag "${tag}":`);
          projects.forEach((p) => console.log(`  ${p.name}`));
        }
        break;
      }

      case 'git-affected': {
        const [commitCountStr] = args.slice(1);
        const commitCount = commitCountStr ? parseInt(commitCountStr, 10) : 100;
        if (isNaN(commitCount) || commitCount <= 0) {
          console.error('Commit count must be a positive number');
          process.exit(1);
        }
        const projects = await db.getProjectsTouchedByCommits(commitCount);
        if (projects.length === 0) {
          console.log('No projects affected');
        } else {
          console.log(`Projects affected by last ${commitCount} commits:`);
          projects.forEach((p) => console.log(`  ${p}`));
        }
        break;
      }

      case 'affected': {
        const changedFiles = args.slice(1);
        if (changedFiles.length === 0) {
          console.error('At least one file path is required');
          process.exit(1);
        }
        const affectedProjects = await db.getAffectedProjects(changedFiles);
        if (affectedProjects.length === 0) {
          console.log('No projects are affected by the changed files');
        } else {
          console.log(
            `Projects affected by changes to: ${changedFiles.join(', ')}`
          );
          affectedProjects.forEach((project) => {
            console.log(`  ${project}`);
          });
        }
        break;
      }

      case 'sync-git': {
        const [commitCountStr] = args.slice(1);
        const commitCount = commitCountStr ? parseInt(commitCountStr, 10) : 100;
        if (isNaN(commitCount) || commitCount <= 0) {
          console.error('Commit count must be a positive number');
          process.exit(1);
        }
        console.log(`Syncing last ${commitCount} git commits...`);
        await db.syncGitCommits(commitCount);
        console.log('Git sync completed successfully');
        break;
      }

      case 'list-commits': {
        const [limitStr] = args.slice(1);
        const limit = limitStr ? parseInt(limitStr, 10) : 50;
        if (isNaN(limit) || limit <= 0) {
          console.error('Limit must be a positive number');
          process.exit(1);
        }
        const commits = await db.getCommits(limit);
        if (commits.length === 0) {
          console.log('No commits found in database');
        } else {
          console.log(`Recent commits (last ${commits.length}):`);
          commits.forEach((commit) => {
            const shortHash = commit.hash.substring(0, 8);
            const shortMessage =
              commit.message.length > 60
                ? commit.message.substring(0, 60) + '...'
                : commit.message;
            console.log(
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
          console.log(msg);
        } else {
          const msg = commitHash
            ? `Files touched in commit ${commitHash}:`
            : 'Recently touched files:';
          console.log(msg);
          touchedFiles.forEach((file) => {
            console.log(`  ${file.change_type} ${file.file_path}`);
          });
        }
        break;
      }

      case 'touched-projects': {
        const [commitCountStr] = args.slice(1);
        const commitCount = commitCountStr ? parseInt(commitCountStr, 10) : 100;
        if (isNaN(commitCount) || commitCount <= 0) {
          console.error('Commit count must be a positive number');
          process.exit(1);
        }
        const touchedProjects = await db.getProjectsTouchedByCommits(
          commitCount
        );
        if (touchedProjects.length === 0) {
          console.log(
            `No projects touched by changes in last ${commitCount} commits`
          );
        } else {
          console.log(
            `Projects touched by changes in last ${commitCount} commits:`
          );
          touchedProjects.forEach((project) => {
            console.log(`  ${project}`);
          });
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    db.close();
    process.exit(1);
  } finally {
    db.close();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

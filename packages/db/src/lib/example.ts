import { ProjectDatabase, Project, ProjectFile } from './db.js';

async function example() {
  // Create a new database instance
  const db = new ProjectDatabase('./example-projects.db');

  try {
    console.log('=== Nx Integration Example ===\n');

    // Sync with Nx workspace - this automatically discovers all projects
    console.log('Syncing with Nx workspace...');
    const projectGraph = await db.syncWithNxWorkspace();
    console.log(`Discovered ${Object.keys(projectGraph.nodes).length} Nx projects\n`);

    // Query all projects (now includes Nx projects with metadata)
    console.log('All projects in workspace:');
    const projects = await db.getAllProjects();
    projects.forEach((project: Project) => {
      const typeInfo = project.project_type ? ` (${project.project_type})` : '';
      const tagInfo = project.tags ? ` [${project.tags}]` : '';
      console.log(`- ${project.name}${typeInfo}: ${project.description || 'No description'}${tagInfo}`);
    });

    // Example: Get projects by type
    console.log('\nApplication projects:');
    const apps = await db.getProjectsByType('application');
    apps.forEach((project: Project) => {
      console.log(`- ${project.name}: ${project.root}`);
    });

    // Example: Get projects by tag (if you have projects with tags)
    console.log('\nProjects with "type:feature" tag:');
    const featureProjects = await db.getProjectsByTag('type:feature');
    if (featureProjects.length > 0) {
      featureProjects.forEach((project: Project) => {
        console.log(`- ${project.name}`);
      });
    } else {
      console.log('No projects found with that tag');
    }

    // Example: Show dependencies for a project (if it exists)
    if (projects.length > 0) {
      const firstProject = projects[0];
      console.log(`\nDependencies of "${firstProject.name}":`);
      const dependencies = await db.getProjectDependencies(firstProject.name);
      if (dependencies.length > 0) {
        dependencies.forEach(dep => console.log(`- ${dep}`));
      } else {
        console.log('No dependencies found');
      }

      console.log(`\nProjects that depend on "${firstProject.name}":`);
      const dependents = await db.getProjectDependents(firstProject.name);
      if (dependents.length > 0) {
        dependents.forEach(dep => console.log(`- ${dep}`));
      } else {
        console.log('No dependents found');
      }
    }

    // Example: Find affected projects by file changes
    console.log('\nFinding projects affected by package.json changes:');
    const affectedProjects = await db.getAffectedProjects(['package.json', 'nx.json']);
    if (affectedProjects.length > 0) {
      affectedProjects.forEach(project => console.log(`- ${project}`));
    } else {
      console.log('No projects affected');
    }

    // Get files for a specific project (if it exists and has files)
    if (projects.length > 0) {
      const firstProject = projects[0];
      console.log(`\nFiles in "${firstProject.name}" project:`);
      const projectFiles = await db.getProjectFiles(firstProject.name);
      if (projectFiles.length > 0) {
        projectFiles.slice(0, 5).forEach((file: ProjectFile) => {
          console.log(`- ${file.file_path} (${file.file_type})`);
        });
        if (projectFiles.length > 5) {
          console.log(`... and ${projectFiles.length - 5} more files`);
        }
      } else {
        console.log('No files found for this project');
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Always close the database connection
    db.close();
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  example().catch(console.error);
}

export { example };
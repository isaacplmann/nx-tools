import { ProjectDatabase } from './db.js';
import { Project } from './types.js';

interface Dependency {
  source: string;
  target: string;
}

export async function generateArchitectureDiagram(dbPath: string): Promise<string> {
    console.log(dbPath);
    const db = new ProjectDatabase(dbPath);

  // Query projects and dependencies from your database
  let projects: Project[] = await db.getAllProjects();
  const dependencies: Dependency[] = [];

  // Start mermaid diagram
  let diagram = 'architecture-beta\n';

  await Promise.all(projects.map(async (proj) => {
    diagram += `  service ${sanitizeName(proj.name)} as "${proj.name}"\n`;
    const deps = await db.getProjectDependencies(proj.name);
    deps.filter(dep => dep.startsWith('npm:')).forEach((dep) => {
      dependencies.push({ source: proj.name, target: dep });
    });
  }));

  // Add dependencies as connections
  diagram += '\n';
  dependencies.forEach((dep) => {
    diagram += `  ${sanitizeName(dep.source)} --> ${sanitizeName(
      dep.target
    )}\n`;
  });

  return diagram;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Export for use in other modules
export default generateArchitectureDiagram;

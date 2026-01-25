# @nx-tools/analyze

A SQLite-based database for tracking which files belong to each project in your repository.

## Features

- **Nx Integration**: Automatically sync with Nx workspace and project graph
- **Project Management**: Create, list, and delete projects with Nx metadata
- **File Tracking**: Associate files with projects using Nx project boundaries
- **Dependency Analysis**: Track project dependencies and dependents from Nx graph
- **Affected Project Detection**: Find projects affected by file changes
- **Query Capabilities**: Filter projects by type, tags, and relationships
- **Repository Scanning**: Automatically scan directories to add files to projects
- **CLI Interface**: Command-line tools for easy management

## Installation

```bash
npm install @nx-tools/analyze
```

## Usage

### Programmatic API

```typescript
import { ProjectDatabase } from '@nx-tools/analyze';

// Create a database instance
const db = new ProjectDatabase('./my-projects.db');

// Sync with Nx workspace - automatically discovers all projects and files
const projectGraph = await db.syncWithNxWorkspace();

// Query projects (now includes Nx metadata)
const projects = await db.getAllProjects();
const appProjects = await db.getProjectsByType('application');
const frontendProjects = await db.getProjectsByTag('scope:frontend');

// Analyze project relationships
const dependencies = await db.getProjectDependencies('my-app');
const dependents = await db.getProjectDependents('shared-lib');

// Find affected projects by file changes
const affected = await db.getAffectedProjects([
  'src/shared/utils.ts',
  'package.json',
]);

// Traditional file operations still work
const files = await db.getProjectFiles('my-app');
const fileProjects = await db.getFileProjects('src/main.ts');

// Clean up
db.close();
```

### CLI Usage

The package includes a CLI tool for managing projects and files:

```bash
# Create a new project
nx-tools-db create-project "frontend" "React frontend application"

# List all projects
nx-tools-db list-projects

# Add a file to a project
nx-tools-db add-file "frontend" "src/App.tsx" "tsx"

# List files in a project
nx-tools-db list-files "frontend"

# Find which projects contain a file
nx-tools-db find-projects "package.json"

# Scan a directory and add all files to a project
nx-tools-db scan "frontend" "./src"

# Remove a file from a project
nx-tools-db remove-file "frontend" "src/old-component.tsx"

# Delete a project
nx-tools-db delete-project "old-project"
```

## API Reference

### ProjectDatabase

#### Constructor

- `new ProjectDatabase(dbPath?: string)` - Creates a new database instance

#### Project Methods

- `createProject(name: string, description?: string): Promise<number>` - Create a new project
- `getProject(name: string): Promise<Project | null>` - Get a project by name
- `getAllProjects(): Promise<Project[]>` - Get all projects
- `deleteProject(name: string): Promise<boolean>` - Delete a project

#### File Methods

- `addFileToProject(projectName: string, filePath: string, fileType?: string): Promise<void>` - Add a file to a project
- `removeFileFromProject(projectName: string, filePath: string): Promise<boolean>` - Remove a file from a project
- `getProjectFiles(projectName: string): Promise<ProjectFile[]>` - Get all files in a project
- `getFileProjects(filePath: string): Promise<Project[]>` - Get all projects containing a file

#### Utility Methods

- `scanRepositoryFiles(rootPath: string, projectName: string): Promise<void>` - Scan a directory and add files to a project
- `close(): void` - Close the database connection

### Types

```typescript
interface Project {
  id?: number;
  name: string;
  description?: string;
  created_at?: string;
}

interface ProjectFile {
  id?: number;
  project_id: number;
  file_path: string;
  file_type?: string;
  added_at?: string;
}
```

## Database Schema

The database uses two main tables:

### projects

- `id` (INTEGER PRIMARY KEY) - Auto-incrementing project ID
- `name` (TEXT UNIQUE NOT NULL) - Project name
- `description` (TEXT) - Optional project description
- `created_at` (DATETIME) - Creation timestamp

### project_files

- `id` (INTEGER PRIMARY KEY) - Auto-incrementing file ID
- `project_id` (INTEGER) - Foreign key to projects.id
- `file_path` (TEXT) - Relative path to the file
- `file_type` (TEXT) - File extension/type
- `added_at` (DATETIME) - Timestamp when file was added

## Example Use Cases

1. **Nx Workspace Management**: Track which files belong to each library or application
2. **Monorepo Organization**: Organize files across multiple projects in a single repository
3. **Build System Integration**: Determine which projects are affected by file changes
4. **Documentation**: Generate project-specific file listings
5. **Code Analysis**: Analyze file distributions across projects

## Building

Run `nx build db` to build the library.

## Running unit tests

Run `nx test db` to execute the unit tests via [Jest](https://jestjs.io).


## Outline

- inputs
  - file-map.json
    - source file
    - source project
    - target project
    - need: target file or target symbol(s)
  - git commit history
    - commit sha
    - file list
  - 

## License

MIT

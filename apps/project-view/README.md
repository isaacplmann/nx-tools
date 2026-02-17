# Project View

A Next.js application for viewing and analyzing Nx project metrics and file dependencies.

## Features

- **Screen 1: Project Metrics Table**
  - Displays all projects with metrics: name, touched count, dependents, load, and affected count
  - Sortable columns
  - "Split" button to navigate to the file split view

- **Screen 2: File Split View**
  - Visualizes files in a project split across two columns
  - Shows dependent projects with connecting lines
  - Move files between columns
  - Hover highlighting for file dependencies

## Setup

1. Ensure the `nx-projects.db` SQLite database exists in the workspace root
2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   nx serve project-view
   ```

   Or using npm:
   ```bash
   cd packages/analyze/src/apps/project-view
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Database

The app expects the database file `nx-projects.db` to be located in the workspace root directory. The database should contain:
- Projects table with project information
- Project files table
- File dependencies table
- Git commits and touched files (for metrics)

## API Routes

- `GET /api/projects` - Get all project metrics
- `GET /api/projects/[name]` - Get a specific project
- `GET /api/projects/[name]/files` - Get files for a project
- `GET /api/files/[filePath]/dependents` - Get projects that depend on a file

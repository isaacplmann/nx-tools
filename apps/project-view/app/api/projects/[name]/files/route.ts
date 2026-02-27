import { NextResponse } from 'next/server';
import { ProjectViewDb, getDbPath } from '@/lib/db';

/** Opt out of static rendering; this route uses request.url for query params. */
export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  const db = new ProjectViewDb(getDbPath());
  const projects = await db.getAllProjects();
  await db.close();
  return projects.map((project) => ({ name: project.name }));
};

export async function GET(
  request: Request,
  { params }: { params: { name: string } }
) {
  try {
    const projectName = decodeURIComponent(params.name);
    const db = new ProjectViewDb(getDbPath());
    const files = await db.getProjectFiles(projectName);
    const suggestedSplit = await db.getSuggestedFileSplit(files.map((f) => f.file_path));
    await db.close();

    return NextResponse.json({ files, suggestedSplit });
  } catch (error) {
    console.error('Error fetching project files:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project files' },
      { status: 500 }
    );
  }
}

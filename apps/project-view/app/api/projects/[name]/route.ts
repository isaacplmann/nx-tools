import { NextResponse } from 'next/server';
import { ProjectViewDb, getDbPath } from '@/lib/db';

/** Opt out of static rendering; this route uses request.url for query params. */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { name: string } }
) {
  try {
    const projectName = decodeURIComponent(params.name);
    const db = new ProjectViewDb(getDbPath());
    const project = await db.getProject(projectName);
    await db.close();

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

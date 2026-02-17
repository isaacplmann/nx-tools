import { NextResponse } from 'next/server';
import { ProjectViewDb, getDbPath } from '@/lib/db';
import { cwd } from 'process';

/** Opt out of static rendering; this route uses request.url for query params. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  console.log('db path', getDbPath(), cwd());
  try {
    const { searchParams } = new URL(request.url);
    const commitCount = parseInt(searchParams.get('commitCount') || '100', 10);

    const db = new ProjectViewDb(getDbPath());
    const projects = await db.getAllProjectsMetrics(commitCount);
    await db.close();

    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

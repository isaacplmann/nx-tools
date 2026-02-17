import { NextResponse } from 'next/server';
import { ProjectViewDb, getDbPath } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { filePath: string } }
) {
  try {
    const filePath = decodeURIComponent(params.filePath);
    const db = new ProjectViewDb(getDbPath());
    const projects = await db.getProjectsDependingOnFile(filePath);
    await db.close();

    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching file dependents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch file dependents' },
      { status: 500 }
    );
  }
}

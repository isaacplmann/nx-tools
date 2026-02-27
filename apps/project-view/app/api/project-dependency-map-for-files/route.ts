import { NextRequest, NextResponse } from 'next/server';
import { ProjectViewDb, getDbPath } from '../../../lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Get filePaths from query parameters
    // Support both formats: ?filePaths=file1,file2,file3 or ?filePaths[]=file1&filePaths[]=file2
    let filePaths: string[] = [];
    const filePathsParam = searchParams.get('filePaths');
    
    if (filePathsParam) {
      // Format: filePaths=file1,file2,file3
      filePaths = filePathsParam.split(',').map(f => f.trim()).filter(f => f);
    } else {
      // Format: filePaths[]=file1&filePaths[]=file2
      filePaths = searchParams.getAll('filePaths[]').filter(f => f);
    }

    if (!filePaths || filePaths.length === 0) {
      return NextResponse.json(
        { error: 'At least one file path is required' },
        { status: 400 }
      );
    }

    const db = new ProjectViewDb(getDbPath());
    try {
      const dependencyMap = await db.getProjectDependencyMapForFiles(filePaths);
      return NextResponse.json(dependencyMap);
    } finally {
      await db.close();
    }
  } catch (error) {
    console.error('Error in project-dependency-map-for-files endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve project dependency map' },
      { status: 500 }
    );
  }
}

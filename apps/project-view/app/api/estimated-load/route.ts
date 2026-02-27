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

    // Get optional commitCount parameter (default 100)
    const commitCountParam = searchParams.get('commitCount');
    const commitCount = commitCountParam ? Math.max(1, parseInt(commitCountParam, 10)) : 100;

    const db = new ProjectViewDb(getDbPath());
    try {
      const estimatedLoad = await db.getEstimatedLoad(filePaths, commitCount);
      return NextResponse.json({
        filePaths,
        commitCount,
        estimatedLoad,
      });
    } finally {
      await db.close();
    }
  } catch (error) {
    console.error('Error in estimated-load endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to calculate estimated load' },
      { status: 500 }
    );
  }
}

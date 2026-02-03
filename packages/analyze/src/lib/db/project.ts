import { Project } from '../types.js';
type Sqlite3Module = typeof import('sqlite3');

export async function getProjectsByTag(db: InstanceType<Sqlite3Module['Database']>, tag: string): Promise<Project[]> {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM projects WHERE tags LIKE ? ORDER BY name',
      [`%${tag}%`],
      (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as Project[]);
        }
      }
    );
  });
}

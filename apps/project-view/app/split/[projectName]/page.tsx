'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ProjectFile, ProjectMetrics } from '@/lib/db';
import SplitView from '@/components/SplitView';

export default function SplitPage() {
  const params = useParams();
  const router = useRouter();
  const projectName = decodeURIComponent(params.projectName as string);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [projectMetrics, setProjectMetrics] = useState<ProjectMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [projectName]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [filesRes, projectsRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(projectName)}/files`),
        fetch('/api/projects?commitCount=100'),
      ]);

      if (!filesRes.ok || !projectsRes.ok) throw new Error('Failed to fetch');

      const filesData = await filesRes.json();
      const projectsData = await projectsRes.json();
      const project = projectsData.find((p: ProjectMetrics) => p.name === projectName);

      setFiles(filesData);
      setProjectMetrics(project || null);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div>Loading project files...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: '16px' }}>
        <button onClick={() => router.push('/')} style={{ marginBottom: '8px' }}>
          ← Back to Projects
        </button>
        <h1>{projectName}</h1>
        {projectMetrics && (
          <p style={{ marginTop: '8px', color: '#666' }}>
            Estimated Load: {projectMetrics.load ?? 0}
          </p>
        )}
      </div>
      <SplitView files={files} projectName={projectName} />
    </div>
  );
}

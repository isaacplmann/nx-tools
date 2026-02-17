'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectMetrics } from '@/lib/db';

type SortField = 'name' | 'touched_count' | 'dependent_count' | 'load' | 'affected_count';
type SortDirection = 'asc' | 'desc';

export default function Home() {
  const [projects, setProjects] = useState<ProjectMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('load');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const router = useRouter();

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/projects?commitCount=100');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setProjects(data);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedProjects = [...projects].sort((a, b) => {
    const aVal = a[sortField] ?? 0;
    const bVal = b[sortField] ?? 0;
    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleSplit = (projectName: string) => {
    router.push(`/split/${encodeURIComponent(projectName)}`);
  };

  if (loading) {
    return (
      <div className="loading">
        <div>Loading project metrics...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '24px' }}>Project Metrics</h1>
      <table>
        <thead>
          <tr>
            <th onClick={() => handleSort('name')}>
              Name {sortField === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('touched_count')}>
              Touched Count {sortField === 'touched_count' && (sortDirection === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('dependent_count')}>
              Dependents {sortField === 'dependent_count' && (sortDirection === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('load')}>
              Load {sortField === 'load' && (sortDirection === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('affected_count')}>
              Affected Count {sortField === 'affected_count' && (sortDirection === 'asc' ? '↑' : '↓')}
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedProjects.map((project) => (
            <tr key={project.name}>
              <td>{project.name}</td>
              <td>{project.touched_count ?? 0}</td>
              <td>{project.dependent_count ?? 0}</td>
              <td>{project.load ?? 0}</td>
              <td>{project.affected_count ?? 0}</td>
              <td>
                <button onClick={() => handleSplit(project.name)}>Split</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import type { ProjectFile } from '@/lib/db';

interface SplitViewProps {
  files: ProjectFile[];
  projectName: string;
}

interface FileWithDependents extends ProjectFile {
  dependents?: string[];
}

export default function SplitView({ files, projectName }: SplitViewProps) {
  const [leftFiles, setLeftFiles] = useState<FileWithDependents[]>([]);
  const [rightFiles, setRightFiles] = useState<FileWithDependents[]>([]);
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [allDependents, setAllDependents] = useState<Map<string, string[]>>(new Map());
  const [showOnlyWithDependents, setShowOnlyWithDependents] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initialize: put all files in left column
    setLeftFiles(files.map(f => ({ ...f })));
    setRightFiles([]);
    loadDependents();
  }, [files]);

  // Update SVG when files or hover state changes
  useEffect(() => {
    // Force re-render of SVG by updating a dummy state or using requestAnimationFrame
    if (svgRef.current && containerRef.current) {
      // SVG will re-render automatically when state changes
    }
  }, [leftFiles, rightFiles, hoveredFile, allDependents]);

  const loadDependents = async () => {
    const dependentsMap = new Map<string, string[]>();
    for (const file of files) {
      try {
        const response = await fetch(
          `/api/files/${encodeURIComponent(file.file_path)}/dependents`
        );
        if (response.ok) {
          const projects = await response.json();
          dependentsMap.set(file.file_path, projects);
        }
      } catch (error) {
        console.error(`Error loading dependents for ${file.file_path}:`, error);
      }
    }
    setAllDependents(dependentsMap);
    
    // Update files with dependents
    setLeftFiles(prev => prev.map(f => ({
      ...f,
      dependents: dependentsMap.get(f.file_path) || []
    })));
    setRightFiles(prev => prev.map(f => ({
      ...f,
      dependents: dependentsMap.get(f.file_path) || []
    })));
  };

  const moveToRight = (filePath: string) => {
    const file = leftFiles.find(f => f.file_path === filePath);
    if (file) {
      setLeftFiles(prev => prev.filter(f => f.file_path !== filePath));
      setRightFiles(prev => [...prev, { ...file, dependents: allDependents.get(filePath) || [] }]);
    }
  };

  const moveToLeft = (filePath: string) => {
    const file = rightFiles.find(f => f.file_path === filePath);
    if (file) {
      setRightFiles(prev => prev.filter(f => f.file_path !== filePath));
      setLeftFiles(prev => [...prev, { ...file, dependents: allDependents.get(filePath) || [] }]);
    }
  };

  // Get unique projects that depend on files in each column
  const getLeftDependents = () => {
    const projects = new Set<string>();
    const source = showOnlyWithDependents
      ? leftFiles.filter(f => (f.dependents?.length || 0) > 0)
      : leftFiles;
    source.forEach(file => {
      (file.dependents || []).forEach(proj => projects.add(proj));
    });
    return Array.from(projects);
  };

  const getRightDependents = () => {
    const projects = new Set<string>();
    const source = showOnlyWithDependents
      ? rightFiles.filter(f => (f.dependents?.length || 0) > 0)
      : rightFiles;
    source.forEach(file => {
      (file.dependents || []).forEach(proj => projects.add(proj));
    });
    return Array.from(projects);
  };

  const getBothDependents = () => {
    const left = new Set(getLeftDependents());
    const right = new Set(getRightDependents());
    const both = new Set<string>();
    left.forEach(proj => {
      if (right.has(proj)) both.add(proj);
    });
    return Array.from(both);
  };

  const leftDependents = getLeftDependents().filter(p => !getBothDependents().includes(p));
  const rightDependents = getRightDependents().filter(p => !getBothDependents().includes(p));
  const bothDependents = getBothDependents();

  const visibleLeftFiles = showOnlyWithDependents
    ? leftFiles.filter(f => (f.dependents?.length || 0) > 0)
    : leftFiles;
  const visibleRightFiles = showOnlyWithDependents
    ? rightFiles.filter(f => (f.dependents?.length || 0) > 0)
    : rightFiles;

  // Calculate positions for drawing lines
  const getFilePosition = (
    filePath: string,
    side: 'leftEdge' | 'rightEdge'
  ): { x: number; y: number } | null => {
    if (!containerRef.current) return null;
    const container = containerRef.current;
    const fileElement = container.querySelector(
      `[data-file-path="${CSS.escape(filePath)}"]`
    ) as HTMLElement;
    if (!fileElement) return null;
    
    const rect = fileElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const x =
      side === 'leftEdge'
        ? rect.left - containerRect.left
        : rect.right - containerRect.left;

    return {
      x,
      y: rect.top + rect.height / 2 - containerRect.top,
    };
  };

  const getProjectPosition = (projectName: string, side: 'left' | 'right' | 'both'): { x: number; y: number } | null => {
    if (!containerRef.current) return null;
    const container = containerRef.current;
    const projectElement = container.querySelector(
      `[data-project-name="${CSS.escape(projectName)}"]`
    ) as HTMLElement;
    if (!projectElement) return null;
    
    const rect = projectElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    let x: number;
    if (side === 'left') {
      // Project is on the left side of the container, line should leave from its right edge
      x = rect.right - containerRect.left;
    } else if (side === 'right') {
      // Project is on the right side of the container, line should leave from its left edge
      x = rect.left - containerRect.left;
    } else {
      // Project is between columns, line should start from its horizontal center
      x = rect.left - containerRect.left + rect.width / 2;
    }

    return {
      x,
      y: rect.top + rect.height / 2 - containerRect.top,
    };
  };

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        position: 'relative',
        overflow: 'auto',
        gap: '24px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 16,
          zIndex: 3,
          background: 'rgba(255, 255, 255, 0.9)',
          borderRadius: '4px',
          padding: '4px 8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <input
          id="show-only-with-dependents"
          type="checkbox"
          checked={showOnlyWithDependents}
          onChange={e => setShowOnlyWithDependents(e.target.checked)}
        />
        <label
          htmlFor="show-only-with-dependents"
          style={{ fontSize: '11px', cursor: 'pointer', userSelect: 'none' }}
        >
          Only show files with dependents
        </label>
      </div>

      <svg
        ref={svgRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        {/* Draw lines from left dependents to left files */}
        {leftDependents.map(project => {
          const projPos = getProjectPosition(project, 'left');
          if (!projPos) return null;
          return visibleLeftFiles.map(file => {
            const filePos = getFilePosition(file.file_path, 'leftEdge');
            if (!filePos || !file.dependents?.includes(project)) return null;
            const isHighlighted = hoveredFile === file.file_path;
            return (
              <line
                key={`${project}-${file.file_path}`}
                x1={projPos.x}
                y1={projPos.y}
                x2={filePos.x}
                y2={filePos.y}
                stroke={isHighlighted ? '#0070f3' : '#ccc'}
                strokeWidth={isHighlighted ? 2 : 1}
                opacity={isHighlighted ? 1 : 0.5}
              />
            );
          });
        })}

        {/* Draw lines from right dependents to right files */}
        {rightDependents.map(project => {
          const projPos = getProjectPosition(project, 'right');
          if (!projPos) return null;
          return visibleRightFiles.map(file => {
            const filePos = getFilePosition(file.file_path, 'rightEdge');
            if (!filePos || !file.dependents?.includes(project)) return null;
            const isHighlighted = hoveredFile === file.file_path;
            return (
              <line
                key={`${project}-${file.file_path}`}
                x1={projPos.x}
                y1={projPos.y}
                x2={filePos.x}
                y2={filePos.y}
                stroke={isHighlighted ? '#0070f3' : '#ccc'}
                strokeWidth={isHighlighted ? 2 : 1}
                opacity={isHighlighted ? 1 : 0.5}
              />
            );
          });
        })}

        {/* Draw lines from both dependents to files in both columns */}
        {bothDependents.map(project => {
          const projPos = getProjectPosition(project, 'both');
          if (!projPos) return null;
          return [...visibleLeftFiles, ...visibleRightFiles].map(file => {
            const isLeft = visibleLeftFiles.some(f => f.file_path === file.file_path);
            const filePos = getFilePosition(
              file.file_path,
              isLeft ? 'rightEdge' : 'leftEdge'
            );
            if (!filePos || !file.dependents?.includes(project)) return null;
            const isHighlighted = hoveredFile === file.file_path;
            return (
              <line
                key={`${project}-${file.file_path}`}
                x1={projPos.x}
                y1={projPos.y}
                x2={filePos.x}
                y2={filePos.y}
                stroke={isHighlighted ? '#0070f3' : '#999'}
                strokeWidth={isHighlighted ? 2 : 1}
                opacity={isHighlighted ? 1 : 0.6}
              />
            );
          });
        })}
      </svg>

      {/* Left dependents */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          minWidth: '200px',
          zIndex: 2,
        }}
      >
        <h3 style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
          Left Dependents
        </h3>
        {leftDependents.map(project => (
          <div
            key={project}
            data-project-name={project}
            style={{
              padding: '8px',
              background: '#f0f0f0',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            {project}
          </div>
        ))}
      </div>

      {/* Left column */}
      <div
        className="left-column"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          zIndex: 2,
        }}
      >
        <h3 style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
          Left Column ({visibleLeftFiles.length})
        </h3>
        {visibleLeftFiles.map(file => (
          <div
            key={file.file_path}
            data-file-path={file.file_path}
            onMouseEnter={() => setHoveredFile(file.file_path)}
            onMouseLeave={() => setHoveredFile(null)}
            style={{
              padding: '8px',
              background: hoveredFile === file.file_path ? '#e3f2fd' : '#fff',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '12px', flex: 1 }}>{file.file_path}</span>
            <button
              onClick={() => moveToRight(file.file_path)}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              →
            </button>
          </div>
        ))}
      </div>

      {/* Both dependents (between columns) */}
      {bothDependents.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            minWidth: '200px',
            zIndex: 2,
          }}
        >
          <h3 style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
            Both Columns
          </h3>
          {bothDependents.map(project => (
            <div
              key={project}
              data-project-name={project}
              style={{
                padding: '8px',
                background: '#fff3cd',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              {project}
            </div>
          ))}
        </div>
      )}

      {/* Right column */}
      <div
        className="right-column"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          zIndex: 2,
        }}
      >
        <h3 style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
          Right Column ({visibleRightFiles.length})
        </h3>
        {visibleRightFiles.map(file => (
          <div
            key={file.file_path}
            data-file-path={file.file_path}
            onMouseEnter={() => setHoveredFile(file.file_path)}
            onMouseLeave={() => setHoveredFile(null)}
            style={{
              padding: '8px',
              background: hoveredFile === file.file_path ? '#e3f2fd' : '#fff',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <button
              onClick={() => moveToLeft(file.file_path)}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              ←
            </button>
            <span style={{ fontSize: '12px', flex: 1, textAlign: 'right' }}>
              {file.file_path}
            </span>
          </div>
        ))}
      </div>

      {/* Right dependents */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          minWidth: '200px',
          zIndex: 2,
        }}
      >
        <h3 style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
          Right Dependents
        </h3>
        {rightDependents.map(project => (
          <div
            key={project}
            data-project-name={project}
            style={{
              padding: '8px',
              background: '#f0f0f0',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            {project}
          </div>
        ))}
      </div>
    </div>
  );
}

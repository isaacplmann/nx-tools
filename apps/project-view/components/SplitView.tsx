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
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ type: 'file' | 'project'; value: string } | null>(null);
  const [allDependents, setAllDependents] = useState<Map<string, string[]>>(new Map());
  const [showOnlyWithDependents, setShowOnlyWithDependents] = useState(true);
  const [svgUpdateKey, setSvgUpdateKey] = useState(0);
  const [leftEstimatedLoad, setLeftEstimatedLoad] = useState<number>(0);
  const [rightEstimatedLoad, setRightEstimatedLoad] = useState<number>(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initialize: put all files in left column
    setLeftFiles(files.map(f => ({ ...f })));
    setRightFiles([]);
    loadDependents();
  }, [files]);

  // Handle click outside to deselect
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSelectedItem(null);
      }
    };

    if (selectedItem) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [selectedItem]);

  // Resize SVG to cover full scrollable content so lines draw even off-screen
  useEffect(() => {
    const updateSvgSize = () => {
      const svg = svgRef.current;
      const container = containerRef.current;
      if (!svg || !container) return;
      const w = container.scrollWidth;
      const h = container.scrollHeight;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.style.width = `${w}px`;
      svg.style.height = `${h}px`;
    };

    updateSvgSize();
    const container = containerRef.current;
    window.addEventListener('resize', updateSvgSize);
    if (container) container.addEventListener('scroll', updateSvgSize);
    const obs = new MutationObserver(() => requestAnimationFrame(updateSvgSize));
    if (container) obs.observe(container, { childList: true, subtree: true });
    return () => {
      window.removeEventListener('resize', updateSvgSize);
      if (container) container.removeEventListener('scroll', updateSvgSize);
      obs.disconnect();
    };
  }, [leftFiles, rightFiles, allDependents]);

  // Force SVG to recalculate line positions after DOM has been updated
  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      setSvgUpdateKey(prev => prev + 1);
    });
    return () => cancelAnimationFrame(timer);
  }, [leftFiles, rightFiles]);

  const loadDependents = async () => {
    try {
      const filePaths = files.map(f => f.file_path);
      if (filePaths.length === 0) return;

      const query = new URLSearchParams();
      filePaths.forEach(fp => query.append('filePaths[]', fp));
      
      const response = await fetch(
        `/api/project-dependency-map-for-files?${query.toString()}`
      );
      if (response.ok) {
        const dependentsMap: Record<string, string[]> = await response.json();
        setAllDependents(new Map(Object.entries(dependentsMap)));
        
        // Update files with dependents
        setLeftFiles(prev => prev.map(f => ({
          ...f,
          dependents: dependentsMap[f.file_path] || []
        })));
        setRightFiles(prev => prev.map(f => ({
          ...f,
          dependents: dependentsMap[f.file_path] || []
        })));
      }
    } catch (error) {
      console.error('Error loading dependents:', error);
    }
  };

  const fetchEstimatedLoad = async (filePaths: string[]) => {
    if (filePaths.length === 0) return 0;
    try {
      const query = new URLSearchParams();
      filePaths.forEach(fp => query.append('filePaths[]', fp));
      
      const response = await fetch(
        `/api/estimated-load?${query.toString()}`
      );
      if (response.ok) {
        const data = await response.json();
        return data.estimatedLoad || 0;
      }
    } catch (error) {
      console.error('Error fetching estimated load:', error);
    }
    return 0;
  };

  // Update left estimated load when leftFiles change
  useEffect(() => {
    const updateLeftLoad = async () => {
      const load = await fetchEstimatedLoad(leftFiles.map(f => f.file_path));
      setLeftEstimatedLoad(load);
    };
    updateLeftLoad();
  }, [leftFiles]);

  // Update right estimated load when rightFiles change
  useEffect(() => {
    const updateRightLoad = async () => {
      const load = await fetchEstimatedLoad(rightFiles.map(f => f.file_path));
      setRightEstimatedLoad(load);
    };
    updateRightLoad();
  }, [rightFiles]);

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

  const moveAllFilesFromProjectToRight = (project: string) => {
    // Get all files currently in left column that are connected to this project
    const filesToMove = leftFiles.filter(f => f.dependents?.includes(project));
    
    // Remove them from left and add to right
    setLeftFiles(prev => prev.filter(f => !filesToMove.some(tm => tm.file_path === f.file_path)));
    setRightFiles(prev => [
      ...prev,
      ...filesToMove.map(f => ({ ...f, dependents: f.dependents }))
    ]);
  };

  const moveAllFilesFromProjectToLeft = (project: string) => {
    // Get all files currently in right column that are connected to this project
    const filesToMove = rightFiles.filter(f => f.dependents?.includes(project));
    
    // Remove them from right and add to left
    setRightFiles(prev => prev.filter(f => !filesToMove.some(tm => tm.file_path === f.file_path)));
    setLeftFiles(prev => [
      ...prev,
      ...filesToMove.map(f => ({ ...f, dependents: f.dependents }))
    ]);
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

    const xBase = side === 'leftEdge' ? rect.left : rect.right;
    const x = xBase - containerRect.left + container.scrollLeft;
    const y = rect.top + rect.height / 2 - containerRect.top + container.scrollTop;

    return { x, y };
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

    let xBase: number;
    if (side === 'left') {
      xBase = rect.right;
    } else if (side === 'right') {
      xBase = rect.left;
    } else {
      xBase = rect.left + rect.width / 2;
    }

    const x = xBase - containerRect.left + container.scrollLeft;
    const y = rect.top + rect.height / 2 - containerRect.top + container.scrollTop;

    return { x, y };
  };

  // Determine which file/project should be highlighted
  const getHighlightedFile = () => selectedItem?.type === 'file' ? selectedItem.value : hoveredFile;
  const getHighlightedProject = () => selectedItem?.type === 'project' ? selectedItem.value : hoveredProject;

  // When something is selected, hover should not affect anything else
  const shouldShowHover = (item: string, type: 'file' | 'project') => {
    if (selectedItem) return selectedItem.type === type && selectedItem.value === item;
    return (type === 'file' ? hoveredFile === item : hoveredProject === item);
  };

  const handleFileClick = (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    setSelectedItem({ type: 'file', value: filePath });
  };

  const handleProjectClick = (e: React.MouseEvent, project: string) => {
    e.stopPropagation();
    setSelectedItem({ type: 'project', value: project });
  };

  const handleContainerClick = () => {
    setSelectedItem(null);
  };

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      style={{
        flex: 1,
        display: 'flex',
        position: 'relative',
        overflow: 'auto',
        gap: '24px',
      }}
    >
      

      <svg
        key={svgUpdateKey}
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
            const isHighlighted = getHighlightedFile() === file.file_path || getHighlightedProject() === project;
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
            const isHighlighted = getHighlightedFile() === file.file_path || getHighlightedProject() === project;
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
            const isHighlighted = getHighlightedFile() === file.file_path || getHighlightedProject() === project;
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
        {leftDependents.map(project => {
          const isProjHighlighted = hoveredProject === project || (hoveredFile && allDependents.get(hoveredFile || '')?.includes(project));
          const isSelected = selectedItem?.type === 'project' && selectedItem.value === project;
          const isConnectedToSelectedFile = selectedItem?.type === 'file' && allDependents.get(selectedItem.value)?.includes(project);
          const shouldHighlight = isSelected || isConnectedToSelectedFile || (!selectedItem && isProjHighlighted);
          return (
            <div
              key={project}
              data-project-name={project}
              onClick={(e) => handleProjectClick(e, project)}
              onMouseEnter={() => hoveredProject !== project && !selectedItem && setHoveredProject(project)}
              onMouseLeave={() => !selectedItem && setHoveredProject(null)}
              style={{
                padding: '8px',
                background: shouldHighlight ? '#e3f2fd' : '#f0f0f0',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span style={{ flex: 1 }}>{project}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  moveAllFilesFromProjectToRight(project);
                }}
                style={{ padding: '4px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                title={`Move all files connected to ${project} to the right`}
              >
                →
              </button>
            </div>
          );
        })}
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
        <div>
          <h3 style={{ marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>
            Left Column ({visibleLeftFiles.length})
          </h3>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666' }}>
            Estimated Load: {leftEstimatedLoad}
          </p>
        </div>
        {visibleLeftFiles.map(file => {
          const isFileSelected = selectedItem?.type === 'file' && selectedItem.value === file.file_path;
          const isConnectedToSelectedProject = selectedItem?.type === 'project' && file.dependents?.includes(selectedItem.value);
          const isFileHovered = !selectedItem && (hoveredFile === file.file_path || (hoveredProject && file.dependents?.includes(hoveredProject)));
          return (
          <div
            key={file.file_path}
            data-file-path={file.file_path}
            onClick={(e) => handleFileClick(e, file.file_path)}
            onMouseEnter={() => file.file_path !== hoveredFile && !selectedItem && setHoveredFile(file.file_path)}
            onMouseLeave={() => !selectedItem && setHoveredFile(null)}
            style={{
              padding: '8px',
              background: isFileSelected || isConnectedToSelectedProject || isFileHovered ? '#e3f2fd' : '#fff',
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
        ); })}
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
          {bothDependents.map(project => {
            const isProjHighlighted = hoveredProject === project || (hoveredFile && allDependents.get(hoveredFile || '')?.includes(project));
            const isSelected = selectedItem?.type === 'project' && selectedItem.value === project;
            const isConnectedToSelectedFile = selectedItem?.type === 'file' && allDependents.get(selectedItem.value)?.includes(project);
            const shouldHighlight = isSelected || isConnectedToSelectedFile || (!selectedItem && isProjHighlighted);
            return (
              <div
                key={project}
                data-project-name={project}
                onClick={(e) => handleProjectClick(e, project)}
                onMouseEnter={() => hoveredProject !== project && !selectedItem && setHoveredProject(project)}
                onMouseLeave={() => !selectedItem && setHoveredProject(null)}
                style={{
                  padding: '8px',
                  background: shouldHighlight ? '#e3f2fd' : '#fff3cd',
                  borderRadius: '4px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <span>{project}</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      moveAllFilesFromProjectToLeft(project);
                    }}
                    style={{ padding: '4px 8px', fontSize: '11px', flex: 1 }}
                    title={`Move all files connected to ${project} to the left`}
                  >
                    ←
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      moveAllFilesFromProjectToRight(project);
                    }}
                    style={{ padding: '4px 8px', fontSize: '11px', flex: 1 }}
                    title={`Move all files connected to ${project} to the right`}
                  >
                    →
                  </button>
                </div>
              </div>
            );
          })}
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
        <div>
          <h3 style={{ marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>
            Right Column ({visibleRightFiles.length})
          </h3>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666' }}>
            Estimated Load: {rightEstimatedLoad}
          </p>
        </div>
        {visibleRightFiles.map(file => {
          const isFileSelected = selectedItem?.type === 'file' && selectedItem.value === file.file_path;
          const isConnectedToSelectedProject = selectedItem?.type === 'project' && file.dependents?.includes(selectedItem.value);
          const isFileHovered = !selectedItem && (hoveredFile === file.file_path || (hoveredProject && file.dependents?.includes(hoveredProject)));
          return (
          <div
            key={file.file_path}
            data-file-path={file.file_path}
            onClick={(e) => handleFileClick(e, file.file_path)}
            onMouseEnter={() => file.file_path !== hoveredFile && !selectedItem && setHoveredFile(file.file_path)}
            onMouseLeave={() => !selectedItem && setHoveredFile(null)}
            style={{
              padding: '8px',
              background: isFileSelected || isConnectedToSelectedProject || isFileHovered ? '#e3f2fd' : '#fff',
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
        ); })}
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
        <div style={{ padding: '4px 0' }}>
          <input
            id="show-only-with-dependents"
            type="checkbox"
            checked={showOnlyWithDependents}
            onChange={e => setShowOnlyWithDependents(e.target.checked)}
          />
          <label
            htmlFor="show-only-with-dependents"
            style={{ marginLeft: 6, fontSize: '11px', cursor: 'pointer', userSelect: 'none' }}
          >
            Only show files with dependents
          </label>
        </div>
        <h3 style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
          Right Dependents
        </h3>
        {rightDependents.map(project => {
          const isProjHighlighted = hoveredProject === project || (hoveredFile && allDependents.get(hoveredFile || '')?.includes(project));
          const isSelected = selectedItem?.type === 'project' && selectedItem.value === project;
          const isConnectedToSelectedFile = selectedItem?.type === 'file' && allDependents.get(selectedItem.value)?.includes(project);
          const shouldHighlight = isSelected || isConnectedToSelectedFile || (!selectedItem && isProjHighlighted);
          return (
            <div
              key={project}
              data-project-name={project}
              onClick={(e) => handleProjectClick(e, project)}
              onMouseEnter={() => hoveredProject !== project && !selectedItem && setHoveredProject(project)}
              onMouseLeave={() => !selectedItem && setHoveredProject(null)}
              style={{
                padding: '8px',
                background: shouldHighlight ? '#e3f2fd' : '#f0f0f0',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  moveAllFilesFromProjectToLeft(project);
                }}
                style={{ padding: '4px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                title={`Move all files connected to ${project} to the left`}
              >
                ←
              </button>
              <span style={{ flex: 1, textAlign: 'right' }}>{project}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

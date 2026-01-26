import {
  CreateDependencies,
  CreateNodesV2,
  createNodesFromFiles,
  DependencyType,
  validateDependency,
} from '@nx/devkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const createDependencies: CreateDependencies = (opts, ctx) => {
  const packageJsonProjectMap = new Map();
  const nxProjects = Object.values(ctx.projects);
  console.log(
    JSON.stringify(
      ctx.fileMap.projectFileMap['movies-feature-detail-page'],
      undefined,
      2
    )
  );
  //   const results = [];
  //   for (const project of nxProjects) {
  //     const maybePackageJsonPath = join(project.root, 'package.json');
  //     if (existsSync(maybePackageJsonPath)) {
  //       const json = JSON.parse(maybePackageJsonPath);
  //       packageJsonProjectMap.set(json.name, project.name);
  //     }
  //   }
  //   for (const project of nxProjects) {
  //     const maybePackageJsonPath = join(project.root, 'package.json');
  //     if (existsSync(maybePackageJsonPath)) {
  //       const json = JSON.parse(maybePackageJsonPath);
  //       const deps = [...Object.keys(json.dependencies)];
  //       for (const dep of deps) {
  //         if (packageJsonProjectMap.has(dep)) {
  //           const newDependency = {
  //             type: 'static' as DependencyType.static,
  //             source: project.name || '',
  //             target: packageJsonProjectMap.get(dep),
  //             sourceFile: maybePackageJsonPath,
  //             dependencyType: DependencyType.static,
  //           };
  //           validateDependency(newDependency, ctx);
  //           results.push(newDependency);
  //         }
  //       }
  //     }
  //   }
  //   return results;
  return [];
};

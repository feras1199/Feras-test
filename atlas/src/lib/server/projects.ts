import "server-only";
import type { Repository } from "../data/repository";
import { HttpError } from "./api";

export async function getProject(repo: Repository, id: string) {
  const p = await repo.get("projects", id);
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

export async function assertComponent(repo: Repository, projectId: string, componentId?: string) {
  if (!componentId) return [];
  const c = await repo.get("components", componentId);
  if (!c || !c.projectIds?.includes(projectId)) throw new HttpError(400, "That component isn't part of this project");
  return [c.id];
}

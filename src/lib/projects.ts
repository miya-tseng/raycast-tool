import { Application, getPreferenceValues, open, showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { access, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface ProjectPreferences {
  projectsDirectory: string;
  editor?: Application;
}

const SOLUTION_EXTENSIONS = [".sln", ".slnx"];
const RIDER_BUNDLE_ID = "com.jetbrains.rider";
const DEFAULT_PROJECTS_DIRECTORY = "~/Project";

export function expandHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

export function getProjectsDirectory(): string {
  const { projectsDirectory } = getPreferenceValues<ProjectPreferences>();
  return expandHome(projectsDirectory || DEFAULT_PROJECTS_DIRECTORY);
}

export function getEditor(): Application | undefined {
  return getPreferenceValues<ProjectPreferences>().editor;
}

export function getEditorName(editor: Application | undefined): string {
  return editor?.name ?? "Rider";
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findSolution(projectPath: string): Promise<string | undefined> {
  try {
    const files = await readdir(projectPath);
    const solution = files
      .filter((file) => SOLUTION_EXTENSIONS.some((extension) => file.endsWith(extension)))
      .sort()
      .at(0);
    return solution ? join(projectPath, solution) : undefined;
  } catch {
    return undefined;
  }
}

function isRider(editor: Application | undefined): boolean {
  return !editor || editor.bundleId === RIDER_BUNDLE_ID;
}

export async function openInEditor(name: string, path: string, solutionPath: string | undefined) {
  const editor = getEditor();
  const target = isRider(editor) && solutionPath ? solutionPath : path;
  try {
    await open(target, editor ?? RIDER_BUNDLE_ID);
    await showHUD(`Opening ${name} in ${getEditorName(editor)}`);
  } catch (error) {
    await showFailureToast(error, { title: `Failed to open ${name}` });
  }
}

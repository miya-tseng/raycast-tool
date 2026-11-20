import { Action, ActionPanel, Application, Icon, List, getPreferenceValues, open, showHUD } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

interface Preferences {
  projectsDirectory: string;
  editor?: Application;
}

interface Project {
  name: string;
  path: string;
  solutionPath?: string;
  modifiedAt: number;
}

const SOLUTION_EXTENSIONS = [".sln", ".slnx"];
const RIDER_BUNDLE_ID = "com.jetbrains.rider";

function expandHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

async function findSolution(projectPath: string): Promise<string | undefined> {
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

async function loadProjects(rootDirectory: string): Promise<Project[]> {
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));

  const projects = await Promise.all(
    directories.map(async (directory) => {
      const path = join(rootDirectory, directory.name);
      const [stats, solutionPath] = await Promise.all([stat(path), findSolution(path)]);
      return { name: directory.name, path, solutionPath, modifiedAt: stats.mtimeMs };
    }),
  );

  return projects.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function isRider(editor: Application | undefined): boolean {
  return !editor || editor.bundleId === RIDER_BUNDLE_ID;
}

async function openProject(project: Project, editor: Application | undefined) {
  const target = isRider(editor) && project.solutionPath ? project.solutionPath : project.path;
  try {
    await open(target, editor ?? RIDER_BUNDLE_ID);
    await showHUD(`Opening ${project.name} in ${editor?.name ?? "Rider"}`);
  } catch (error) {
    await showFailureToast(error, { title: `Failed to open ${project.name}` });
  }
}

export default function Command() {
  const { projectsDirectory, editor } = getPreferenceValues<Preferences>();
  const rootDirectory = expandHome(projectsDirectory || "~/Project");
  const editorName = editor?.name ?? "Rider";

  const { data: projects, isLoading, revalidate } = useCachedPromise(loadProjects, [rootDirectory], {
    onError: (error) => showFailureToast(error, { title: `Cannot read ${rootDirectory}` }),
  });

  return (
    <List isLoading={isLoading} searchBarPlaceholder={`Search projects in ${rootDirectory}`}>
      <List.EmptyView icon={Icon.Folder} title="No projects found" description={rootDirectory} />
      {projects?.map((project) => (
        <List.Item
          key={project.path}
          icon={{ fileIcon: project.path }}
          title={project.name}
          subtitle={project.solutionPath ? project.solutionPath.split("/").at(-1) : undefined}
          accessories={[{ date: new Date(project.modifiedAt), tooltip: "Last modified" }]}
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action
                  title={`Open in ${editorName}`}
                  icon={Icon.Code}
                  onAction={() => openProject(project, editor)}
                />
                <Action.ShowInFinder path={project.path} />
                <Action.Open
                  title="Open in Terminal"
                  icon={Icon.Terminal}
                  target={project.path}
                  application="Terminal"
                  shortcut={{ modifiers: ["cmd"], key: "t" }}
                />
                <Action.OpenWith path={project.path} shortcut={{ modifiers: ["cmd"], key: "o" }} />
              </ActionPanel.Section>
              <ActionPanel.Section>
                <Action.CopyToClipboard
                  title="Copy Path"
                  content={project.path}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                />
                <Action
                  title="Reload Projects"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={revalidate}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

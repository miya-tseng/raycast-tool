import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { findSolution, getEditor, getEditorName, getProjectsDirectory, openInEditor } from "./lib/projects";

interface Project {
  name: string;
  path: string;
  solutionPath?: string;
  modifiedAt: number;
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

export default function Command() {
  const rootDirectory = getProjectsDirectory();
  const editorName = getEditorName(getEditor());

  const {
    data: projects,
    isLoading,
    revalidate,
  } = useCachedPromise(loadProjects, [rootDirectory], {
    onError: (error) => {
      showFailureToast(error, { title: `Cannot read ${rootDirectory}` });
    },
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
                  onAction={() => openInEditor(project.name, project.path, project.solutionPath)}
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

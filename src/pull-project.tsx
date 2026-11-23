import { Action, ActionPanel, Color, Icon, List, Toast, showToast } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { useState } from "react";
import { MAIN_BRANCH, getCurrentBranch, hasLocalChanges, pullMainBranch } from "./lib/git";
import { findSolution, getEditor, getEditorName, getProjectsDirectory, openInEditor, pathExists } from "./lib/projects";

interface Repository {
  name: string;
  path: string;
  branch?: string;
  isDirty: boolean;
  modifiedAt: number;
}

type PullState = { status: "pulling" } | { status: "done"; message: string } | { status: "failed"; message: string };

const PULL_ALL_CONCURRENCY = 4;

async function loadRepositories(rootDirectory: string): Promise<Repository[]> {
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));

  const repositories = await Promise.all(
    directories.map(async (directory): Promise<Repository | undefined> => {
      const path = join(rootDirectory, directory.name);
      if (!(await pathExists(join(path, ".git")))) return undefined;
      const [stats, branch, isDirty] = await Promise.all([stat(path), getCurrentBranch(path), hasLocalChanges(path)]);
      return { name: directory.name, path, branch, isDirty, modifiedAt: stats.mtimeMs };
    }),
  );

  return repositories
    .filter((repository): repository is Repository => repository !== undefined)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function pullStateAccessory(state: PullState | undefined): List.Item.Accessory[] {
  if (!state) return [];
  switch (state.status) {
    case "pulling":
      return [{ icon: Icon.CircleProgress, tooltip: "Pulling…" }];
    case "done":
      return [{ icon: { source: Icon.CheckCircle, tintColor: Color.Green }, tooltip: state.message }];
    case "failed":
      return [{ icon: { source: Icon.XMarkCircle, tintColor: Color.Red }, tooltip: state.message }];
  }
}

export default function Command() {
  const rootDirectory = getProjectsDirectory();
  const editorName = getEditorName(getEditor());
  const [pullStates, setPullStates] = useState<Record<string, PullState>>({});

  const {
    data: repositories,
    isLoading,
    revalidate,
  } = useCachedPromise(loadRepositories, [rootDirectory], {
    onError: (error) => {
      showFailureToast(error, { title: `Cannot read ${rootDirectory}` });
    },
  });

  function updatePullState(path: string, state: PullState) {
    setPullStates((previous) => ({ ...previous, [path]: state }));
  }

  async function pullOne(repository: Repository) {
    updatePullState(repository.path, { status: "pulling" });
    const toast = await showToast({ style: Toast.Style.Animated, title: `Pulling ${repository.name}…` });
    try {
      const message = await pullMainBranch(repository.path, repository.branch);
      updatePullState(repository.path, { status: "done", message });
      toast.style = Toast.Style.Success;
      toast.title = `${repository.name}: ${message}`;
      revalidate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updatePullState(repository.path, { status: "failed", message });
      toast.style = Toast.Style.Failure;
      toast.title = `Failed to pull ${repository.name}`;
      toast.message = message;
    }
  }

  async function pullAll() {
    if (!repositories?.length) return;
    const toast = await showToast({ style: Toast.Style.Animated, title: `Pulling ${repositories.length} projects…` });
    const queue = [...repositories];
    const failures: string[] = [];
    let completed = 0;

    async function worker() {
      for (let repository = queue.shift(); repository; repository = queue.shift()) {
        updatePullState(repository.path, { status: "pulling" });
        try {
          const message = await pullMainBranch(repository.path, repository.branch);
          updatePullState(repository.path, { status: "done", message });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          updatePullState(repository.path, { status: "failed", message });
          failures.push(repository.name);
        }
        completed += 1;
        toast.message = `${completed}/${repositories?.length}`;
      }
    }

    await Promise.all(Array.from({ length: PULL_ALL_CONCURRENCY }, worker));

    if (failures.length === 0) {
      toast.style = Toast.Style.Success;
      toast.title = `Pulled ${completed} projects`;
      toast.message = undefined;
    } else {
      toast.style = Toast.Style.Failure;
      toast.title = `${failures.length} of ${completed} failed`;
      toast.message = failures.join(", ");
    }
    revalidate();
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder={`Search git projects in ${rootDirectory}`}>
      <List.EmptyView icon={Icon.Folder} title="No git projects found" description={rootDirectory} />
      {repositories?.map((repository) => {
        const pullState = pullStates[repository.path];
        return (
          <List.Item
            key={repository.path}
            icon={{ fileIcon: repository.path }}
            title={repository.name}
            subtitle={pullState && pullState.status !== "pulling" ? pullState.message : undefined}
            accessories={[
              ...pullStateAccessory(pullState),
              ...(repository.isDirty
                ? [{ tag: { value: "modified", color: Color.Orange }, tooltip: "Has uncommitted changes" }]
                : []),
              { tag: { value: repository.branch ?? "unknown", color: Color.Blue }, icon: Icon.Code },
            ]}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action title={`Pull ${MAIN_BRANCH}`} icon={Icon.Download} onAction={() => pullOne(repository)} />
                  <Action
                    title={`Pull ${MAIN_BRANCH} for All Projects`}
                    icon={Icon.Repeat}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                    onAction={pullAll}
                  />
                  <Action
                    title={`Open in ${editorName}`}
                    icon={Icon.Code}
                    shortcut={{ modifiers: ["cmd"], key: "e" }}
                    onAction={async () =>
                      openInEditor(repository.name, repository.path, await findSolution(repository.path))
                    }
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action.ShowInFinder path={repository.path} />
                  <Action.Open
                    title="Open in Terminal"
                    icon={Icon.Terminal}
                    target={repository.path}
                    application="Terminal"
                    shortcut={{ modifiers: ["cmd"], key: "t" }}
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
        );
      })}
    </List>
  );
}

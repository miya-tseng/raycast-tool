import { Action, ActionPanel, Clipboard, Form, Icon, Toast, popToRoot, showToast } from "@raycast/api";
import { useForm } from "@raycast/utils";
import { useEffect, useState } from "react";
import { join } from "path";
import { looksLikeGitUrl, repositoryNameFromUrl, runGit } from "./lib/git";
import { findSolution, getEditor, getEditorName, getProjectsDirectory, openInEditor, pathExists } from "./lib/projects";

interface CloneFormValues {
  url: string;
  openAfterClone: boolean;
}

export default function Command() {
  const rootDirectory = getProjectsDirectory();
  const editorName = getEditorName(getEditor());
  const [isCloning, setIsCloning] = useState(false);

  const { handleSubmit, itemProps, setValue } = useForm<CloneFormValues>({
    initialValues: { url: "", openAfterClone: true },
    validation: {
      url: (value) => {
        if (!value?.trim()) return "Repository URL is required";
        if (!looksLikeGitUrl(value)) return "Not a valid git URL";
      },
    },
    onSubmit: async (formValues) => {
      const url = formValues.url.trim();
      const folderName = repositoryNameFromUrl(url);
      if (!folderName) {
        await showToast({ style: Toast.Style.Failure, title: "Cannot determine folder name" });
        return;
      }

      const destination = join(rootDirectory, folderName);
      if (await pathExists(destination)) {
        await showToast({ style: Toast.Style.Failure, title: `${folderName} already exists`, message: destination });
        return;
      }

      setIsCloning(true);
      const toast = await showToast({ style: Toast.Style.Animated, title: `Cloning ${folderName}…` });

      try {
        await runGit(["clone", url, destination], rootDirectory);
        toast.style = Toast.Style.Success;
        toast.title = `Cloned ${folderName}`;
        toast.message = destination;

        if (formValues.openAfterClone) {
          await openInEditor(folderName, destination, await findSolution(destination));
        }
        await popToRoot();
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = `Failed to clone ${folderName}`;
        toast.message = error instanceof Error ? error.message : String(error);
      } finally {
        setIsCloning(false);
      }
    },
  });

  useEffect(() => {
    Clipboard.readText().then((text) => {
      if (text && looksLikeGitUrl(text)) setValue("url", text.trim());
    });
  }, []);

  return (
    <Form
      isLoading={isCloning}
      navigationTitle="Clone Project"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Clone Project" icon={Icon.Download} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField {...itemProps.url} title="Repository URL" placeholder="git@github.com:owner/repo.git" autoFocus />
      <Form.Checkbox {...itemProps.openAfterClone} label={`Open in ${editorName} after clone`} />
      <Form.Description title="Clone Into" text={rootDirectory} />
    </Form>
  );
}

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const EXTRA_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
const GIT_TIMEOUT_MS = 10 * 60 * 1000;

function gitEnvironment(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: [...EXTRA_PATHS, currentPath].filter(Boolean).join(":"),
    GIT_TERMINAL_PROMPT: "0",
  };
}

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      env: gitEnvironment(),
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return (stdout || stderr).trim();
  } catch (error) {
    const failure = error as { stderr?: string; message: string };
    const detail = failure.stderr?.trim() || failure.message;
    throw new GitError(detail.split("\n").filter(Boolean).slice(-3).join("\n"));
  }
}

export function repositoryNameFromUrl(url: string): string | undefined {
  const cleaned = url
    .trim()
    .replace(/[/\\]+$/, "")
    .replace(/\.git$/, "");
  const name = cleaned.split(/[/:]/).at(-1);
  return name && name.length > 0 ? name : undefined;
}

export function looksLikeGitUrl(text: string): boolean {
  const value = text.trim();
  return /^(https?:\/\/|ssh:\/\/|git:\/\/|git@)[^\s]+$/.test(value);
}

export async function getCurrentBranch(repositoryPath: string): Promise<string | undefined> {
  try {
    const branch = await runGit(["branch", "--show-current"], repositoryPath);
    return branch || "detached";
  } catch {
    return undefined;
  }
}

export async function hasLocalChanges(repositoryPath: string): Promise<boolean> {
  try {
    const status = await runGit(["status", "--porcelain"], repositoryPath);
    return status.length > 0;
  } catch {
    return false;
  }
}

export function summarizePullOutput(output: string): string {
  if (/Already up to date/i.test(output)) return "Already up to date";
  const summaryLine = output.split("\n").find((line) => /files? changed/.test(line));
  return summaryLine?.trim() ?? "Updated";
}

export const MAIN_BRANCH = "main";

async function hasLocalBranch(repositoryPath: string, branch: string): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repositoryPath);
    return true;
  } catch {
    return false;
  }
}

export async function fetchAllBranches(repositoryPath: string): Promise<void> {
  await runGit(["fetch", "--prune", "origin"], repositoryPath);
}

async function revisionOf(repositoryPath: string, ref: string): Promise<string> {
  return runGit(["rev-parse", ref], repositoryPath);
}

export async function pullMainBranch(repositoryPath: string, currentBranch: string | undefined): Promise<string> {
  await fetchAllBranches(repositoryPath);

  if (!(await hasLocalBranch(repositoryPath, MAIN_BRANCH))) {
    throw new GitError(`No local ${MAIN_BRANCH} branch`);
  }

  const remoteMain = `origin/${MAIN_BRANCH}`;
  if (currentBranch === MAIN_BRANCH) {
    const output = await runGit(["merge", "--ff-only", remoteMain], repositoryPath);
    return summarizePullOutput(output);
  }

  const before = await revisionOf(repositoryPath, MAIN_BRANCH);
  await runGit(["fetch", ".", `${remoteMain}:${MAIN_BRANCH}`], repositoryPath);
  const after = await revisionOf(repositoryPath, MAIN_BRANCH);
  return before === after ? "Already up to date" : `Updated ${MAIN_BRANCH}`;
}

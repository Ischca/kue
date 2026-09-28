import type { ReportIssueOptions } from "./types";

type OpenReporter = (options?: ReportIssueOptions) => Promise<void>;

interface RegisteredHost {
  token: symbol;
  open: OpenReporter;
}

const hosts: RegisteredHost[] = [];

export class KueUnavailableError extends Error {
  constructor() {
    super("KUE is unavailable. Mount an enabled <Kue /> before calling reportIssue().");
    this.name = "KueUnavailableError";
  }
}

export function registerKueHost(open: OpenReporter): () => void {
  const host = { token: Symbol("kue-host"), open };

  if (hosts.length > 0) {
    console.warn(
      "[KUE] Multiple enabled <Kue /> hosts are mounted. reportIssue() will use the newest host.",
    );
  }

  hosts.push(host);

  return () => {
    const index = hosts.findIndex(({ token }) => token === host.token);
    if (index >= 0) {
      hosts.splice(index, 1);
    }
  };
}

export async function reportIssue(options: ReportIssueOptions = {}): Promise<void> {
  const activeHost = hosts.at(-1);
  if (!activeHost) {
    throw new KueUnavailableError();
  }

  await activeHost.open(options);
}

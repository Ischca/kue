type ReleaseImage = (uri: string) => void;

/** @internal Defers cache-file deletion while a submitter is still reading it. */
export class DeferredImageRelease {
  private pending = new Set<string>();
  private submissionCount = 0;

  release(uri: string, releaseImage: ReleaseImage): void {
    if (this.submissionCount > 0) {
      this.pending.add(uri);
      return;
    }

    releaseImage(uri);
  }

  setSubmitting(submitting: boolean, releaseImage: ReleaseImage): void {
    this.submissionCount = submitting
      ? this.submissionCount + 1
      : Math.max(0, this.submissionCount - 1);
    if (this.submissionCount > 0) return;

    for (const uri of this.pending) releaseImage(uri);
    this.pending.clear();
  }
}

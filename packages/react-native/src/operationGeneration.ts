/** @internal Identifies async work that still belongs to the currently active Reporter view. */
export class OperationGeneration {
  private active = false;
  private generation = 0;

  activate(): number {
    this.active = true;
    this.generation += 1;
    return this.generation;
  }

  current(): number | null {
    return this.active ? this.generation : null;
  }

  invalidate(generation?: number): void {
    if (generation !== undefined && !this.isActive(generation)) return;
    this.active = false;
    this.generation += 1;
  }

  isActive(generation: number): boolean {
    return this.active && this.generation === generation;
  }
}

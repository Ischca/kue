import type { File } from "expo-file-system";

// expo-file-system 56 made File.copy()/move() asynchronous and added copySync()/moveSync();
// 19–55 only have the synchronous copy()/move(). Callers rely on the file existing on return.
type Relocation = (destination: File) => unknown;
type Relocatable = { copy: Relocation; move: Relocation; copySync?: Relocation; moveSync?: Relocation };

export function copyFileSync(source: File, destination: File): void {
  const file = source as unknown as Relocatable;
  if (typeof file.copySync === "function") file.copySync(destination);
  else file.copy(destination);
}

export function moveFileSync(source: File, destination: File): void {
  const file = source as unknown as Relocatable;
  if (typeof file.moveSync === "function") file.moveSync(destination);
  else file.move(destination);
}

// Shared Design System types. Lived in DsSetupModal.tsx until the lab
// rewrite shipped — extracted here so the type survives deleting that file.

export interface DsEntry {
  name: string;
  path: string;
  designMdPath: string;
  source: "folder" | "github" | "upload" | "paste";
  sourceRef?: string;
  addedAt: number;
  /** Optional cover image saved next to design.md as cover.{ext}. */
  coverPath?: string;
  /** Absolute path to preview.html when the user has generated one via
   *  the Generate Preview modal. Surfaced by /fs/list-design-systems
   *  alongside coverPath. */
  previewPath?: string;
}

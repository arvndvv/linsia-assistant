import type { FileRef } from '../../../server/src/types.ts';
import { Drawer } from './Drawer.tsx';

/** Shows one stored document over the right side of the screen. */
export function Viewer({ file, onClose }: { file: FileRef; onClose: () => void }) {
  const src = `/files/${file.id}`;
  return (
    <Drawer
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-4">
          <span className="truncate">{file.name}</span>
          <a href={src} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-normal text-soft hover:text-white">
            Open in tab
          </a>
        </span>
      }
    >
      {file.mime === 'application/pdf' ? (
        <iframe src={src} title={file.name} className="h-full min-h-[70vh] w-full rounded-lg bg-white" />
      ) : (
        <img src={src} alt={file.name} className="mx-auto max-w-full rounded-lg" />
      )}
    </Drawer>
  );
}

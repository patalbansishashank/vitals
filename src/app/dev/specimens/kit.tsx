/**
 * Gallery kit for the r071 specimens (package 0B). The old gallery wraps every sheet in a Faceplate; these specimens ARE
 * cards (GradientCard) and a card never nests in a card, so a sheet here is a plain section on the page backdrop:
 * a heading, then specimens, each a name, a note and the thing itself at the size it has on Today.
 */
import type { ReactNode } from 'react';
import { MonoMeta } from '@/components';
import './specimens.css';

export function GallerySection({ id, title, caption, children }: { id: string; title: string; caption?: string; children: ReactNode }) {
  return (
    <section id={id} className="gal-section" aria-labelledby={`${id}-h`}>
      <header className="gal-section__head">
        <h2 id={`${id}-h`} className="gal-section__title">
          {title}
        </h2>
        {caption ? <MonoMeta>{caption}</MonoMeta> : null}
      </header>
      <div className="gal-section__body">{children}</div>
    </section>
  );
}

/** One specimen: its name, a one-line note, then the thing. `cols` sets how the things sit side by side. */
export function Spec({ name, note, cols, children }: { name: string; note?: ReactNode; cols?: 1 | 2 | 'tiles'; children: ReactNode }) {
  return (
    <div className="gal-spec" data-cols={cols ?? 1}>
      <div className="gal-spec__head">
        <span className="gal-spec__name">{name}</span>
        {note ? <span className="gal-spec__note">{note}</span> : null}
      </div>
      <div className="gal-spec__body">{children}</div>
    </div>
  );
}

/** Things in a row that wraps (keys, chips, small marks). */
export function Row({ children }: { children: ReactNode }) {
  return <div className="gal-row">{children}</div>;
}

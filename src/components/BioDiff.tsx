import { useMemo } from 'react';
import { diffText } from '../data/text-diff';
import './BioDiff.css';

export function BioDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffText(before, after), [before, after]);
  const changed = before !== after;
  return (
    <div className="bio-diff">
      {changed && (
        <div className="bio-diff-legend" aria-hidden="true">
          <span className="bio-diff-removed">− Удалено</span>
          <span className="bio-diff-added">+ Добавлено</span>
        </div>
      )}
      <p className="bio-diff-text">
        {parts.length
          ? parts.map((part, index) =>
              part.kind === 'equal' ? (
                <span key={index}>{part.text}</span>
              ) : part.kind === 'delete' ? (
                <del key={index}>
                  <span className="bio-diff-sr">Удалено: </span>
                  {part.text}
                  <span className="bio-diff-sr">. Конец удаления. </span>
                </del>
              ) : (
                <ins key={index}>
                  <span className="bio-diff-sr">Добавлено: </span>
                  {part.text}
                  <span className="bio-diff-sr">. Конец добавления. </span>
                </ins>
              ),
            )
          : 'Пустое описание.'}
      </p>
    </div>
  );
}

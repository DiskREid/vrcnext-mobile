import { t, useI18n } from '../i18n';
import { useMemo } from 'react';
import { diffText } from '../data/text-diff';
import './BioDiff.css';

export function BioDiff({ before, after }: { before: string; after: string }) {
  useI18n();
  const parts = useMemo(() => diffText(before, after), [before, after]);
  const changed = before !== after;
  return (
    <div className="bio-diff">
      {changed && (
        <div className="bio-diff-legend" aria-hidden="true">
          <span className="bio-diff-removed">{t('− Удалено')}</span>
          <span className="bio-diff-added">{t('+ Добавлено')}</span>
        </div>
      )}
      <p className="bio-diff-text">
        {parts.length
          ? parts.map((part, index) =>
              part.kind === 'equal' ? (
                <span key={index}>{part.text}</span>
              ) : part.kind === 'delete' ? (
                <del key={index}>
                  <span className="bio-diff-sr">{t('Удалено: ')}</span>
                  {part.text}
                  <span className="bio-diff-sr">{t('. Конец удаления. ')}</span>
                </del>
              ) : (
                <ins key={index}>
                  <span className="bio-diff-sr">{t('Добавлено: ')}</span>
                  {part.text}
                  <span className="bio-diff-sr">{t('. Конец добавления. ')}</span>
                </ins>
              ),
            )
          : t('Пустое описание.')}
      </p>
    </div>
  );
}

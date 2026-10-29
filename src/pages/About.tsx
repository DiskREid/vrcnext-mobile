import {
  ArrowUpRight,
  Check,
  Code2,
  ExternalLink,
  Heart,
  Info,
  Radio,
  Users,
  Waves,
} from 'lucide-react';
import { useApp, useLoad } from '../state';
import { isNative, native } from '../api/native';
import { PageHeader, Badge, Loading, ErrorState } from '../components/ui';
import { t, useI18n } from '../i18n';
import BrandLogo from '../components/BrandLogo';
import './About.css';

const BOOSTY_URL = 'https://boosty.to/mr.diskreid';
const SOURCE_URL = 'https://github.com/DiskREid/vrcnext-mobile';
const UPSTREAM_URL = 'https://github.com/shinyflvre/VRCNext';

function ProjectLink({
  url,
  children,
  className = 'text-button',
}: {
  url: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { notify } = useApp();
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(event) => {
        if (!isNative) return;
        event.preventDefault();
        void native
          .openLink({ url })
          .catch((error) =>
            notify(error instanceof Error ? error.message : t('Не удалось выполнить действие')),
          );
      }}
    >
      {children}
    </a>
  );
}

function LicenseText() {
  const data = useLoad(
    () =>
      fetch('/LICENSE.txt').then((response) => {
        if (!response.ok) throw Error(t('Не удалось загрузить лицензию'));
        return response.text();
      }),
    [],
  );
  return data.data ? (
    <pre className="license-text">{data.data}</pre>
  ) : data.error ? (
    <ErrorState error={t(data.error)} retry={data.reload} />
  ) : (
    <Loading />
  );
}

export default function AboutPage() {
  useI18n();
  return (
    <div className="about-page">
      <PageHeader
        eyebrow={t('СОЗДАНО ДЛЯ СВОИХ')}
        title={t('О проекте')}
        subtitle={t('Ваш мир VRChat — чуть ближе.')}
      />
      <section className="about-hero card">
        <div className="about-hero-orbit" aria-hidden="true">
          <Waves />
          <span />
          <i />
        </div>
        <div className="about-hero-copy">
          <div className="about-kicker">
            <BrandLogo /> VRCNext Mobile <Badge>0.4.4</Badge>
          </div>
          <h2>
            {t('Оставайтесь рядом.')}
            <br />
            {t('Даже вдали от VR.')}
          </h2>
          <p>
            {t(
              'Неофициальное Android-приложение для общения с вашим кругом VRChat: друзья, миры, группы, приглашения и коллекции — с телефона.',
            )}
          </p>
        </div>
        <div className="about-pill-row">
          <span>
            <Users size={14} />
            {t('Ваш круг')}
          </span>
          <span>
            <Radio size={14} />
            {t('Живые события')}
          </span>
          <span>
            <Check size={14} />
            {t('Открытый код')}
          </span>
        </div>
      </section>

      <div className="about-layout">
        <section className="about-creator card">
          <span className="about-section-icon">
            <Radio size={22} />
          </span>
          <p className="eyebrow">{t('ЗА ПРОЕКТОМ — ЧЕЛОВЕК')}</p>
          <h2>{t('Привет, я DiskREid')}</h2>
          <p>
            {t(
              'Я обычный стример, блогер и игрок в VRChat. Развиваю мобильную версию, чтобы друзья, знакомые миры и встречи были под рукой.',
            )}
          </p>
          <p className="muted">
            {t('Это личный проект, который растёт вместе с обратной связью игроков.')}
          </p>
        </section>

        <section className="about-support card">
          <span className="about-section-icon">
            <Heart size={22} />
          </span>
          <p className="eyebrow">{t('ЕСЛИ ХОЧЕТСЯ ПОДДЕРЖАТЬ')}</p>
          <h2>{t('Увидимся на Boosty')}</h2>
          <p>
            {t(
              'Если вам нравится то, что я делаю, поддержать меня и моё творчество можно на Boosty.',
            )}
          </p>
          <ProjectLink url={BOOSTY_URL} className="button primary about-support-button">
            {t('Поддержать DiskREid')}
            <ArrowUpRight size={18} />
          </ProjectLink>
          <span className="about-support-domain">
            boosty.to/mr.diskreid <ExternalLink size={12} />
          </span>
          <p className="muted small">{t('Поддержка добровольная. Ссылка откроется в браузере.')}</p>
        </section>
      </div>

      <section className="about-credits card">
        <span className="about-section-icon">
          <Code2 size={22} />
        </span>
        <h2>{t('Основа и благодарности')}</h2>
        <p>
          {t(
            'Мобильная версия основана на VRCNext от shinyflvre и участников VRCNext. Спасибо авторам оригинала и сообществу VRChat.',
          )}
        </p>
        <div className="about-project-links">
          <ProjectLink url={SOURCE_URL}>
            {t('Исходный код Mobile')}
            <ArrowUpRight size={16} />
          </ProjectLink>
          <ProjectLink url={UPSTREAM_URL}>
            {t('Оригинальный VRCNext')}
            <ArrowUpRight size={16} />
          </ProjectLink>
        </div>
        <div className="about-legal-note">
          <Info size={17} />
          <p>
            {t(
              'VRCNext Mobile — независимый неофициальный проект. Не связан с VRChat Inc. Возможности приложения зависят от доступности VRChat API.',
            )}
          </p>
        </div>
        <details className="about-license">
          <summary>{t('Лицензия VNCOL')}</summary>
          <p className="muted small">
            {t(
              'Некоммерческое использование. Все уведомления об авторских правах сохранены. Исходный проект изучен на коммите 0bfb467f.',
            )}
          </p>
          <LicenseText />
        </details>
      </section>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { useApp } from '../state';
import { historyLabels } from '../data/history';
import type { HistoryEvent, HistoryKind } from '../data/history';
import { ActivityWorldChange } from '../components/ActivityLinks';
import { BioDiff } from '../components/BioDiff';
import { HistoryAvatarSearch } from '../components/HistoryAvatarSearch';
import SecureImage from '../components/SecureImage';
import { AvatarImage, Badge, Empty, ErrorState, imageOf, Loading, PageHeader, SearchField, Segmented } from '../components/ui';
import './Feed.css';

function BioChanges({ before, after }: { before?: string; after?: string }) {
  const [opened, setOpened] = useState(false);
  return <details onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>Изменения Bio</summary>
    {opened && <BioDiff before={before || ''} after={after || ''} />}
  </details>;
}

function AvatarSide({ name, id, image, author, previous = false }: {
  name?: string; id?: string; image?: string; author?: string; previous?: boolean;
}) {
  const label = previous ? 'Предыдущий аватар' : 'Новый аватар';
  return <div className={`history-avatar-side history-avatar-${previous ? 'before' : 'after'}`} role="group" aria-label={label}>
    <span className="muted small history-avatar-side-label">{label}</span>
    {image && <SecureImage className="history-avatar-preview" src={image} alt={name || label} maxDimension={256} />}
    {name || id ? <HistoryAvatarSearch name={name} avatarId={id} /> : <span className="history-avatar-unknown">Название неизвестно</span>}
    {author && <span className="muted small history-avatar-author">Автор: {author}</span>}
  </div>;
}

function AvatarChange({ event }: { event: HistoryEvent }) {
  const previousId = event.previousAvatarId || (event.before?.startsWith('avtr_') ? event.before : undefined);
  const previousImage = event.previousAvatarUrl || (event.before?.startsWith('https://') ? event.before : undefined);
  const id = event.avatarId || (event.after?.startsWith('avtr_') ? event.after : undefined);
  const hasPrevious = !!(event.previousAvatarName || previousId || previousImage || event.previousAvatarFileId);
  if (hasPrevious) return <div className="history-avatar-transition" role="group" aria-label="Смена аватара">
    <AvatarSide previous name={event.previousAvatarName} id={previousId} image={previousImage} author={event.previousAvatarAuthorName} />
    <span className="history-avatar-arrow" aria-label="на">→</span>
    <AvatarSide name={event.avatarName} id={id} image={event.avatarUrl} author={event.avatarAuthorName} />
  </div>;
  return <div className="history-avatar-change">
    {event.avatarUrl && <SecureImage className="history-avatar-preview" src={event.avatarUrl} alt={event.avatarName || 'Обновлённое изображение аватара'} maxDimension={256} />}
    <div><HistoryAvatarSearch name={event.avatarName} avatarId={id} />
      {!event.avatarName && !id && <p>{event.detail}</p>}
      {event.avatarAuthorName && <p className="muted small">Автор: {event.avatarAuthorName}</p>}
    </div>
  </div>;
}

export function HistoryRows({ events, limit = 100 }: { events:HistoryEvent[];limit?:number }) {
  const ctx=useApp();
  const [visible,setVisible]=useState(limit);
  return <>
    <div className="history-list">
      {events.slice(0,visible).map((event)=>{
        const current=ctx.friends.data.find((friend)=>friend.id===event.userId);
        return <article className="card history-row" key={event.id}>
          <button className="history-person" onClick={()=>ctx.openUser(event.userId)} aria-label={`Открыть профиль ${event.displayName}`}>
            <AvatarImage src={(current && imageOf(current)) || event.avatarUrl} name={event.displayName} size={42}/>
          </button>
          <div className="history-body">
            <div className="history-heading"><button className="text-button" onClick={()=>ctx.openUser(event.userId)}>{event.displayName}</button><time dateTime={event.time}>{new Date(event.time).toLocaleString('ru',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></div>
            <Badge>{event.kind === 'avatar' && event.avatarEvidence === 'image' ? 'Изображение аватара' : historyLabels[event.kind]}</Badge>
            {(event.kind==='world' || event.kind==='instance') && (event.before!==undefined || event.after!==undefined || event.location!==undefined || event.worldId)
              ? <ActivityWorldChange before={event.before} after={event.after ?? event.location} worldId={event.worldId}/>
              : event.kind === 'avatar' ? <AvatarChange event={event} /> : event.kind === 'bio' ? <p className="history-bio-current">{event.after || 'Био очищено'}</p>
                : <p className="preserve-lines">{event.detail}</p>}
            {event.kind==='bio' && <BioChanges before={event.before} after={event.after} />}
            {event.worldId && event.kind!=='world' && event.kind!=='instance' && <ActivityWorldChange worldId={event.worldId}/>}
            {event.source==='profile' && <span className="muted small">Замечено при просмотре профиля</span>}
            {event.source==='refresh' && <span className="muted small">Замечено при обновлении списка друзей</span>}
            {event.source==='sync' && <span className="muted small">Событие сохранено предыдущей версией</span>}
          </div>
        </article>;
      })}
    </div>
    {visible<events.length && <button className="button secondary load-more" onClick={()=>setVisible((n)=>n+limit)}>Показать ещё ({events.length-visible})</button>}
  </>;
}
type FeedFilter='all'|'gps'|'online'|'offline'|'status'|'avatar'|'bio';
export default function Feed() {
  const ctx=useApp();
  const [filter,setFilter]=useState<FeedFilter>('all'),[query,setQuery]=useState('');
  const events=useMemo(()=>ctx.history.events.filter((event)=>{
    const kinds:Record<FeedFilter,HistoryKind[]|undefined>={all:undefined,gps:['world','instance'],online:['online'],offline:['offline'],status:['status'],avatar:['avatar'],bio:['bio']};
    return (!kinds[filter]||kinds[filter]!.includes(event.kind)) && `${event.displayName} ${event.userId} ${event.detail} ${event.avatarName || ''} ${event.avatarAuthorName || ''} ${event.previousAvatarName || ''} ${event.previousAvatarAuthorName || ''} ${event.before || ''} ${event.after || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  }),[ctx.history.events,filter,query]);
  return <>
    <PageHeader eyebrow="ВАШ КРУГ" title="Лента" subtitle="Наблюдаемые события друзей на этом устройстве"/>
    <SearchField value={query} onChange={setQuery} placeholder="Поиск в ленте"/>
    <Segmented value={filter} onChange={(value)=>setFilter(value as FeedFilter)} items={[{id:'all',label:'Все'},{id:'gps',label:'GPS'},{id:'online',label:'Онлайн'},{id:'offline',label:'Офлайн'},{id:'status',label:'Статус'},{id:'avatar',label:'Аватар'},{id:'bio',label:'Био'}]}/>
    {filter==='bio' && <p className="muted small history-note">Новые записи Bio доступны, только если VRChat передаёт изменение. Сохранённая история остаётся доступна.</p>}
    <p className="muted small history-note">История сохраняется локально для этого аккаунта. Время — момент обнаружения изменения. Пропуски во время остановки приложения не восстанавливаются.</p>
    {ctx.history.error && <ErrorState error={ctx.history.error} retry={ctx.history.retry}/>}
    {ctx.history.loading && !events.length?<Loading/>:events.length?<HistoryRows key={`${filter}:${query}`} events={events}/>:<Empty icon={<Activity size={32}/>} title={query?'События не найдены':'Новая история'} text={query?'Измените поиск или фильтр.':'Здесь появятся реальные события, полученные приложением. История до установки приложения недоступна.'}/>}
  </>;
}

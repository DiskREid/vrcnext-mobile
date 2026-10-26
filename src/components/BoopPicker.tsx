import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { User, VrcFile } from '../api';
import { defaultBoopChoices, fileBoopChoices, inventoryBoopChoices } from '../api/boop';
import type { BoopChoice } from '../api/boop';
import { useApp } from '../state';
import SecureImage from './SecureImage';
import { Empty, Loading, Modal, Segmented } from './ui';
import './BoopPicker.css';

export default function BoopPicker({ target, onClose }: { target: User; onClose: () => void }) {
  const ctx = useApp();
  const [tab, setTab] = useState('default'), [selected, setSelected] = useState<BoopChoice>();
  const [custom, setCustom] = useState<BoopChoice[]>([]), [inventory, setInventory] = useState<BoopChoice[]>([]);
  const [offsets, setOffsets] = useState({ custom: 0, inventory: 0 });
  const [more, setMore] = useState({ custom: true, inventory: true });
  const [loaded, setLoaded] = useState({ custom: false, inventory: false });
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState('');
  const [sending, setSending] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now());
  const live = useRef(true), loadGeneration = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; loadGeneration.current++; }; }, []);
  useEffect(() => { if (!retryAt || now >= retryAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [retryAt, now >= retryAt]);
  async function load(kind: 'custom' | 'inventory', append = false) {
    if (ctx.demo || loading) return;
    const generation = ++loadGeneration.current, offset = append ? offsets[kind] : 0;
    setLoading(true); setLoadError('');
    try {
      let choices: BoopChoice[], hasMore: boolean;
      if (kind === 'custom') {
        const results = await Promise.allSettled([api.files('emoji', offset), api.files('emojianimated', offset)]);
        const successful = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        const rejected = results.find((result) => result.status === 'rejected');
        if (rejected?.status === 'rejected' && !successful.length) throw rejected.reason;
        if (rejected?.status === 'rejected' && live.current && generation === loadGeneration.current)
          setLoadError(`Часть эмодзи не загружена: ${rejected.reason instanceof Error ? rejected.reason.message : 'ошибка VRChat'}`);
        const files: VrcFile[] = successful.flat();
        choices = fileBoopChoices(files); hasMore = successful.some((rows) => rows.length === 100);
      } else {
        const items = await api.boopInventory(offset);
        choices = inventoryBoopChoices(items); hasMore = items.length === 100;
      }
      if (!live.current || generation !== loadGeneration.current) return;
      const update = kind === 'custom' ? setCustom : setInventory;
      update((old) => [...new Map([...(append ? old : []), ...choices].map((item) => [item.id, item])).values()]);
      setMore((old) => ({ ...old, [kind]: hasMore && offset < 2400 }));
      setOffsets((old) => ({ ...old, [kind]: offset + 100 }));
      setLoaded((old) => ({ ...old, [kind]: true }));
    } catch (failure) { if (live.current && generation === loadGeneration.current) setLoadError(failure instanceof Error ? failure.message : 'Не удалось получить эмодзи.'); }
    finally { if (live.current && generation === loadGeneration.current) setLoading(false); }
  }
  function changeTab(value: string) {
    if (loading || sending) return;
    setTab(value); setLoadError('');
    if ((value === 'custom' || value === 'inventory') && !loaded[value]) void load(value);
  }
  async function send() {
    if (sending || sent || ctx.demo || !ctx.online || Date.now() < retryAt) return;
    setSending(true); setError('');
    try {
      const success = await ctx.act(async () => {
        try { await api.boop(target.id, selected?.selection); return true; }
        catch (failure) {
          if (live.current) {
            setError(failure instanceof Error ? failure.message : 'Не удалось отправить Boop.');
            if (failure instanceof ApiError && failure.status === 429) { setNow(Date.now()); setRetryAt(Date.now() + (failure.retryAfter || 60) * 1000); }
          }
          throw failure;
        }
      }, 'Boop отправлен');
      if (success && live.current) setSent(true);
    } catch (failure) {
      if (live.current) setError(failure instanceof Error ? failure.message : 'Не удалось отправить Boop.');
    } finally { if (live.current) setSending(false); }
  }
  const choices = tab === 'custom' ? custom : tab === 'inventory' ? inventory : defaultBoopChoices;
  const waiting = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return <Modal title="Отправить Boop" onClose={onClose}>
    <div className="form-stack boop-picker">
      <p>Для {target.displayName}</p>
      <p className="muted small">Выберите эмодзи для Boop: стандартный, ваш загруженный или коллекционный. Другие стикеры здесь не предлагаются.</p>
      <Segmented value={tab} onChange={changeTab} items={[{ id: 'default', label: 'Стандартные' }, { id: 'custom', label: 'Мои эмодзи' }, { id: 'inventory', label: 'Коллекционные' }]} />
      {loading && <Loading />}
      {loadError && <div role="alert" className="error-inline">{loadError}<button className="text-button" disabled={loading} onClick={() => void load(tab === 'inventory' ? 'inventory' : 'custom')}>Повторить загрузку</button></div>}
      <div className="boop-choice-grid" role="group" aria-label="Эмодзи Boop">{choices.map((choice) => <button key={choice.id} className={`boop-choice ${selected?.id === choice.id ? 'selected' : ''}`} aria-label={`Выбрать ${choice.name}`} aria-pressed={selected?.id === choice.id} disabled={sending || sent} onClick={() => { setSelected(choice); setError(''); }}>
        <SecureImage src={choice.preview} alt={choice.name} maxDimension={256} retainLoaded />
        <span>{choice.name}</span>
      </button>)}</div>
      {!loading && !loadError && !choices.length && <Empty title={ctx.demo ? 'В деморежиме доступны стандартные эмодзи' : 'Нет доступных эмодзи'} />}
      {(tab === 'custom' || tab === 'inventory') && loaded[tab] && more[tab] && <button className="button secondary" disabled={loading || sending} onClick={() => void load(tab, true)}>Загрузить ещё</button>}
      <div className="boop-selection"><strong>{selected ? `Выбрано: ${selected.name}` : 'Обычный Boop без выбранного эмодзи'}</strong>{selected && <button className="text-button" disabled={sending || sent} onClick={() => setSelected(undefined)}>Сбросить выбор</button>}</div>
      {error && <p className="error-inline" role="alert">{error}</p>}
      {sent && <p role="status">Boop отправлен{selected ? `: ${selected.name}` : ''}</p>}
      {ctx.demo && <p className="muted small">Для отправки войдите в аккаунт в Android-приложении.</p>}
      <button className="button primary" disabled={sending || sent || waiting > 0 || ctx.demo || !ctx.online} onClick={() => void send()}>{sending ? 'Отправляем…' : waiting ? `Повторить через ${waiting} сек.` : sent ? 'Отправлено' : 'Отправить Boop'}</button>
    </div>
  </Modal>;
}

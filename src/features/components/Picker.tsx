/**
 * `<CataloguePicker>` (design/COMPONENTS.md §14.5): grouped multi-select with search for the four kitchen lists
 * (equipment, cuisines, staples, pantry). Controlled: every change goes through `onChange` with a new `PickerValue`.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Pencil, X } from 'lucide-react';
import { Icon, IconKey, Key, Popover, Select, Skeleton, Switch, TextInput, VisuallyHidden, cx, toast } from '@/components';
import { cleanLine, customId, filterIds, splitList, isCustomId, orderForRegion, parseKitchenList, regionDefaults, NOTE_MAX, type KitchenCatalogue, type KitchenGroup, type KitchenItem, type KitchenKind, type ParsedItem } from '@/catalogues/kitchen';
import { kitchenNow, loadKitchen, type LoadedKitchen } from '@/content/catalogues/kitchenCatalogue';
import type { CataloguePickerProps, PickerEntry, PickerValue } from './PickerTypes';
import { PICKER_COPY as C } from './PickerCopy';
import { addEntries, entriesFromParsed, isAdded, kindIds, shortRegion, splitMatch, truncate, withRegionDefaults } from './PickerModel';
import './picker.css';

const ADDED = '__added';
const DEBOUNCE_MS = 120;

export function CataloguePicker(props: CataloguePickerProps) {
  const [kit, setKit] = useState<LoadedKitchen | null>(() => kitchenNow());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (kit) return;
    let live = true;
    loadKitchen().then(
      (k) => live && setKit(k),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [kit, attempt]);
  const load = () => {
    setFailed(false);
    setAttempt((a) => a + 1);
  };

  return (
    <section className={cx('lm-pk', props.className)} aria-label={props.label}>
      {props.optional ? <p className="lm-pk__optional">{C.optional}</p> : null}
      {kit ? (
        <PickerBody {...props} kit={kit} />
      ) : failed ? (
        <div className="lm-pk__error" role="alert">
          <p>{C.loadError}</p>
          <Key size="sm" onClick={load}>
            {C.retry}
          </Key>
        </div>
      ) : (
        <div className="lm-pk__loading" aria-busy="true">
          <VisuallyHidden>{C.loading}</VisuallyHidden>
          <Skeleton height={40} />
          <div className="lm-pk__chips">
            {[96, 64, 120, 80, 104, 72, 88, 60, 112, 76].map((w, i) => (
              <Skeleton key={i} width={w} height={28} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface BodyProps extends CataloguePickerProps {
  kit: LoadedKitchen;
}

function PickerBody({ kind, value, onChange, regions, onRegionsChange, ranked, notes, paste, resolve, label, kit }: BodyProps) {
  const { cat, index } = kit;
  const uid = useId();
  const isRanked = ranked ?? kind === 'cuisines';
  const hasNotes = notes ?? (kind === 'equipment' || kind === 'pantry');
  const hasPaste = paste ?? (kind === 'pantry' || kind === 'staples');

  // latest value for Undo closures
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const groups = cat.groups(kind);
  const ids = useMemo(() => kindIds(cat, kind), [cat, kind]);
  const total = ids.size;
  const defaults = useMemo(() => regionDefaults(cat, regions ?? [], kind), [cat, regions, kind]);
  const mainRegion = regions?.length ? cat.region(regions[0]!) : undefined;
  const regionName = mainRegion ? shortRegion(mainRegion.label) : '';

  const byId = useMemo(() => new Map(value.map((e, i) => [e.id, { entry: e, pos: i }])), [value]);
  const rankOf = (id: string): number | undefined => {
    if (!isRanked) return undefined;
    const hit = byId.get(id);
    return hit ? hit.pos + 1 : undefined;
  };

  /* ---------------------------------------------------------------- search */
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (typed === query) return;
    const t = window.setTimeout(() => setQuery(typed), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [typed, query]);
  const searching = query.trim().length > 0;
  const matches = useMemo(() => (searching ? filterIds(index, kind, query) : null), [searching, index, kind, query]);

  /* ---------------------------------------------------------------- edits */
  const doResolve = useCallback(
    (text: string): Promise<ParsedItem[]> => (resolve ? resolve(text) : Promise.resolve(parseKitchenList(index, text, kind === 'pantry' ? ['pantry', 'staples'] : [kind]))),
    [resolve, index, kind],
  );
  const toggle = (id: string) => {
    if (byId.has(id)) onChange(value.filter((e) => e.id !== id));
    else onChange([...value, { id, source: 'picker' }]);
  };
  const update = (id: string, patch: Partial<PickerEntry>) => {
    onChange(
      value.map((e) => {
        if (e.id !== id) return e;
        const next: PickerEntry = { ...e, ...patch };
        delete next.assumed;
        if (!next.note) delete next.note;
        if (!next.ownNotUsed) delete next.ownNotUsed;
        return next;
      }),
    );
  };
  const add = (entries: readonly PickerEntry[]) => onChange(addEntries(valueRef.current, entries));
  const clearGroup = (g: { id: string; label: string }, groupIds: ReadonlySet<string>) => {
    const removed = value.filter((e) => groupIds.has(e.id));
    if (!removed.length) return;
    onChange(value.filter((e) => !groupIds.has(e.id)));
    toast(C.cleared(g.label), { id: `${uid}-clear`, action: { label: C.undo, onClick: () => onChange(addEntries(valueRef.current, removed)) } });
  };
  const clearDefaults = () => onChange(value.filter((e) => !e.assumed));
  const changeRegion = (rid: string) => {
    onRegionsChange?.([rid]);
    onChange(withRegionDefaults(cat, kind, [rid], value));
  };

  /* ---------------------------------------------------------------- groups */
  const added = value.filter((e) => isAdded(e, ids));
  const [pending, setPending] = useState<Array<{ key: number; text: string }>>([]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const first = groups.find((g) => g.items.some((i) => byId.has(i.id)));
    return first ? { [first.id]: true } : {};
  });
  const isOpen = (gid: string, hasMatch: boolean) => (searching ? hasMatch : Boolean(open[gid]));
  const setGroupOpen = (gid: string, o: boolean) => setOpen((s) => ({ ...s, [gid]: o }));

  /* ---------------------------------------------------------------- note popover */
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const noteAnchor = useRef<HTMLElement | null>(null);
  const assumedDescId = `${uid}-assumed`;

  const chipProps = (item: { id: string; label: string }) => {
    const hit = byId.get(item.id);
    return {
      id: item.id,
      label: item.label,
      entry: hit?.entry,
      rank: rankOf(item.id),
      query: searching ? query : '',
      notes: hasNotes,
      describedBy: hit?.entry.assumed && regionName ? assumedDescId : undefined,
      onToggle: () => toggle(item.id),
      onNote: (el: HTMLElement) => {
        noteAnchor.current = el;
        setNoteFor(item.id);
      },
    };
  };

  const noteEntry = noteFor ? byId.get(noteFor)?.entry : undefined;
  const noteItem = noteFor ? cat.get(noteFor) : undefined;
  const noteLabel = noteFor ? (noteItem?.label ?? noteEntry?.label ?? noteFor) : '';
  const notePlaceholder = (noteItem && 'notesHint' in noteItem && noteItem.notesHint) || (kind === 'pantry' ? C.notePlaceholderPantry : C.notePlaceholder);

  const addedMatches = searching ? added.filter((e) => entryLabel(cat, e).toLowerCase().includes(query.trim().toLowerCase())) : added;
  const matchCount = (matches?.size ?? 0) + (searching ? addedMatches.length : 0);

  return (
    <div className="lm-pk__body">
      <div className="lm-pk__top">
        <div className="lm-pk__search">
          <input
            type="search"
            role="searchbox"
            className="lm-input lm-pk__search-input"
            aria-label={C.searchLabel(label)}
            aria-describedby={`${uid}-count`}
            placeholder={C.searchPlaceholder(total)}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && typed) {
                e.preventDefault();
                setTyped('');
                setQuery('');
              }
            }}
          />
          {typed ? (
            <IconKey
              icon={X}
              size="sm"
              label={C.clearSearch}
              className="lm-pk__search-clear"
              onClick={() => {
                setTyped('');
                setQuery('');
              }}
            />
          ) : null}
        </div>
        <span className="lm-pk__total">{C.selected(value.length)}</span>
      </div>
      <p id={`${uid}-count`} className="lm-pk__count" aria-live="polite">
        {searching ? C.matches(matchCount) : ''}
      </p>
      {searching && matchCount === 0 ? (
        <div className="lm-pk__nomatch">
          <span>{C.noMatch(query.trim())}</span>
          <Key
            variant="quiet"
            size="sm"
            onClick={() => {
              const words = query.trim().slice(0, NOTE_MAX);
              add([{ id: customId(words), label: words, source: 'picker' }]);
              setGroupOpen(ADDED, true);
              setTyped('');
              setQuery('');
            }}
          >
            {C.addOwn}
          </Key>
        </div>
      ) : null}

      {regions !== undefined || onRegionsChange ? (
        <div className="lm-pk__region">
          {/* the note says "pre-ticked" only while region defaults are ticked; otherwise the key ticks them (Q3-J5-03) */}
          <p className="lm-pk__region-note">{!mainRegion || !defaults.preTick.length ? C.noDefaults : value.some((e) => e.assumed) ? C.regionNote(regionName) : C.regionOffer(regionName)}</p>
          <div className="lm-pk__region-keys">
            {mainRegion && defaults.preTick.length && !value.some((e) => e.assumed) && defaults.preTick.some((id) => !value.some((e) => e.id === id)) ? (
              <Key variant="quiet" size="sm" onClick={() => onChange(withRegionDefaults(cat, kind, regions ?? [], valueRef.current))}>
                {C.tickDefaults(regionName)}
              </Key>
            ) : null}
            {onRegionsChange ? (
              <Select
                size="sm"
                label={C.otherRegion}
                placeholder={C.otherRegion}
                value={undefined}
                options={cat.regions().map((r) => ({ value: r.id, label: shortRegion(r.label) }))}
                onChange={changeRegion}
                className="lm-pk__region-select"
              />
            ) : null}
            {value.some((e) => e.assumed) ? (
              <Key variant="quiet" size="sm" onClick={clearDefaults}>
                {C.clearDefaults}
              </Key>
            ) : null}
          </div>
          {regionName ? (
            <span id={assumedDescId} hidden>
              {C.defaultFor(regionName)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="lm-pk__groups">
        {groups.map((g) => (
          <GroupView
            key={g.id}
            group={g}
            common={defaults.common}
            matches={matches}
            ticked={(id) => byId.has(id)}
            open={(has) => isOpen(g.id, has)}
            onOpen={(o) => setGroupOpen(g.id, o)}
            onClear={(gids) => clearGroup(g, gids)}
            chip={chipProps}
          />
        ))}
        {added.length || pending.length ? (
          <AddedGroup
            entries={addedMatches}
            pending={pending}
            open={searching ? addedMatches.length > 0 : Boolean(open[ADDED])}
            onOpen={(o) => setGroupOpen(ADDED, o)}
            cat={cat}
            chip={(e) => chipProps({ id: e.id, label: entryLabel(cat, e) })}
          />
        ) : null}
      </div>

      <AlsoHave kind={kind}
        onSubmit={(text) => {
          const key = Date.now() + Math.random();
          setPending((p) => [...p, { key, text }]);
          setGroupOpen(ADDED, true);
          doResolve(text)
            .catch((): ParsedItem[] => [{ label: text, id: null, confidence: 0 }])
            .then((items) => {
              setPending((p) => p.filter((x) => x.key !== key));
              add(entriesFromParsed(items, kind, 'picker'));
            });
        }}
      />

      {hasPaste ? <PasteList cat={cat} resolve={doResolve} onAdd={(items) => add(entriesFromParsed(items, kind, 'paste'))} /> : null}

      <Popover open={noteFor !== null && noteEntry !== undefined} onOpenChange={(o) => !o && setNoteFor(null)} anchorRef={noteAnchor} label={C.editNote(noteLabel)} className="lm-pk__note-pop">
        {noteFor && noteEntry ? (
          <div className="lm-pk__note">
            <label className="lm-pk__note-field">
              <span className="lm-eng">{C.noteLabel}</span>
              <TextInput
                aria-label={C.editNote(noteLabel)}
                maxLength={NOTE_MAX}
                placeholder={notePlaceholder}
                value={noteEntry.note ?? ''}
                onChange={(e) => update(noteFor, { note: e.target.value.slice(0, NOTE_MAX) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setNoteFor(null);
                    noteAnchor.current?.focus();
                  }
                }}
              />
            </label>
            {kind === 'equipment' ? <Switch checked={Boolean(noteEntry.ownNotUsed)} onChange={(c) => update(noteFor, { ownNotUsed: c })} label={C.ownNotUsed} labelStyle="sentence" /> : null}
            <Key
              size="sm"
              onClick={() => {
                setNoteFor(null);
                noteAnchor.current?.focus();
              }}
            >
              {C.done}
            </Key>
          </div>
        ) : null}
      </Popover>
    </div>
  );
}

function entryLabel(cat: KitchenCatalogue, e: PickerEntry): string {
  if (isCustomId(e.id)) return e.label ?? e.id.replace(/^custom:/, '').replace(/-/g, ' ');
  return e.label ?? cat.get(e.id)?.label ?? e.id;
}

/* -------------------------------------------------------------------------------------------- chip */

interface ChipProps {
  id: string;
  label: string;
  entry: PickerEntry | undefined;
  rank?: number;
  query: string;
  notes: boolean;
  describedBy?: string;
  onToggle: () => void;
  onNote: (el: HTMLElement) => void;
}

function PickerChip({ label, entry, rank, query, notes, describedBy, onToggle, onNote }: ChipProps) {
  const rankId = useId();
  const checked = entry !== undefined;
  const note = entry?.note?.trim();
  const full = note ? `${label} · ${note}` : label;
  const visible = note ? truncate(full) : full;
  const labelPart = visible.slice(0, Math.min(label.length, visible.length));
  const rest = visible.slice(labelPart.length);
  const parts = splitMatch(labelPart, query);
  const name = `${full}${entry?.ownNotUsed ? ' · not used' : ''}`;
  return (
    <span className="lm-pk__chipwrap">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={name}
        aria-describedby={[describedBy, rank ? rankId : undefined].filter(Boolean).join(' ') || undefined}
        title={note && visible !== full ? full : undefined}
        className="lm-pk__chip"
        data-assumed={entry?.assumed ? 'true' : undefined}
        onClick={onToggle}
      >
        {rank ? (
          <span className="lm-pk__rank" aria-hidden="true">
            {rank}
          </span>
        ) : null}
        <span className="lm-pk__chip-text">
          {parts ? (
            <>
              {parts[0]}
              <b>{parts[1]}</b>
              {parts[2]}
            </>
          ) : (
            labelPart
          )}
          {rest}
        </span>
        {entry?.ownNotUsed ? <span className="lm-pk__notused"> · {C.notUsed}</span> : null}
      </button>
      {checked && notes ? <IconKey icon={Pencil} size="sm" label={C.editNote(label)} className="lm-pk__note-key" aria-haspopup="dialog" onClick={(e) => onNote(e.currentTarget)} /> : null}
      {rank ? (
        <span id={rankId} hidden>
          {C.rank(rank)}
        </span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------------------------- groups */

interface GroupViewProps {
  group: KitchenGroup;
  common: readonly string[];
  matches: ReadonlySet<string> | null;
  ticked: (id: string) => boolean;
  open: (hasMatch: boolean) => boolean;
  onOpen: (open: boolean) => void;
  onClear: (ids: ReadonlySet<string>) => void;
  chip: (item: { id: string; label: string }) => ChipProps;
}

function GroupView({ group, common, matches, ticked, open, onOpen, onClear, chip }: GroupViewProps) {
  const headId = useId();
  const items = useMemo(() => {
    const byId = new Map<string, KitchenItem>(group.items.map((i) => [i.id, i]));
    return orderForRegion([...byId.keys()], common).map((id) => byId.get(id)!);
  }, [group, common]);
  const shown = matches ? items.filter((i) => matches.has(i.id)) : items;
  if (matches && !shown.length) return null;
  const n = items.filter((i) => ticked(i.id)).length;
  const isOpen = open(shown.length > 0);
  return (
    <div className="lm-pk__group">
      <div className="lm-pk__group-head">
        <button type="button" id={headId} className="lm-pk__group-key" aria-expanded={isOpen} onClick={() => onOpen(!isOpen)}>
          <Icon icon={isOpen ? ChevronDown : ChevronRight} size={16} />
          <span className="lm-pk__group-name">{group.label}</span>
          <span className="lm-pk__group-count">{C.groupCount(n, items.length)}</span>
        </button>
        {n > 0 ? (
          <Key variant="quiet" size="sm" aria-label={C.clearGroup(group.label)} className="lm-pk__group-clear" onClick={() => onClear(new Set(items.map((i) => i.id)))}>
            {C.clear}
          </Key>
        ) : null}
      </div>
      {isOpen ? (
        <div role="group" aria-labelledby={headId} className="lm-pk__chips">
          {shown.map((i) => (
            <PickerChip key={i.id} {...chip({ id: i.id, label: i.label })} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface AddedGroupProps {
  entries: readonly PickerEntry[];
  pending: ReadonlyArray<{ key: number; text: string }>;
  open: boolean;
  onOpen: (open: boolean) => void;
  cat: KitchenCatalogue;
  chip: (e: PickerEntry) => ChipProps;
}

function AddedGroup({ entries, pending, open, onOpen, cat, chip }: AddedGroupProps) {
  const headId = useId();
  const count = entries.length + pending.length;
  return (
    <div className="lm-pk__group">
      <div className="lm-pk__group-head">
        <button type="button" id={headId} className="lm-pk__group-key" aria-expanded={open} onClick={() => onOpen(!open)}>
          <Icon icon={open ? ChevronDown : ChevronRight} size={16} />
          <span className="lm-pk__group-name">{C.addedGroup}</span>
          <span className="lm-pk__group-count">{count}</span>
        </button>
        {!open && pending.length ? <span className="lm-pk__status">{C.matching}</span> : null}
      </div>
      {open ? (
        <ul role="group" aria-labelledby={headId} className="lm-pk__added">
          {entries.map((e) => {
            const item = isCustomId(e.id) ? undefined : cat.get(e.id);
            return (
              <li key={e.id} className="lm-pk__added-row">
                <PickerChip {...chip(e)} />
                <span className="lm-pk__status">{item ? C.matched(item.label) : C.keptAsWritten}</span>
              </li>
            );
          })}
          {pending.map((p) => (
            <li key={p.key} className="lm-pk__added-row">
              <span className="lm-pk__pending">{p.text}</span>
              <span className="lm-pk__status" role="status">
                {C.matching}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- free text */

function AlsoHave({ kind, onSubmit }: { kind: KitchenKind; onSubmit: (text: string) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSubmit(t);
    setText('');
  };
  return (
    <form className="lm-pk__also" onSubmit={submit}>
      <label htmlFor={id} className="lm-pk__also-label">
        {C.alsoHave}
      </label>
      <TextInput id={id} value={text} placeholder={C.alsoHavePlaceholder[kind]} onChange={(e) => setText(e.target.value)} className="lm-pk__also-input" />
      <Key type="submit" size="sm">
        {C.add}
      </Key>
    </form>
  );
}

interface PasteListProps {
  cat: KitchenCatalogue;
  resolve: (text: string) => Promise<ParsedItem[]>;
  onAdd: (items: ParsedItem[]) => void;
}

function PasteList({ cat, resolve, onAdd }: PasteListProps) {
  const regionId = useId();
  const areaId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Array<{ item: ParsedItem; on: boolean }> | null>(null);
  const read = () => {
    if (!text.trim()) return;
    setBusy(true);
    resolve(text)
      .catch((): ParsedItem[] => splitList(text).map((l) => ({ ...cleanLine(l), id: null, confidence: 0 })))
      .then((items) => {
        setRows(items.map((item) => ({ item, on: true })));
        setBusy(false);
      });
  };
  const matched = rows?.filter((r) => r.item.id).length ?? 0;
  const kept = (rows?.length ?? 0) - matched;
  const ticked = rows?.filter((r) => r.on) ?? [];
  return (
    <div className="lm-pk__paste">
      <button type="button" className="lm-pk__group-key" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(!open)}>
        <Icon icon={open ? ChevronDown : ChevronRight} size={16} />
        <span className="lm-pk__group-name">{C.paste}</span>
      </button>
      {open ? (
        <div id={regionId} className="lm-pk__paste-body">
          <label htmlFor={areaId} className="lm-eng">
            {C.pasteLabel}
          </label>
          <textarea id={areaId} rows={4} className="lm-input lm-pk__textarea" placeholder={C.pastePlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
          <div>
            <Key size="sm" loading={busy} onClick={read}>
              {C.readList}
            </Key>
          </div>
          {rows ? (
            <div className="lm-pk__preview">
              <p className="lm-pk__preview-sum">{C.pasteSummary(matched, kept)}</p>
              <ul className="lm-pk__preview-list">
                {rows.map((r, i) => (
                  <PreviewRow
                    key={`${i}-${r.item.label}`}
                    text={r.item.id ? (cat.get(r.item.id)?.label ?? r.item.label) : r.item.label}
                    kept={!r.item.id}
                    checked={r.on}
                    onChange={(on) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, on } : x)))}
                  />
                ))}
              </ul>
              <Key
                variant="solid"
                size="sm"
                disabled={ticked.length === 0}
                onClick={() => {
                  onAdd(ticked.map((r) => r.item));
                  setRows(null);
                  setText('');
                }}
              >
                {C.addItems(ticked.length)}
              </Key>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PreviewRow({ text, kept, checked, onChange }: { text: string; kept: boolean; checked: boolean; onChange: (on: boolean) => void }): ReactNode {
  return (
    <li>
      <label className="lm-pk__preview-row">
        <input type="checkbox" className="lm-check__box" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{text}</span>
        {kept ? <span className="lm-pk__status">{C.keptTag}</span> : null}
      </label>
    </li>
  );
}

export type { CataloguePickerProps, PickerEntry, PickerValue };

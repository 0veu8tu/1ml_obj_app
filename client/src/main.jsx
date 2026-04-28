import React from 'react';
import ReactDOM from 'react-dom/client';
import { ArrowDownAZ, ArrowUpAZ, GripVertical, Plus, RefreshCcw, Search, Trash2 } from 'lucide-react';
import { FixedSizeList as List } from 'react-window';
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './styles.css';

const PAGE_SIZE = 20;
const ROW_HEIGHT = 72;
const TOTAL_ITEMS = 1_000_000;
const STORAGE_KEYS = {
  search: 'search',
  selectedIds: 'selectedIds',
  sort: 'sort'
};

function buildItem(id) {
  return {
    id,
    title: `Object #${id.toLocaleString('en-US')}`,
    meta: `Generated payload ${String(id).padStart(7, '0')}`
  };
}

function parseIdQuery(query) {
  if (!query) return null;
  const digits = query.replace(/\D/g, '');
  if (!digits) return null;

  const id = Number.parseInt(digits, 10);
  if (!Number.isInteger(id) || id < 1 || id > TOTAL_ITEMS) return null;
  return id;
}

function readStoredIds() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.selectedIds) || '[]');
    if (!Array.isArray(value)) return [];

    const seen = new Set();
    return value.filter((id) => {
      const normalized = Number(id);
      const isValid = Number.isInteger(normalized) && normalized >= 1 && normalized <= TOTAL_ITEMS && !seen.has(normalized);
      if (isValid) seen.add(normalized);
      return isValid;
    });
  } catch {
    return [];
  }
}

function makePage(items, total, offset, limit) {
  return {
    items,
    total,
    nextOffset: offset + items.length < total ? offset + items.length : null
  };
}

function getAvailablePage({ query, sort, offset, limit, selectedSet }) {
  const directId = parseIdQuery(query);

  if (directId !== null) {
    if (selectedSet.has(directId)) return makePage([], 0, offset, limit);
    return offset === 0 ? makePage([buildItem(directId)], 1, offset, limit) : makePage([], 1, offset, limit);
  }

  const total = TOTAL_ITEMS - selectedSet.size;
  const items = [];
  let seenAvailable = 0;
  let id = sort === 'asc' ? 1 : TOTAL_ITEMS;
  const step = sort === 'asc' ? 1 : -1;

  while (id >= 1 && id <= TOTAL_ITEMS && items.length < limit) {
    if (!selectedSet.has(id)) {
      if (seenAvailable >= offset) items.push(buildItem(id));
      seenAvailable += 1;
    }

    id += step;
  }

  return makePage(items, total, offset, limit);
}

function getSelectedPage({ query, offset, limit, selectedIds }) {
  const directId = parseIdQuery(query);
  const source = directId === null ? selectedIds : selectedIds.filter((id) => id === directId);
  const items = source.slice(offset, offset + limit).map(buildItem);
  return makePage(items, source.length, offset, limit);
}

function usePagedCollection(getPage, deps) {
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [nextOffset, setNextOffset] = React.useState(0);

  const loadPage = React.useCallback(
    (offset = 0, replace = false) => {
      const data = getPage(offset);
      setItems((current) => (replace ? data.items : [...current, ...data.items]));
      setTotal(data.total);
      setNextOffset(data.nextOffset);
    },
    deps
  );

  React.useEffect(() => {
    loadPage(0, true);
  }, [loadPage]);

  const loadMore = React.useCallback(() => {
    if (nextOffset !== null) loadPage(nextOffset, false);
  }, [loadPage, nextOffset]);

  return { items, setItems, total, loading: false, error: '', reload: () => loadPage(0, true), loadMore };
}

function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);

  return debounced;
}

function Toolbar({ search, onSearch, sort, onSort, onRefresh, selectedCount }) {
  return (
    <header className="toolbar">
      <div>
        <p className="eyebrow">Local state</p>
        <h1>Million Objects</h1>
      </div>
      <div className="toolbar-actions">
        <label className="search-field">
          <Search size={18} />
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Поиск по id" />
        </label>
        <button className="icon-button" onClick={() => onSort(sort === 'asc' ? 'desc' : 'asc')} title="Сортировка доступных">
          {sort === 'asc' ? <ArrowDownAZ size={20} /> : <ArrowUpAZ size={20} />}
        </button>
        <button className="icon-button" onClick={onRefresh} title="Обновить данные">
          <RefreshCcw size={20} />
        </button>
        <div className="counter">{selectedCount} selected</div>
      </div>
    </header>
  );
}

function AvailableRow({ item, style, onAdd }) {
  return (
    <div className="row" style={style}>
      <div className="row-main">
        <strong>{item.title}</strong>
        <span>{item.meta}</span>
      </div>
      <button className="icon-button accent" onClick={() => onAdd(item.id)} title="Выбрать">
        <Plus size={18} />
      </button>
    </div>
  );
}

function SortableSelectedRow({ item, style, onRemove, dragDisabled }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: dragDisabled
  });

  return (
    <div
      ref={setNodeRef}
      className={`row sortable-row ${isDragging ? 'dragging' : ''}`}
      style={{
        ...style,
        transform: CSS.Transform.toString(transform),
        transition
      }}
    >
      <button className="drag-handle" {...attributes} {...listeners} disabled={dragDisabled} title="Перетащить">
        <GripVertical size={18} />
      </button>
      <div className="row-main">
        <strong>{item.title}</strong>
        <span>{item.meta}</span>
      </div>
      <button className="icon-button danger" onClick={() => onRemove(item.id)} title="Удалить">
        <Trash2 size={18} />
      </button>
    </div>
  );
}

function VirtualPanel({ title, subtitle, items, total, loading, error, loadMore, rowRenderer, emptyText }) {
  const height = Math.min(620, Math.max(360, window.innerHeight - 260));
  const hasMore = items.length < total;
  const rowCount = hasMore ? items.length + 1 : items.length;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span>{total.toLocaleString('en-US')}</span>
      </div>

      {error ? <div className="notice error">{error}</div> : null}
      {!loading && items.length === 0 ? <div className="notice">{emptyText}</div> : null}

      <List
        className="virtual-list"
        height={height}
        itemCount={rowCount}
        itemSize={ROW_HEIGHT}
        width="100%"
        onItemsRendered={({ visibleStopIndex }) => {
          if (visibleStopIndex >= items.length - 4 && hasMore) loadMore();
        }}
      >
        {({ index, style }) => {
          if (index >= items.length) {
            return (
              <div className="loader-row" style={style}>
                {loading ? 'Загрузка...' : 'Прокрутите дальше'}
              </div>
            );
          }

          return rowRenderer(items[index], style);
        }}
      </List>
    </section>
  );
}

function App() {
  const [search, setSearch] = React.useState(() => localStorage.getItem(STORAGE_KEYS.search) || '');
  const [sort, setSort] = React.useState(() => localStorage.getItem(STORAGE_KEYS.sort) || 'asc');
  const [selectedIds, setSelectedIds] = React.useState(readStoredIds);
  const debouncedSearch = useDebouncedValue(search);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const dragDisabled = debouncedSearch.length > 0;

  const available = usePagedCollection(
    (offset) => getAvailablePage({ query: debouncedSearch, sort, offset, limit: PAGE_SIZE, selectedSet }),
    [debouncedSearch, sort, selectedSet]
  );

  const selected = usePagedCollection(
    (offset) => getSelectedPage({ query: debouncedSearch, offset, limit: PAGE_SIZE, selectedIds }),
    [debouncedSearch, selectedIds]
  );

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.search, search);
  }, [search]);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.sort, sort);
  }, [sort]);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.selectedIds, JSON.stringify(selectedIds));
  }, [selectedIds]);

  const refreshAll = React.useCallback(() => {
    available.reload();
    selected.reload();
  }, [available, selected]);

  const addItem = (id) => {
    setSelectedIds((current) => (current.includes(id) ? current : [...current, id]));
  };

  const removeItem = (id) => {
    setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
  };

  const handleDragEnd = ({ active, over }) => {
    if (dragDisabled) return;
    if (!over || active.id === over.id) return;

    setSelectedIds((current) => {
      const oldIndex = current.indexOf(active.id);
      const newIndex = current.indexOf(over.id);
      if (oldIndex === -1 || newIndex === -1) return current;

      const nextIds = [...current];
      const [moved] = nextIds.splice(oldIndex, 1);
      nextIds.splice(newIndex, 0, moved);
      return nextIds;
    });
  };

  return (
    <main className="app-shell">
      <Toolbar
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
        onRefresh={refreshAll}
        selectedCount={selectedIds.length}
      />

      <div className="workspace">
        <VirtualPanel
          title="Доступные"
          subtitle="Пагинация, поиск и сортировка работают прямо в браузере"
          items={available.items}
          total={available.total}
          loading={available.loading}
          error={available.error}
          loadMore={available.loadMore}
          emptyText="Ничего не найдено"
          rowRenderer={(item, style) => <AvailableRow key={item.id} item={item} style={style} onAdd={addItem} />}
        />

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={selected.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <VirtualPanel
              title="Выбранные"
              subtitle={dragDisabled ? 'Очистите поиск для перестановки' : 'Порядок сохраняется в этом браузере'}
              items={selected.items}
              total={selected.total}
              loading={selected.loading}
              error={selected.error}
              loadMore={selected.loadMore}
              emptyText="Добавьте элементы из левого списка"
              rowRenderer={(item, style) => (
                <SortableSelectedRow
                  key={item.id}
                  item={item}
                  style={style}
                  onRemove={removeItem}
                  dragDisabled={dragDisabled}
                />
              )}
            />
          </SortableContext>
        </DndContext>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

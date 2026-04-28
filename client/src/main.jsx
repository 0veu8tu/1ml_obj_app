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
const API = '/api';

function usePagedCollection(kind, params = {}) {
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [nextOffset, setNextOffset] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const requestId = React.useRef(0);

  const queryKey = JSON.stringify(params);

  const loadPage = React.useCallback(
    async (offset = 0, replace = false) => {
      const id = ++requestId.current;
      const search = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...params
      });

      setLoading(true);
      setError('');

      try {
        const response = await fetch(`${API}/${kind}?${search}`);
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        if (id !== requestId.current) return;

        setItems((current) => (replace ? data.items : [...current, ...data.items]));
        setTotal(data.total);
        setNextOffset(data.nextOffset);
      } catch (err) {
        if (id === requestId.current) setError(err.message);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [kind, queryKey]
  );

  React.useEffect(() => {
    setItems([]);
    setNextOffset(0);
    loadPage(0, true);
  }, [loadPage]);

  const loadMore = React.useCallback(() => {
    if (!loading && nextOffset !== null) loadPage(nextOffset, false);
  }, [loadPage, loading, nextOffset]);

  return { items, setItems, total, nextOffset, loading, error, reload: () => loadPage(0, true), loadMore };
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
        <p className="eyebrow">Server state</p>
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
  const [search, setSearch] = React.useState(() => localStorage.getItem('search') || '');
  const [sort, setSort] = React.useState(() => localStorage.getItem('sort') || 'asc');
  const [selectedCount, setSelectedCount] = React.useState(0);
  const debouncedSearch = useDebouncedValue(search);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const available = usePagedCollection('items', { q: debouncedSearch, sort });
  const selected = usePagedCollection('selected', { q: debouncedSearch });
  const dragDisabled = debouncedSearch.length > 0;

  React.useEffect(() => {
    localStorage.setItem('search', search);
  }, [search]);

  React.useEffect(() => {
    localStorage.setItem('sort', sort);
  }, [sort]);

  React.useEffect(() => {
    fetch(`${API}/state`)
      .then((response) => response.json())
      .then((state) => setSelectedCount(state.selectedCount))
      .catch(() => {});
  }, []);

  const refreshAll = React.useCallback(() => {
    available.reload();
    selected.reload();
    fetch(`${API}/state`)
      .then((response) => response.json())
      .then((state) => setSelectedCount(state.selectedCount))
      .catch(() => {});
  }, [available, selected]);

  const addItem = async (id) => {
    const response = await fetch(`${API}/selected/${id}`, { method: 'POST' });
    if (!response.ok) return;
    const data = await response.json();
    setSelectedCount(data.selectedCount);
    refreshAll();
  };

  const removeItem = async (id) => {
    const response = await fetch(`${API}/selected/${id}`, { method: 'DELETE' });
    if (!response.ok) return;
    const data = await response.json();
    setSelectedCount(data.selectedCount);
    refreshAll();
  };

  const handleDragEnd = async ({ active, over }) => {
    if (dragDisabled) return;
    if (!over || active.id === over.id) return;

    const oldIndex = selected.items.findIndex((item) => item.id === active.id);
    const newIndex = selected.items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const nextItems = [...selected.items];
    const [moved] = nextItems.splice(oldIndex, 1);
    nextItems.splice(newIndex, 0, moved);
    selected.setItems(nextItems);

    const stateResponse = await fetch(`${API}/state`);
    const state = await stateResponse.json();
    const pageIds = nextItems.map((item) => item.id);
    const nextIds = [...state.selectedIds];
    nextIds.splice(0, pageIds.length, ...pageIds);

    const response = await fetch(`${API}/selected/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: nextIds })
    });

    if (!response.ok) selected.reload();
  };

  return (
    <main className="app-shell">
      <Toolbar
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
        onRefresh={refreshAll}
        selectedCount={selectedCount}
      />

      <div className="workspace">
        <VirtualPanel
          title="Доступные"
          subtitle="Пагинация, поиск и сортировка на Express"
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
              subtitle={dragDisabled ? 'Очистите поиск для перестановки' : 'Порядок сохраняется на сервере'}
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

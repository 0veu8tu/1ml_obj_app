import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 4000);
const TOTAL_ITEMS = 1_000_000;
const MAX_LIMIT = 100;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../../client/dist');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const selectedIds = [];
const selectedSet = new Set();

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 20;
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeSort(value) {
  return value === 'desc' ? 'desc' : 'asc';
}

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase();
}

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

function makePage(items, total, offset, limit) {
  return {
    items,
    total,
    offset,
    limit,
    nextOffset: offset + items.length < total ? offset + items.length : null
  };
}

function getAvailablePage({ query, sort, offset, limit }) {
  const directId = parseIdQuery(query);

  if (directId !== null) {
    if (selectedSet.has(directId)) return makePage([], 0, offset, limit);
    const item = buildItem(directId);
    return offset === 0 ? makePage([item], 1, offset, limit) : makePage([], 1, offset, limit);
  }

  const total = TOTAL_ITEMS - selectedSet.size;
  const items = [];
  let seenAvailable = 0;
  let id = sort === 'asc' ? 1 : TOTAL_ITEMS;
  const step = sort === 'asc' ? 1 : -1;

  while (id >= 1 && id <= TOTAL_ITEMS && items.length < limit) {
    if (!selectedSet.has(id)) {
      if (seenAvailable >= offset) {
        items.push(buildItem(id));
      }
      seenAvailable += 1;
    }
    id += step;
  }

  return makePage(items, total, offset, limit);
}

function getSelectedPage({ query, offset, limit }) {
  const directId = parseIdQuery(query);
  const source = directId === null ? selectedIds : selectedIds.filter((id) => id === directId);
  const total = source.length;
  const items = source.slice(offset, offset + limit).map(buildItem);
  return makePage(items, total, offset, limit);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, totalItems: TOTAL_ITEMS, selectedCount: selectedIds.length });
});

app.get('/api/items', (req, res) => {
  const limit = normalizeLimit(req.query.limit);
  const offset = normalizeOffset(req.query.offset);
  const sort = normalizeSort(req.query.sort);
  const query = normalizeQuery(req.query.q);

  res.json(getAvailablePage({ query, sort, offset, limit }));
});

app.get('/api/selected', (req, res) => {
  const limit = normalizeLimit(req.query.limit);
  const offset = normalizeOffset(req.query.offset);
  const query = normalizeQuery(req.query.q);

  res.json(getSelectedPage({ query, offset, limit }));
});

app.get('/api/state', (_req, res) => {
  res.json({
    totalItems: TOTAL_ITEMS,
    selectedCount: selectedIds.length,
    selectedIds
  });
});

app.post('/api/selected/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(id) || id < 1 || id > TOTAL_ITEMS) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  if (!selectedSet.has(id)) {
    selectedSet.add(id);
    selectedIds.push(id);
  }

  return res.status(201).json({ item: buildItem(id), selectedCount: selectedIds.length });
});

app.delete('/api/selected/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  if (selectedSet.has(id)) {
    selectedSet.delete(id);
    const index = selectedIds.indexOf(id);
    if (index !== -1) selectedIds.splice(index, 1);
  }

  return res.json({ selectedCount: selectedIds.length });
});

app.put('/api/selected/reorder', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null;

  if (!ids || ids.length !== selectedIds.length) {
    return res.status(400).json({ error: 'Reorder payload must contain the current selected ids' });
  }

  const uniqueIds = new Set(ids);
  const hasSameIds = uniqueIds.size === selectedSet.size && ids.every((id) => selectedSet.has(id));

  if (!hasSameIds) {
    return res.status(400).json({ error: 'Reorder payload contains duplicates or unknown ids' });
  }

  selectedIds.splice(0, selectedIds.length, ...ids);

  return res.json({ selectedIds, selectedCount: selectedIds.length });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

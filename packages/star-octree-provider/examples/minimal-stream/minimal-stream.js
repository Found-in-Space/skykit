import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '../../src/index.js';
import {
  createObserverShellStrategy,
  createStarCellKey,
  decodeTemperatureK,
} from '@found-in-space/star-trees';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const cellDefinitions = [
  {
    id: 'provider',
    title: '1. Create The Provider',
    lead: 'This cell creates the SkyKit provider against the public octree URL.',
    source: `provider = createStarOctreeProviderService({
  id: 'minimal-stream-scratchpad',
  url: OCTREE_DEFAULT,
});

return provider.describe();`,
  },
  {
    id: 'stream',
    title: '2. Stream Cells',
    lead: 'Change the observer position or magnitude where the provider uses them.',
    source: `if (!provider) throw new Error('Run cell 1 first.');

cells = [];
showProgress(cells);

const stream = provider.streamCells({
  strategy: createObserverShellStrategy(),
  view: {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  },
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef'],
});

for await (const delta of stream) {
  console.log(delta);

  if (delta.type === 'stars/cells-upsert') {
    cells.push(...delta.cells);
    showProgress(cells);
    continue;
  }

  if (delta.type === 'stars/error') {
    throw new Error(delta.error?.message ?? 'Cell stream failed.');
  }

  if (delta.type === 'stars/current') {
    break;
  }
}

return summarizeCells(cells);`,
  },
  {
    id: 'inspect',
    title: '3. Inspect Application Rows',
    lead: 'This is application logic: turn provider cells into the rows you want to show.',
    source: `if (!cells.length) throw new Error('Run cell 2 first.');

rows = rowsFromCells(cells).slice(0, 40);
renderTable(rows);

return \`Rendered \${rows.length} rows.\`;`,
  },
];

const elements = {
  runAll: document.querySelector('[data-run-all]'),
  reset: document.querySelector('[data-reset]'),
  status: document.querySelector('[data-status]'),
  notebook: document.querySelector('[data-notebook]'),
  cellSummary: document.querySelector('[data-cell-summary]'),
  stars: document.querySelector('[data-stars]'),
};

const cells = new Map();

const context = {
  OCTREE_DEFAULT,
  createObserverShellStrategy,
  createStarOctreeProviderService,
  provider: null,
  cells: [],
  rows: [],
  disposeProvider,
  renderTable,
  rowsFromCells,
  showProgress,
  summarizeCells,
};

renderNotebook();
renderSummary(summarizeCells([]));
renderTable([]);

elements.runAll.addEventListener('click', () => {
  void runAllCells();
});

elements.reset.addEventListener('click', () => {
  resetCells();
});

window.addEventListener('pagehide', () => {
  disposeProvider();
});

function renderNotebook() {
  elements.notebook.innerHTML = cellDefinitions.map(renderCell).join('');

  for (const definition of cellDefinitions) {
    const root = elements.notebook.querySelector(`[data-cell="${definition.id}"]`);
    const textarea = root.querySelector('[data-source]');
    const output = root.querySelector('[data-output]');
    const outputBox = root.querySelector('.cell-output');
    const run = root.querySelector('[data-run-cell]');
    textarea.value = definition.source;
    autosizeTextarea(textarea);
    cells.set(definition.id, { definition, output, outputBox, run, root, textarea });
    run.addEventListener('click', () => {
      void runCell(definition.id);
    });
    textarea.addEventListener('input', () => {
      growTextareaToContent(textarea);
    });
  }
}

function renderCell(definition) {
  return `
    <section class="cell" data-cell="${escapeHtml(definition.id)}">
      <div class="cell-header">
        <div>
          <h2>${escapeHtml(definition.title)}</h2>
          <p>${escapeHtml(definition.lead)}</p>
        </div>
      </div>
      <textarea data-source spellcheck="false" aria-label="${escapeHtml(definition.title)} code"></textarea>
      <div class="cell-actions">
        <button type="button" data-run-cell>Run cell</button>
      </div>
      <pre class="cell-output"><code data-output>Not run yet.</code></pre>
    </section>
  `;
}

async function runAllCells() {
  setControlsDisabled(true);
  try {
    for (const definition of cellDefinitions) {
      const succeeded = await runCell(definition.id, { keepControlsDisabled: true });
      if (!succeeded) {
        break;
      }
    }
  } finally {
    setControlsDisabled(false);
  }
}

async function runCell(cellId, options = {}) {
  const cell = cells.get(cellId);
  if (!cell) {
    return;
  }

  if (!options.keepControlsDisabled) {
    setControlsDisabled(true);
  }

  setStatus(`running ${cell.definition.title.toLowerCase()}`);
  cell.root.dataset.state = 'running';
  cell.output.textContent = 'Running...';
  const outputState = { logs: [], result: undefined, hasResult: false };
  const updateOutput = () => {
    cell.output.textContent = formatExecutionOutput(outputState);
    cell.outputBox.scrollTop = cell.outputBox.scrollHeight;
  };

  try {
    const result = await executeCell(cell.textarea.value, (level, args) => {
      outputState.logs.push({ level, args });
      updateOutput();
    });
    outputState.result = result;
    outputState.hasResult = true;
    cell.root.dataset.state = 'ok';
    updateOutput();
    setStatus('ready');
    return true;
  } catch (error) {
    cell.root.dataset.state = 'error';
    cell.output.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
    setStatus('error');
    return false;
  } finally {
    if (!options.keepControlsDisabled) {
      setControlsDisabled(false);
    }
  }
}

async function executeCell(source, onLog) {
  const cellFunction = new AsyncFunction(
    'ctx',
    `with (ctx) {
      return await (async () => {
${source}
      })();
    }`,
  );
  const previousConsole = context.console;
  context.console = createCellConsole(onLog);
  try {
    return await cellFunction(context);
  } finally {
    if (previousConsole === undefined) {
      delete context.console;
    } else {
      context.console = previousConsole;
    }
  }
}

function resetCells() {
  for (const definition of cellDefinitions) {
    const cell = cells.get(definition.id);
    if (!cell) {
      continue;
    }
    cell.textarea.value = definition.source;
    autosizeTextarea(cell.textarea);
    cell.output.textContent = 'Not run yet.';
    cell.root.dataset.state = '';
  }
  context.cells = [];
  context.rows = [];
  disposeProvider();
  renderSummary(summarizeCells([]));
  renderTable([]);
  setStatus('ready');
}

function setControlsDisabled(disabled) {
  elements.runAll.disabled = disabled;
  elements.reset.disabled = disabled;
  for (const cell of cells.values()) {
    cell.run.disabled = disabled;
  }
}

function autosizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function growTextareaToContent(textarea) {
  if (textarea.scrollHeight > textarea.clientHeight) {
    textarea.style.height = `${textarea.scrollHeight}px`;
  }
}

function disposeProvider() {
  if (context.provider) {
    context.provider.dispose();
    context.provider = null;
  }
}

/**
 * @param {Array<import('@found-in-space/star-trees').StarCellData>} cells
 */
function showProgress(cells) {
  renderSummary(summarizeCells(cells));
  setStatus(`streaming cells (${cells.length})`);
}

/**
 * @param {Array<import('@found-in-space/star-trees').StarCellData>} cells
 */
function summarizeCells(cells) {
  return {
    cells: cells.length,
    stars: cells.reduce((sum, cell) => sum + cell.count, 0),
    firstCell: cells[0]?.cellKey ?? '',
  };
}

function renderSummary(summary) {
  elements.cellSummary.innerHTML = [
    summaryItem('Cells', formatInteger(summary.cells)),
    summaryItem('Stars', formatInteger(summary.stars)),
    summaryItem('First cell', summary.firstCell),
  ].join('');
}

/**
 * @param {Array<ReturnType<typeof rowsFromCell>[number]>} rows
 */
function renderTable(rows) {
  context.rows = rows;
  elements.stars.innerHTML = rows.length
    ? rows.map(renderStarRow).join('')
    : '<tr><td colspan="7" class="empty-row">Run the cells to render rows.</td></tr>';
}

/**
 * @param {Array<import('@found-in-space/star-trees').StarCellData>} cells
 */
function rowsFromCells(cells) {
  return cells.flatMap(rowsFromCell);
}

/**
 * @param {import('@found-in-space/star-trees').StarCellData} cell
 */
function rowsFromCell(cell) {
  const positions = cell.coordinates.components;
  const magAbs = cell.attributes.magAbs;
  const teffLog8 = cell.attributes.teffLog8;
  if (!magAbs) {
    return [];
  }

  return Array.from({ length: cell.count }, (_, index) => {
    const ref = cell.refs?.[index];
    return {
      index,
      cellKey: ref ? createStarCellKey(ref) : cell.cellKey,
      ordinal: ref?.ordinal ?? index,
      positionPc: {
        x: positions[index * 3],
        y: positions[index * 3 + 1],
        z: positions[index * 3 + 2],
      },
      magAbs: magAbs[index],
      temperatureK: teffLog8 ? decodeTemperatureK(teffLog8[index]) : null,
    };
  });
}

function renderStarRow(row, rowIndex) {
  return `
    <tr>
      <td>${rowIndex + 1}</td>
      <td>${escapeHtml(row.cellKey)}</td>
      <td>${row.ordinal}</td>
      <td>${formatVector(row.positionPc)}</td>
      <td>${formatNumber(row.magAbs, 2)}</td>
      <td>${formatTemperature(row.temperatureK)}</td>
    </tr>
  `;
}

function summaryItem(label, value) {
  return `
    <div class="summary-item">
      <div class="summary-label">${escapeHtml(label)}</div>
      <div class="summary-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function setStatus(value) {
  elements.status.textContent = value;
}

function createCellConsole(onLog) {
  return {
    log: (...args) => onLog('log', args),
    info: (...args) => onLog('info', args),
    warn: (...args) => onLog('warn', args),
    error: (...args) => onLog('error', args),
  };
}

function formatExecutionOutput(state) {
  const sections = [];
  if (state.logs.length > 0) {
    sections.push(
      [
        'console',
        state.logs
          .map((entry, index) => formatConsoleEntry(entry, index))
          .join('\n\n'),
      ].join('\n'),
    );
  }
  if (state.hasResult) {
    sections.push(['result', formatOutput(state.result)].join('\n'));
  }
  return sections.join('\n\n') || 'Running...';
}

function formatConsoleEntry(entry, index) {
  const message = entry.args.map(formatConsoleArgument).join(' ');
  return `[${index + 1}] ${entry.level}: ${message}`;
}

function formatConsoleArgument(value) {
  if (typeof value === 'string') {
    return value;
  }
  return formatOutput(value);
}

function formatOutput(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return 'undefined';
  }
  return JSON.stringify(summarizeForOutput(value), null, 2);
}

function summarizeForOutput(value, depth = 0) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return `${value.constructor.name}(${value.length})`;
  }
  if (Array.isArray(value)) {
    return {
      type: 'Array',
      length: value.length,
      first: value.slice(0, 3).map((item) => summarizeForOutput(item, depth + 1)),
    };
  }
  if (depth > 2) {
    return '[Object]';
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      summarizeForOutput(nested, depth + 1),
    ]),
  );
}

function formatVector(vector) {
  return `${formatNumber(vector.x, 2)}, ${formatNumber(vector.y, 2)}, ${formatNumber(vector.z, 2)}`;
}

function formatNumber(value, fractionDigits) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: Math.min(fractionDigits, 2),
      })
    : '';
}

function formatInteger(value) {
  return Math.round(value).toLocaleString();
}

function formatTemperature(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString()} K` : '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

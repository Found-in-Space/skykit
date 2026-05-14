import { createStarOctreeProviderService } from '../../src/index.js';

const OCTREE_URL =
  'https://d1kwci8ql2abxm.cloudfront.net/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.octree';

const elements = {
  run: document.querySelector('[data-run]'),
  status: document.querySelector('[data-status]'),
  providerCode: document.querySelector('[data-provider-code]'),
  streamCode: document.querySelector('[data-stream-code]'),
  productSummary: document.querySelector('[data-product-summary]'),
  stars: document.querySelector('[data-stars]'),
};

elements.providerCode.textContent = `import { createStarOctreeProviderService } from '@found-in-space/star-octree-provider';

const provider = createStarOctreeProviderService({
  url: '${OCTREE_URL}',
});`;

elements.streamCode.textContent = `const stream = provider.streamObjectBatches({
  strategy: { kind: 'observer-shell' },
  view: {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  },
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef'],
});

const products = [];
for await (const delta of stream) {
  if (delta.type === 'data/product-upsert') {
    products.push(delta.product);
  }

  if (delta.type === 'data/representation-current') {
    inspectProducts(products);
    break;
  }
}`;

elements.productSummary.innerHTML = renderEmptySummary();
elements.run.addEventListener('click', () => {
  void runExample();
});

async function runExample() {
  elements.run.disabled = true;
  setStatus('creating provider');
  elements.productSummary.innerHTML = renderEmptySummary();
  elements.stars.innerHTML = '<tr><td colspan="7" class="empty-row">Waiting for completed stream.</td></tr>';

  const provider = createStarOctreeProviderService({
    id: 'minimal-stream-example',
    url: OCTREE_URL,
  });

  try {
    setStatus('streaming products');
    const products = [];
    for await (const delta of provider.streamObjectBatches({
      strategy: { kind: 'observer-shell' },
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6.5,
      },
      attributes: ['position', 'magAbs', 'teffLog8', 'objectRef'],
    })) {
      if (delta.type === 'data/product-upsert') {
        products.push(delta.product);
        setStatus(`streaming products (${products.length})`);
        continue;
      }

      if (delta.type === 'data/representation-current') {
        renderProducts(products);
        setStatus('stream complete');
        break;
      }

      if (delta.type === 'data/product-error') {
        throw new Error(delta.error?.message ?? 'Product stream failed.');
      }
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    provider.dispose();
    elements.run.disabled = false;
  }
}

/**
 * @param {Array<import('../../src/index.d.ts').StarObjectBatchProduct>} products
 */
function renderProducts(products) {
  const starCount = products.reduce((sum, product) => sum + product.count, 0);
  const nodeCount = products.reduce((sum, product) => sum + product.nodes.length, 0);
  elements.productSummary.innerHTML = [
    summaryItem('Products', formatInteger(products.length)),
    summaryItem('Stars', formatInteger(starCount)),
    summaryItem('Nodes', formatInteger(nodeCount)),
    summaryItem('First product', products[0]?.id ?? ''),
  ].join('');

  const rows = products.flatMap(rowsFromProduct).slice(0, 40);
  elements.stars.innerHTML = rows.length
    ? rows.map(renderStarRow).join('')
    : '<tr><td colspan="7" class="empty-row">The stream completed without visible star rows.</td></tr>';
}

/**
 * @param {import('../../src/index.d.ts').StarObjectBatchProduct} product
 */
function rowsFromProduct(product) {
  const positions = product.coordinates.primary.components;
  const magAbs = product.attributes.magAbs?.values;
  const teffLog8 = product.attributes.teffLog8?.values;
  if (!magAbs) {
    return [];
  }

  return Array.from({ length: product.count }, (_, index) => {
    const ref = product.refs?.[index];
    const node = ref ? null : nodeForProductIndex(product, index);
    return {
      index,
      productId: product.id,
      nodeKey: ref?.nodeKey ?? node?.nodeKey ?? '',
      ordinal: ref?.ordinal ?? (node ? index - node.offset : index),
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

/**
 * @param {import('../../src/index.d.ts').StarObjectBatchProduct} product
 * @param {number} index
 */
function nodeForProductIndex(product, index) {
  return product.nodes.find(
    (node) => index >= node.offset && index < node.offset + node.count,
  );
}

function renderStarRow(row, rowIndex) {
  return `
    <tr>
      <td>${rowIndex + 1}</td>
      <td>${escapeHtml(row.productId)}</td>
      <td>${escapeHtml(row.nodeKey)}</td>
      <td>${row.ordinal}</td>
      <td>${formatVector(row.positionPc)}</td>
      <td>${formatNumber(row.magAbs, 2)}</td>
      <td>${formatTemperature(row.temperatureK)}</td>
    </tr>
  `;
}

function renderEmptySummary() {
  return [
    summaryItem('Products', '0'),
    summaryItem('Stars', '0'),
    summaryItem('Nodes', '0'),
    summaryItem('First product', ''),
  ].join('');
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

function decodeTemperatureK(teffLog8) {
  const log8 = teffLog8 / 255;
  if (log8 >= 0.996) {
    return 5800;
  }
  return 2000 * Math.pow(25, log8);
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

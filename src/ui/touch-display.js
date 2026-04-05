const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 560;

const DEFAULT_THEME = Object.freeze({
  bg: '#0a0e1aee',
  border: '#334466',
  itemBg: '#141c2e',
  itemHover: '#1e2e50',
  itemPress: '#2a4070',
  text: '#c8d0e0',
  textDim: '#6a7a94',
  accent: '#44ff66',
  toggleOff: '#333c50',
  toggleOn: '#44ff66',
  toggleKnob: '#e0e6f0',
});

const DEFAULT_LAYOUT = Object.freeze({
  padding: 20,
  titleHeight: 50,
  itemHeight: 60,
  rangeItemHeight: 72,
  itemGap: 8,
  itemPaddingX: 16,
  itemRadius: 8,
  toggleWidth: 44,
  toggleHeight: 24,
  rangeTrackHeight: 8,
  rangeTrackRadius: 4,
  rangeTrackInsetY: 18,
  rangeKnobRadius: 11,
  fontSize: 20,
  titleFontSize: 22,
  displayLineHeight: 24,
  displayFontSize: 17,
  displayPaddingY: 12,
  displayLabelFontSize: 13,
  displayActionHeight: 34,
  displayActionGap: 10,
  rangeValueFontSize: 17,
  dismissSize: 28,
  dismissMargin: 10,
  cornerRadius: 16,
});

function cloneItems(items) {
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
}

function countFractionDigits(value) {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  const dot = text.indexOf('.');
  return dot >= 0 ? text.length - dot - 1 : 0;
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function getRangeBounds(item) {
  const min = Number.isFinite(item.min) ? Number(item.min) : 0;
  const max = Number.isFinite(item.max) ? Number(item.max) : 1;
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
  };
}

function normalizeRangeValue(item, value) {
  const numeric = Number(value);
  const { min, max } = getRangeBounds(item);
  const clamped = Math.min(Math.max(Number.isFinite(numeric) ? numeric : min, min), max);
  const step = Number.isFinite(item.step) && item.step > 0 ? Number(item.step) : 0;
  if (!(step > 0)) {
    return clamped;
  }
  const stepped = min + Math.round((clamped - min) / step) * step;
  const digits = countFractionDigits(step);
  return Number(stepped.toFixed(digits));
}

function formatRangeValue(item) {
  if (typeof item.formatValue === 'function') {
    return item.formatValue(item.value);
  }
  const step = Number.isFinite(item.step) && item.step > 0 ? Number(item.step) : 1;
  const digits = countFractionDigits(step);
  return Number(item.value ?? 0).toFixed(digits);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createDefaultControlRegistry(layout, dimensions) {
  function getDisplayActionRect(item, y, h, width) {
    if (!item.actionLabel || (item.lines?.length ?? 0) === 0) {
      return null;
    }

    return {
      x: layout.padding + layout.itemPaddingX,
      y: y + h - layout.displayPaddingY - layout.displayActionHeight,
      w: width - layout.padding * 2 - layout.itemPaddingX * 2,
      h: layout.displayActionHeight,
    };
  }

  function getRangeTrackRect(rect) {
    return {
      x: rect.x + layout.itemPaddingX,
      y: rect.y + rect.h - layout.rangeTrackInsetY - layout.rangeTrackHeight,
      w: rect.w - layout.itemPaddingX * 2,
      h: layout.rangeTrackHeight,
    };
  }

  return {
    button: {
      getHeight() {
        return layout.itemHeight;
      },

      resolveTarget(item, rect, pointer) {
        if (
          pointer.px >= rect.x && pointer.px <= rect.x + rect.w &&
          pointer.py >= rect.y && pointer.py <= rect.y + rect.h
        ) {
          return {
            id: item.id,
            itemId: item.id,
            item,
            controlType: 'button',
            targetType: 'button',
            label: item.label,
          };
        }
        return null;
      },

      activate(runtime, target) {
        runtime.emit(target);
      },

      render(ctx, rect, item, state, env) {
        const { theme } = env;
        ctx.fillStyle = state.isPressed
          ? theme.itemPress
          : state.isHovered
            ? theme.itemHover
            : theme.itemBg;
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, layout.itemRadius);
        ctx.fill();

        ctx.fillStyle = theme.text;
        ctx.font = `${layout.fontSize}px sans-serif`;
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(item.label).width;
        ctx.fillText(
          item.label,
          rect.x + (rect.w - textWidth) / 2,
          rect.y + rect.h / 2,
        );
      },
    },

    toggle: {
      getHeight() {
        return layout.itemHeight;
      },

      resolveTarget(item, rect, pointer) {
        if (
          pointer.px >= rect.x && pointer.px <= rect.x + rect.w &&
          pointer.py >= rect.y && pointer.py <= rect.y + rect.h
        ) {
          return {
            id: item.id,
            itemId: item.id,
            item,
            controlType: 'toggle',
            targetType: 'toggle',
            label: item.label,
          };
        }
        return null;
      },

      activate(runtime, target) {
        target.item.value = !target.item.value;
        runtime.markDirty();
        runtime.emit({
          ...target,
          value: target.item.value,
        });
      },

      render(ctx, rect, item, state, env) {
        const { theme } = env;
        ctx.fillStyle = state.isPressed
          ? theme.itemPress
          : state.isHovered
            ? theme.itemHover
            : theme.itemBg;
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, layout.itemRadius);
        ctx.fill();

        ctx.fillStyle = theme.text;
        ctx.font = `${layout.fontSize}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, rect.x + layout.itemPaddingX, rect.y + rect.h / 2);

        const x = rect.x + rect.w - layout.itemPaddingX - layout.toggleWidth;
        const y = rect.y + (rect.h - layout.toggleHeight) / 2;
        const r = layout.toggleHeight / 2;
        ctx.fillStyle = item.value ? theme.toggleOn : theme.toggleOff;
        roundRect(ctx, x, y, layout.toggleWidth, layout.toggleHeight, r);
        ctx.fill();

        const knobR = r - 3;
        const knobX = item.value ? x + layout.toggleWidth - r : x + r;
        const knobY = y + r;
        ctx.fillStyle = theme.toggleKnob;
        ctx.beginPath();
        ctx.arc(knobX, knobY, knobR, 0, Math.PI * 2);
        ctx.fill();
      },
    },

    range: {
      getHeight() {
        return layout.rangeItemHeight;
      },

      resolveTarget(item, rect, pointer) {
        if (
          pointer.px >= rect.x && pointer.px <= rect.x + rect.w &&
          pointer.py >= rect.y && pointer.py <= rect.y + rect.h
        ) {
          return {
            id: item.id,
            itemId: item.id,
            item,
            controlType: 'range',
            targetType: 'range',
            label: item.label,
          };
        }
        return null;
      },

      activate(runtime, target, pointer) {
        this.updateFromPointer(runtime, target, pointer);
      },

      pressMove(runtime, target, pointer) {
        this.updateFromPointer(runtime, target, pointer);
      },

      updateFromPointer(runtime, target, pointer) {
        if (!pointer) {
          return;
        }
        const rect = runtime.getRectForItem(target.itemId);
        if (!rect) {
          return;
        }
        const track = getRangeTrackRect(rect);
        const t = clamp01((pointer.u * dimensions.width - track.x) / Math.max(track.w, 1));
        const { min, max } = getRangeBounds(target.item);
        const nextValue = normalizeRangeValue(target.item, min + (max - min) * t);
        if (target.item.value === nextValue) {
          return;
        }
        target.item.value = nextValue;
        runtime.markDirty();
        runtime.emit({
          ...target,
          value: nextValue,
        });
      },

      render(ctx, rect, item, _state, env) {
        const { theme } = env;
        const track = getRangeTrackRect(rect);
        const { min, max } = getRangeBounds(item);
        const value = normalizeRangeValue(item, item.value);
        const t = max > min ? clamp01((value - min) / (max - min)) : 0;

        ctx.fillStyle = theme.itemBg;
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, layout.itemRadius);
        ctx.fill();

        ctx.fillStyle = theme.text;
        ctx.font = `${layout.fontSize}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(item.label, rect.x + layout.itemPaddingX, rect.y + 12);

        const valueText = formatRangeValue({ ...item, value });
        ctx.font = `${layout.rangeValueFontSize}px sans-serif`;
        const valueWidth = ctx.measureText(valueText).width;
        ctx.fillText(
          valueText,
          rect.x + rect.w - layout.itemPaddingX - valueWidth,
          rect.y + 14,
        );

        ctx.fillStyle = theme.toggleOff;
        roundRect(ctx, track.x, track.y, track.w, track.h, layout.rangeTrackRadius);
        ctx.fill();

        ctx.fillStyle = theme.toggleOn;
        roundRect(ctx, track.x, track.y, track.w * t, track.h, layout.rangeTrackRadius);
        ctx.fill();

        const knobX = track.x + track.w * t;
        const knobY = track.y + track.h / 2;
        ctx.fillStyle = theme.toggleKnob;
        ctx.beginPath();
        ctx.arc(knobX, knobY, layout.rangeKnobRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 2;
        ctx.stroke();
      },
    },

    display: {
      getHeight(item) {
        const contentLines = Math.max(item.lines?.length ?? 0, 1);
        const labelLines = item.label ? 1 : 0;
        const actionHeight = item.actionLabel && (item.lines?.length ?? 0) > 0
          ? layout.displayActionGap + layout.displayActionHeight
          : 0;
        return layout.displayPaddingY * 2
          + (contentLines + labelLines) * layout.displayLineHeight
          + actionHeight;
      },

      resolveTarget(item, rect, pointer) {
        const rectRight = rect.x + rect.w;
        if (item.dismissible && item.lines?.length > 0) {
          const bx = rectRight - layout.dismissMargin - layout.dismissSize;
          const by = rect.y + layout.dismissMargin;
          if (
            pointer.px >= bx && pointer.px <= bx + layout.dismissSize &&
            pointer.py >= by && pointer.py <= by + layout.dismissSize
          ) {
            return {
              id: item.id,
              itemId: item.id,
              item,
              controlType: 'display',
              targetType: 'dismiss',
              label: item.label,
            };
          }
        }

        const actionRect = getDisplayActionRect(item, rect.y, rect.h, dimensions.width);
        if (
          actionRect &&
          pointer.px >= actionRect.x &&
          pointer.px <= actionRect.x + actionRect.w &&
          pointer.py >= actionRect.y &&
          pointer.py <= actionRect.y + actionRect.h
        ) {
          return {
            id: item.actionId ?? `${item.id}-action`,
            itemId: item.id,
            item,
            controlType: 'display',
            targetType: 'action',
            label: item.actionLabel,
          };
        }

        return null;
      },

      activate(runtime, target) {
        runtime.emit(target);
      },

      render(ctx, rect, item, state, env) {
        const { theme } = env;
        ctx.fillStyle = theme.itemBg;
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, layout.itemRadius);
        ctx.fill();

        if (item.label) {
          ctx.fillStyle = theme.accent;
          ctx.font = `bold ${layout.displayLabelFontSize}px sans-serif`;
          ctx.textBaseline = 'top';
          ctx.fillText(
            item.label.toUpperCase(),
            rect.x + layout.itemPaddingX,
            rect.y + layout.displayPaddingY,
          );
        }

        const lines = item.lines;
        if (!lines || lines.length === 0) {
          ctx.fillStyle = theme.textDim;
          ctx.font = `${layout.displayFontSize}px sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.fillText('No selection', rect.x + layout.itemPaddingX, rect.y + rect.h / 2);
          return;
        }

        ctx.font = `${layout.displayFontSize}px sans-serif`;
        ctx.textBaseline = 'top';
        const labelOffset = item.label ? layout.displayLineHeight : 0;
        let ly = rect.y + layout.displayPaddingY + labelOffset;
        for (const line of lines) {
          ctx.fillStyle = theme.text;
          ctx.fillText(line, rect.x + layout.itemPaddingX, ly);
          ly += layout.displayLineHeight;
        }

        const actionRect = getDisplayActionRect(item, rect.y, rect.h, dimensions.width);
        if (actionRect) {
          ctx.fillStyle = state.isPressed && state.hoveredTargetType === 'action'
            ? theme.itemPress
            : state.isHovered && state.hoveredTargetType === 'action'
              ? theme.itemHover
              : theme.toggleOff;
          roundRect(ctx, actionRect.x, actionRect.y, actionRect.w, actionRect.h, 10);
          ctx.fill();

          ctx.fillStyle = theme.text;
          ctx.font = `bold ${layout.displayFontSize}px sans-serif`;
          ctx.textBaseline = 'middle';
          const textWidth = ctx.measureText(item.actionLabel).width;
          ctx.fillText(
            item.actionLabel,
            actionRect.x + (actionRect.w - textWidth) / 2,
            actionRect.y + actionRect.h / 2,
          );
        }

        if (item.dismissible) {
          const cx = rect.x + rect.w - layout.dismissMargin - layout.dismissSize / 2;
          const cy = rect.y + layout.dismissMargin + layout.dismissSize / 2;
          const r = layout.dismissSize / 2;

          ctx.fillStyle = state.isPressed && state.hoveredTargetType === 'dismiss'
            ? theme.itemPress
            : state.isHovered && state.hoveredTargetType === 'dismiss'
              ? theme.itemHover
              : theme.toggleOff;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = theme.text;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          const s = 6;
          ctx.beginPath();
          ctx.moveTo(cx - s, cy - s);
          ctx.lineTo(cx + s, cy + s);
          ctx.moveTo(cx + s, cy - s);
          ctx.lineTo(cx - s, cy + s);
          ctx.stroke();
        }
      },
    },
  };
}

/**
 * Canvas-backed micro-framework for compact in-world touch displays.
 *
 * The display owns control layout, drawing, hover/press state, and
 * sub-control dispatch. Hosts provide pointer hits in normalized UV
 * coordinates plus a pressed state, which lets the same display logic
 * back XR tablets, ship panels, or anchored info cards.
 */
export function createTouchDisplay(options = {}) {
  const width = Number.isFinite(options.width) ? Number(options.width) : DEFAULT_WIDTH;
  const height = Number.isFinite(options.height) ? Number(options.height) : DEFAULT_HEIGHT;
  const layout = { ...DEFAULT_LAYOUT, ...(options.layout ?? {}) };
  const theme = { ...DEFAULT_THEME, ...(options.theme ?? {}) };
  const title = options.title ?? 'SkyKit';
  const canvas = options.canvas ?? document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = options.context2d ?? canvas.getContext('2d');
  const registry = {
    ...createDefaultControlRegistry(layout, { width, height }),
    ...(options.controls ?? {}),
  };

  let items = cloneItems(options.items);
  let hoveredTarget = null;
  let pressedTarget = null;
  let pointerWasPressed = false;
  let dirty = true;
  let itemRects = new Map();

  function markDirty() {
    dirty = true;
  }

  function walkItemRects(callback) {
    const nextRects = new Map();
    let y = layout.padding + layout.titleHeight;
    for (const item of items) {
      const control = registry[item.type];
      const rect = {
        x: layout.padding,
        y,
        w: width - layout.padding * 2,
        h: control?.getHeight?.(item, api) ?? layout.itemHeight,
      };
      nextRects.set(item.id, rect);
      const result = callback(item, rect, control);
      if (result !== undefined) {
        itemRects = nextRects;
        return result;
      }
      y += rect.h + layout.itemGap;
    }
    itemRects = nextRects;
    return null;
  }

  function ensureItemRects() {
    walkItemRects(() => undefined);
  }

  function resolveTargetAtUv(u, v) {
    const pointer = {
      u,
      v,
      px: u * width,
      py: (1 - v) * height,
    };

    return walkItemRects((item, rect, control) => {
      if (!control?.resolveTarget) {
        return undefined;
      }
      const target = control.resolveTarget(item, rect, pointer, api);
      return target ?? undefined;
    });
  }

  function setHoveredTarget(target) {
    const nextId = target?.id ?? null;
    const prevId = hoveredTarget?.id ?? null;
    if (prevId !== nextId || hoveredTarget?.targetType !== target?.targetType) {
      hoveredTarget = target;
      markDirty();
      return;
    }
    hoveredTarget = target;
  }

  function emit(target) {
    if (typeof options.onAction === 'function') {
      options.onAction(target.id, target.value ?? target.item?.value, {
        target,
        item: target.item ?? null,
        display: api,
      });
    }
  }

  function redraw() {
    ensureItemRects();
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = theme.bg;
    roundRect(ctx, 0, 0, width, height, layout.cornerRadius);
    ctx.fill();

    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, width - 2, height - 2, layout.cornerRadius);
    ctx.stroke();

    ctx.fillStyle = theme.accent;
    ctx.font = `bold ${layout.titleFontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(title, layout.padding, layout.padding + layout.titleHeight / 2);

    walkItemRects((item, rect, control) => {
      control?.render?.(ctx, rect, item, {
        isHovered: hoveredTarget?.itemId === item.id,
        isPressed: pressedTarget?.itemId === item.id,
        hoveredTargetType: hoveredTarget?.targetType ?? null,
      }, {
        theme,
        layout,
        width,
        height,
      });
      return undefined;
    });

    dirty = false;
    return true;
  }

  const api = {
    canvas,

    draw() {
      if (!dirty) {
        return false;
      }
      return redraw();
    },

    getItem(id) {
      return items.find((item) => item.id === id) ?? null;
    },

    getRectForItem(id) {
      ensureItemRects();
      return itemRects.get(id) ?? null;
    },

    getItems() {
      return items.map((item) => ({ ...item }));
    },

    handlePointer(hit, pressed = false) {
      const target = hit ? resolveTargetAtUv(hit.u, hit.v) : null;
      setHoveredTarget(target);

      if (pressed && !pointerWasPressed && target) {
        pressedTarget = target;
        markDirty();
        registry[target.item?.type]?.activate?.(api, target, hit);
      } else if (pressed && pressedTarget) {
        registry[pressedTarget.item?.type]?.pressMove?.(api, pressedTarget, hit);
      }

      if (!pressed && pressedTarget) {
        pressedTarget = null;
        markDirty();
      }

      pointerWasPressed = pressed;
    },

    markDirty,

    emit,

    setDisplay(id, lines) {
      const item = items.find((entry) => entry.id === id && entry.type === 'display');
      if (!item) {
        return;
      }
      item.lines = lines;
      markDirty();
    },

    setItems(nextItems) {
      items = cloneItems(nextItems);
      hoveredTarget = null;
      pressedTarget = null;
      markDirty();
    },

    setItemValue(id, value) {
      const item = items.find((entry) => entry.id === id);
      if (!item) {
        return;
      }
      item.value = item.type === 'range'
        ? normalizeRangeValue(item, value)
        : value;
      markDirty();
    },
  };

  return api;
}

export function createNoopInterestField(options = {}) {
  const id = options.id ?? 'noop-interest-field';

  return {
    id,
    async selectNodes() {
      return {
        strategy: id,
        nodes: [],
        meta: {
          note: options.note ?? 'Phase 1 placeholder selection',
        },
      };
    },
  };
}


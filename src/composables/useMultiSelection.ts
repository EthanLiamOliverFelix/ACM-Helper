import { reactive, watch } from 'vue'
import { MultiSelection } from '../utils/multiSelection'

export function useMultiSelection(scope: () => string[], available = scope) {
  const selection = reactive(new MultiSelection())
  watch(scope, ids => selection.setScope(ids), { immediate: true, flush: 'sync' })
  watch(available, ids => selection.prune(new Set(ids)), { immediate: true, flush: 'sync' })
  return selection
}

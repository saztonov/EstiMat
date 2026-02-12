// API
export {
  useMaterials,
  useMaterial,
  useMaterialGroups,
  useMaterialGroup,
  materialKeys,
} from './api/queries'
export {
  useCreateMaterial,
  useUpdateMaterial,
  useDeleteMaterial,
  useCreateMaterialGroup,
  useUpdateMaterialGroup,
  useDeleteMaterialGroup,
} from './api/mutations'

// Hooks
export { useMaterialsWithSearch } from './hooks/use-materials'

// UI
export { MaterialSelect } from './ui/material-select'
export { MaterialGroupTree } from './ui/material-group-tree'

// Types & schemas
export type {
  MaterialGroup,
  MaterialGroupWithChildren,
  MaterialCatalog,
  MaterialCatalogWithGroup,
  MaterialListParams,
  CreateMaterialGroupInput,
  CreateMaterialInput,
  UpdateMaterialInput,
} from './types'
export {
  createMaterialGroupSchema,
  createMaterialSchema,
  updateMaterialSchema,
} from './types'
